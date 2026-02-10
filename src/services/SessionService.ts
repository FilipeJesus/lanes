/**
 * SessionService - Session creation and worktree management operations
 *
 * This service handles the core session creation logic, including:
 * - Creating new Claude sessions with git worktrees
 * - Validating session names and branches
 * - Managing worktree directories
 * - Checking branch existence and usage
 *
 * The sessionCreationQueue is encapsulated in this service to prevent race conditions
 * when rapidly creating sessions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

import { fileExists, ensureDir, writeJson } from './FileService';
import { execGit } from '../gitService';
import {
    AgentSessionProvider,
    getSessionId,
    getSessionChimeEnabled,
    setSessionChimeEnabled,
    getBaseRepoPathForStorage,
    getSessionNameFromWorktree,
    getWorktreesFolder,
    getPromptsPath,
    saveSessionWorkflow,
    getStatusFilePath,
    getSessionFilePath,
    getWorkflowStatus,
    getOrCreateTaskListId
} from '../AgentSessionProvider';
import { PermissionMode, isValidPermissionMode } from '../SessionFormProvider';
import * as SettingsService from './SettingsService';
import * as DiffService from './DiffService';
import * as BrokenWorktreeService from './BrokenWorktreeService';
import { validateBranchName, ValidationResult } from '../utils';
import { sanitizeSessionName as _sanitizeSessionName, getErrorMessage } from '../utils';
import { validateSessionName } from '../validation';
import { AsyncQueue } from '../AsyncQueue';
import { LanesError, GitError, ValidationError } from '../errors';
import { ClaudeCodeAgent, CodeAgent } from '../codeAgents';
import { propagateLocalSettings, LocalSettingsPropagationMode } from '../localSettings';
import { addProject } from '../ProjectManagerService';

// Use local reference for internal use
const sanitizeSessionName = _sanitizeSessionName;

// Session creation queue - prevents race conditions when rapidly creating sessions
let sessionCreationQueue: AsyncQueue | undefined;

/**
 * Get or create the session creation queue.
 * This queue ensures that session creation operations are serialized
 * to prevent race conditions when multiple sessions are created rapidly.
 */
export function getSessionCreationQueue(): AsyncQueue {
    if (!sessionCreationQueue) {
        sessionCreationQueue = new AsyncQueue();
    }
    return sessionCreationQueue;
}

// Track branches that have shown merge-base warnings (debounce to avoid spam)
const warnedMergeBaseBranches = new Set<string>();

/**
 * Get a set of branch names that are currently checked out in worktrees.
 * Parses the output of `git worktree list --porcelain`.
 * @param cwd The working directory (git repo root)
 * @returns A Set of branch names currently in use by worktrees
 */
export async function getBranchesInWorktrees(cwd: string): Promise<Set<string>> {
    const branches = new Set<string>();
    try {
        const output = await execGit(['worktree', 'list', '--porcelain'], cwd);
        // Parse the porcelain output - each worktree is separated by blank lines
        // and branch info is in "branch refs/heads/<branch-name>" format
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.startsWith('branch refs/heads/')) {
                const branchName = line.replace('branch refs/heads/', '').trim();
                if (branchName) {
                    branches.add(branchName);
                }
            }
        }
    } catch (error) {
        // Log error for debugging but return empty set to allow graceful degradation
        console.warn('Failed to get worktree branches:', error);
    }
    return branches;
}

/**
 * Ensure the worktree directory exists in the repository.
 * @param root The repository root path
 */
async function ensureWorktreeDirExists(root: string): Promise<void> {
    const dir = path.join(root, getWorktreesFolder());
    try {
        await fsPromises.access(dir);
    } catch {
        await fsPromises.mkdir(dir, { recursive: true });
    }
}

// Forward declarations for functions that will be imported from TerminalService
// These are needed for createSession but will be injected or imported later
interface OpenAgentTerminalFn {
    (taskName: string, worktreePath: string, prompt?: string, permissionMode?: PermissionMode, workflow?: string | null, codeAgent?: CodeAgent, repoRoot?: string, skipWorkflowPrompt?: boolean): Promise<void>;
}

let openAgentTerminalImpl: OpenAgentTerminalFn | null = null;

/**
 * Set the openAgentTerminal implementation.
 * This is used to inject the terminal function after all services are loaded.
 * @param impl The openAgentTerminal function implementation
 */
export function setOpenAgentTerminal(impl: OpenAgentTerminalFn): void {
    openAgentTerminalImpl = impl;
}

/**
 * Generates the workflow orchestrator instructions to prepend to a prompt.
 * These instructions guide Claude through the structured workflow phases.
 */
function getWorkflowOrchestratorInstructions(workflow?: string | null): string {
    return `You are the main agent following a structured workflow. Your goal is to successfully complete the workflow which guides you through the work requested by your user.
To be successfull you must follow the workflow and follow these instructions carefully.

## CRITICAL RULES

1. **Always check workflow_status first** to see your current step
2. **For tasks/steps which specify a agent or subagent**, spawn sub-agents using the Task tool to do the task even if you think you can do it yourself
3. **Call workflow_advance** after completing each step
4. **Never skip steps** - complete each one before advancing
5. **Only perform actions for the CURRENT step** - do NOT call workflow tools that belong to future steps. If you are unsure about a parameter value (like a loop name), read the workflow file (${workflow}) or wait for the step that provides that information instead of guessing.
6. **Do NOT call workflow_set_tasks unless instructed to do so in the step instructions**
7. **Do not play the role of a specified agent** - always spawn the required agent using the Task tool

## Workflow

1. Call workflow_start to begin the workflow
2. In workflow: follow instructions for each step and only that step at the end of each step call workflow_advance to move to the next step
3. When complete: review all work and commit if approved

## Sub-Agent Spawning

When the current step requires an agent/subagent other than orchestrator:
- Use the Task tool to spawn a sub-agent, make sure it knows it should NOT call workflow_advance
- Wait for the sub-agent to complete
- YOU should call workflow_advance with a summary

---

## User Request

`;
}

/**
 * Assemble the starting prompt with optional file attachments.
 * Attachments are listed BEFORE the user's typed text.
 */
function assembleStartingPrompt(userPrompt: string, attachments: string[]): string {
    let prompt = '';

    if (attachments.length > 0) {
        prompt += 'Attached files:\n';
        for (const filePath of attachments) {
            if (/[\n\r\0]/.test(filePath)) {
                console.warn(`Lanes: Skipping invalid file path in attachment`);
                continue;
            }
            prompt += `- ${filePath}\n`;
        }
        prompt += '\n';
    }

    const trimmedUserPrompt = userPrompt.trim();
    if (trimmedUserPrompt) {
        prompt += trimmedUserPrompt;
    }

    return prompt;
}

/**
 * Create a new Claude session with a git worktree.
 *
 * This function creates a new git worktree for the session, sets up the environment,
 * and opens a terminal with Claude Code running in the worktree.
 *
 * @param name Session name (used as branch name)
 * @param prompt Optional starting prompt for Claude
 * @param permissionMode Permission mode for Claude CLI
 * @param sourceBranch Optional source branch to create worktree from (empty = use default behavior)
 * @param workflow Optional workflow template name to guide Claude through structured phases
 * @param attachments Array of file paths to attach to the starting prompt
 * @param workspaceRoot The workspace root path
 * @param sessionProvider The session provider for refreshing the UI
 * @param codeAgent Optional CodeAgent for custom agent behavior
 */
async function createSession(
    name: string,
    prompt: string,
    permissionMode: PermissionMode,
    sourceBranch: string,
    workflow: string | null,
    attachments: string[],
    workspaceRoot: string | undefined,
    sessionProvider: AgentSessionProvider,
    codeAgent?: CodeAgent
): Promise<void> {
    console.log("Create Session triggered!");

    // 1. Check Workspace (early check, outside queue for fast feedback)
    if (!workspaceRoot) {
        const errorMsg = "Error: You must open a folder/workspace first!";
        vscode.window.showErrorMessage(errorMsg);
        throw new Error(errorMsg);
    }

    // 2. Check Git Status (early check, outside queue for fast feedback)
    const isGit = await fileExists(path.join(workspaceRoot, '.git'));
    if (!isGit) {
        const errorMsg = "Error: Current folder is not a git repository. Run 'git init' first.";
        vscode.window.showErrorMessage(errorMsg);
        throw new Error(errorMsg);
    }

    const queue = getSessionCreationQueue();

    // Queue the actual session creation to prevent race conditions
    return queue.add(async () => {
        // Use iterative approach to handle name conflicts
        let currentName = name;
        const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

        while (true) {
            // 3. Validate name exists
            if (!currentName || !currentName.trim()) {
                const errorMsg = "Error: Session name is required!";
                vscode.window.showErrorMessage(errorMsg);
                throw new Error(errorMsg);
            }

            // 3a. Sanitize the name to make it git-safe
            const sanitizedName = sanitizeSessionName(currentName);

            // 3b. Check if sanitization resulted in an empty string
            if (!sanitizedName) {
                const errorMsg = "Error: Session name contains no valid characters. Use letters, numbers, hyphens, underscores, dots, or slashes.";
                vscode.window.showErrorMessage(errorMsg);
                throw new Error(errorMsg);
            }

            // 3c. Security: Validate session name before using in path operations
            // This check prevents path traversal attacks and other malicious inputs
            const sessionNameValidation = validateSessionName(sanitizedName);
            if (!sessionNameValidation.valid) {
                const errorMsg = `Invalid session name: ${sessionNameValidation.error}`;
                vscode.window.showErrorMessage(errorMsg);
                throw new ValidationError('sessionName', sanitizedName, sessionNameValidation.error || 'Session name validation failed');
            }

            const trimmedName = sanitizedName;

            // 3d. Validate branch name using Git rules (pre-flight validation for better UX)
            const nameValidation = validateBranchName(trimmedName);
            if (!nameValidation.valid) {
                vscode.window.showErrorMessage(nameValidation.error || "Session name contains invalid characters.");
                throw new Error(nameValidation.error || "Session name contains invalid characters.");
            }

            const worktreePath = path.join(workspaceRoot, getWorktreesFolder(), trimmedName);
            console.log(`Target path: ${worktreePath}`);

            try {
                // 4. Create Worktree
                vscode.window.showInformationMessage(`Creating session '${trimmedName}'...`);

                await ensureWorktreeDirExists(workspaceRoot);

                // Check if the branch already exists
                const branchAlreadyExists = await BrokenWorktreeService.branchExists(workspaceRoot, trimmedName);

                if (branchAlreadyExists) {
                    // Check if the branch is already in use by another worktree
                    const branchesInUse = await getBranchesInWorktrees(workspaceRoot);

                    if (branchesInUse.has(trimmedName)) {
                        // Branch is already checked out in another worktree - cannot use it
                        const errorMsg = `Branch '${trimmedName}' is already checked out in another worktree. ` +
                            `Git does not allow the same branch to be checked out in multiple worktrees.`;
                        vscode.window.showErrorMessage(errorMsg);
                        throw new Error(errorMsg);
                    }

                    // Branch exists but is not in use - prompt user for action
                    const choice = await vscode.window.showQuickPick(
                        [
                            {
                                label: 'Use existing branch',
                                description: `Create worktree using the existing '${trimmedName}' branch`,
                                action: 'use-existing'
                            },
                            {
                                label: 'Enter new name',
                                description: 'Choose a different session name',
                                action: 'new-name'
                            }
                        ],
                        {
                            placeHolder: `Branch '${trimmedName}' already exists. What would you like to do?`,
                            title: 'Branch Already Exists'
                        }
                    );

                    if (!choice) {
                        // User cancelled
                        vscode.window.showInformationMessage('Session creation cancelled.');
                        return;
                    }

                    if (choice.action === 'new-name') {
                        // Prompt for new name and continue the loop
                        const newName = await vscode.window.showInputBox({
                            prompt: "Enter a new session name (creates new branch)",
                            placeHolder: "fix-login-v2",
                            validateInput: (value) => {
                                if (!value || !value.trim()) {
                                    return 'Session name is required';
                                }
                                const trimmed = value.trim();
                                if (!branchNameRegex.test(trimmed)) {
                                    return 'Use only letters, numbers, hyphens, underscores, dots, or slashes';
                                }
                                // Prevent names that could cause git issues
                                if (trimmed.startsWith('-') || trimmed.startsWith('.') ||
                                    trimmed.endsWith('.') || trimmed.includes('..') ||
                                    trimmed.endsWith('.lock')) {
                                    return "Name cannot start with '-' or '.', end with '.' or '.lock', or contain '..'";
                                }
                                return null;
                            }
                        });

                        if (!newName) {
                            vscode.window.showInformationMessage('Session creation cancelled.');
                            return;
                        }

                        // Update currentName and continue the loop (iterative instead of recursive)
                        currentName = newName;
                        continue;
                    }

                    // User chose to use existing branch - create worktree without -b flag
                    console.log(`Running: git worktree add "${worktreePath}" "${trimmedName}"`);
                    await execGit(['worktree', 'add', worktreePath, trimmedName], workspaceRoot);
                } else {
                    // Branch doesn't exist - create new branch
                    // If sourceBranch is provided, use it as the starting point
                    const trimmedSourceBranch = sourceBranch.trim();
                    if (trimmedSourceBranch) {
                        // Validate branch name using Git rules before checking existence
                        const sourceValidation = validateBranchName(trimmedSourceBranch);
                        if (!sourceValidation.valid) {
                            vscode.window.showErrorMessage(sourceValidation.error || "Source branch name contains invalid characters.");
                            throw new Error(sourceValidation.error || "Source branch name contains invalid characters.");
                        }

                        // Parse remote and branch from the source branch
                        // Examples: 'origin/main' -> remote='origin', branch='main'
                        //           'main' -> remote='origin', branch='main' (default to origin)
                        //           'upstream/develop' -> remote='upstream', branch='develop'
                        let remote = 'origin';
                        let branchName = trimmedSourceBranch;

                        if (trimmedSourceBranch.includes('/')) {
                            const parts = trimmedSourceBranch.split('/');
                            remote = parts[0];
                            branchName = parts.slice(1).join('/');
                        }

                        // Fetch the source branch from remote to ensure we have the latest version
                        try {
                            console.log(`Fetching latest version of ${trimmedSourceBranch} from remote...`);
                            await execGit(['fetch', remote, branchName], workspaceRoot);
                            console.log(`Successfully fetched ${remote}/${branchName}`);
                        } catch (fetchErr) {
                            // If fetch fails (e.g., offline, remote doesn't exist), warn but continue
                            const fetchErrMsg = getErrorMessage(fetchErr);
                            console.warn(`Failed to fetch ${remote}/${branchName}: ${fetchErrMsg}`);
                            vscode.window.showWarningMessage(
                                `Could not fetch latest version of '${trimmedSourceBranch}'. Proceeding with local data if available. (${fetchErrMsg})`
                            );
                        }

                        // Verify the source branch exists before using it
                        const sourceBranchExists = await BrokenWorktreeService.branchExists(workspaceRoot, trimmedSourceBranch);
                        // Also check for remote branches (origin/branch-name format)
                        let remoteSourceExists = false;
                        if (!sourceBranchExists) {
                            try {
                                await execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${trimmedSourceBranch}`], workspaceRoot);
                                remoteSourceExists = true;
                            } catch {
                                // Remote doesn't exist either
                            }
                        }

                        if (!sourceBranchExists && !remoteSourceExists) {
                            const errorMsg = `Source branch '${trimmedSourceBranch}' does not exist.`;
                            vscode.window.showErrorMessage(errorMsg);
                            throw new Error(errorMsg);
                        }

                        console.log(`Running: git worktree add "${worktreePath}" -b "${trimmedName}" "${trimmedSourceBranch}"`);
                        await execGit(['worktree', 'add', worktreePath, '-b', trimmedName, trimmedSourceBranch], workspaceRoot);
                    } else {
                        // No source branch specified - use HEAD as starting point (default behavior)
                        console.log(`Running: git worktree add "${worktreePath}" -b "${trimmedName}"`);
                        await execGit(['worktree', 'add', worktreePath, '-b', trimmedName], workspaceRoot);
                    }
                }

                // 5. Add worktree as a project in Project Manager
                // Get sanitized repo name for project naming
                const repoName = SettingsService.getRepoName(workspaceRoot).replace(/[<>:"/\\|?*]/g, '_');
                const projectName = `${repoName}-${trimmedName}`;
                await addProject(projectName, worktreePath, ['lanes']);

                // 5.5. Propagate local settings to worktree
                try {
                    const config = vscode.workspace.getConfiguration('lanes');
                    const propagationMode = config.get<LocalSettingsPropagationMode>('localSettingsPropagation', 'copy');
                    await propagateLocalSettings(workspaceRoot, worktreePath, propagationMode, codeAgent);
                } catch (err) {
                    // Log but don't fail session creation
                    console.warn('Lanes: Failed to propagate local settings:', err);
                }

                // 5.6. Write initial session file for hookless agents
                // Agents without hooks (e.g., Codex) don't write session files via CLI hooks,
                // so Lanes must create the session file directly with the agentName field.
                if (codeAgent && !codeAgent.supportsHooks()) {
                    const sessionFilePath = getSessionFilePath(worktreePath);
                    await ensureDir(path.dirname(sessionFilePath));
                    await writeJson(sessionFilePath, {
                        agentName: codeAgent.name,
                        timestamp: new Date().toISOString()
                    });
                }

                // 6. Success
                sessionProvider.refresh();

                // Use the injected openAgentTerminal or fall back to a local implementation
                // This will be set by extension.ts after all services are loaded
                if (openAgentTerminalImpl) {
                    const assembledPrompt = assembleStartingPrompt(prompt, attachments);
                    await openAgentTerminalImpl(trimmedName, worktreePath, assembledPrompt, permissionMode, workflow, codeAgent, workspaceRoot);
                } else {
                    // This should not happen in normal operation, but provides a fallback
                    console.warn('SessionService: openAgentTerminal not injected, session may not open properly');
                }

                vscode.window.showInformationMessage(`Session '${trimmedName}' Ready!`);

                // Exit the loop on success
                return;

            } catch (err) {
                console.error(err);
                let userMessage = 'Failed to create session.';
                if (err instanceof GitError) {
                    userMessage = err.userMessage;
                } else if (err instanceof ValidationError) {
                    userMessage = err.userMessage;
                } else if (err instanceof LanesError) {
                    userMessage = err.userMessage;
                } else {
                    // Generic fallback
                    userMessage = `Git Error: ${getErrorMessage(err)}`;
                }
                vscode.window.showErrorMessage(userMessage);
                throw err;
            }
        }
    }, 30000); // 30 second timeout
}

// Export the public API
export {
    createSession,
    openAgentTerminalImpl,
    warnedMergeBaseBranches,
};

// Re-export types for convenience
export type { OpenAgentTerminalFn };
