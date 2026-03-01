/**
 * SessionService - Session creation and worktree management operations
 *
 * This service handles the VS Code-specific session creation orchestration:
 * - Input validation and sanitization
 * - Interactive branch conflict resolution via quickpick
 * - Project Manager integration
 * - Terminal opening
 *
 * Core worktree creation logic lives in core/services/SessionCreationService.
 */

import * as vscode from 'vscode';
import * as path from 'path';

import { fileExists } from '../../core/services/FileService';
import {
    AgentSessionProvider,
    getWorktreesFolder,
    getSessionFilePath,
} from '../providers/AgentSessionProvider';
import { PermissionMode } from '../providers/SessionFormProvider';
import * as SettingsService from '../../core/services/SettingsService';
import { getBranchesInWorktrees } from '../../core/services/BrokenWorktreeService';
import { validateBranchName } from '../../core/utils';
import { sanitizeSessionName as _sanitizeSessionName, getErrorMessage } from '../../core/utils';
import { validateSessionName } from '../../core/validation';
import { AsyncQueue } from '../../core/AsyncQueue';
import { LanesError, GitError, ValidationError } from '../../core/errors';
import { CodeAgent } from '../../core/codeAgents';
import { LocalSettingsPropagationMode } from '../../core/localSettings';
import { addProject } from '../ProjectManagerService';
import { createSessionWorktree } from '../../core/services/SessionCreationService';

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
 * This function validates inputs, handles branch conflict resolution via VS Code UI,
 * delegates worktree creation to core, then opens a terminal.
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

            try {
                vscode.window.showInformationMessage(`Creating session '${trimmedName}'...`);

                const config = vscode.workspace.getConfiguration('lanes');
                const propagationMode = config.get<LocalSettingsPropagationMode>('localSettingsPropagation', 'copy');
                const terminalMode = config.get<string>('terminalMode', 'vscode');

                // 4. Create worktree via core service
                const { worktreePath } = await createSessionWorktree({
                    repoRoot: workspaceRoot,
                    sessionName: trimmedName,
                    sourceBranch,
                    worktreesFolder: getWorktreesFolder(),
                    codeAgent,
                    localSettingsPropagation: propagationMode,
                    terminalMode,
                    onBranchConflict: async (branchName: string) => {
                        const choice = await vscode.window.showQuickPick(
                            [
                                {
                                    label: 'Use existing branch',
                                    description: `Create worktree using the existing '${branchName}' branch`,
                                    action: 'use-existing' as const
                                },
                                {
                                    label: 'Enter new name',
                                    description: 'Choose a different session name',
                                    action: 'new-name' as const
                                }
                            ],
                            {
                                placeHolder: `Branch '${branchName}' already exists. What would you like to do?`,
                                title: 'Branch Already Exists'
                            }
                        );

                        if (!choice) {
                            return 'cancel';
                        }

                        if (choice.action === 'new-name') {
                            // Prompt for new name — handled outside core by re-looping
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
                                    if (trimmed.startsWith('-') || trimmed.startsWith('.') ||
                                        trimmed.endsWith('.') || trimmed.includes('..') ||
                                        trimmed.endsWith('.lock')) {
                                        return "Name cannot start with '-' or '.', end with '.' or '.lock', or contain '..'";
                                    }
                                    return null;
                                }
                            });

                            if (newName) {
                                // Signal the outer loop to retry with new name
                                currentName = newName;
                            }
                            return 'cancel';
                        }

                        return 'use-existing';
                    },
                    onWarning: (msg: string) => {
                        vscode.window.showWarningMessage(msg);
                    },
                });

                // 5. Add worktree as a project in Project Manager
                const repoName = SettingsService.getRepoName(workspaceRoot).replace(/[<>:"/\\|?*]/g, '_');
                const projectName = `${repoName}-${trimmedName}`;
                await addProject(projectName, worktreePath, ['lanes']);

                // 6. Success
                sessionProvider.refresh();

                if (openAgentTerminalImpl) {
                    const assembledPrompt = assembleStartingPrompt(prompt, attachments);
                    await openAgentTerminalImpl(trimmedName, worktreePath, assembledPrompt, permissionMode, workflow, codeAgent, workspaceRoot);
                } else {
                    console.warn('SessionService: openAgentTerminal not injected, session may not open properly');
                }

                vscode.window.showInformationMessage(`Session '${trimmedName}' Ready!`);

                // Exit the loop on success
                return;

            } catch (err) {
                // Check if this is the "new name" cancel from onBranchConflict
                if (err instanceof Error && err.message === 'Session creation cancelled.' && currentName !== name) {
                    // currentName was updated by onBranchConflict — retry with new name
                    continue;
                }

                console.error(err);
                let userMessage = 'Failed to create session.';
                if (err instanceof GitError) {
                    userMessage = err.userMessage;
                } else if (err instanceof ValidationError) {
                    userMessage = err.userMessage;
                } else if (err instanceof LanesError) {
                    userMessage = err.userMessage;
                } else if (err instanceof Error && err.message === 'Session creation cancelled.') {
                    vscode.window.showInformationMessage('Session creation cancelled.');
                    return;
                } else {
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
    getBranchesInWorktrees,
    openAgentTerminalImpl,
    warnedMergeBaseBranches,
};

// Re-export types for convenience
export type { OpenAgentTerminalFn };
