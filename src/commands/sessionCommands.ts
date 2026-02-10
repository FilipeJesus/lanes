import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import type { ServiceContainer } from '../types/serviceContainer';
import type { SessionItem } from '../ClaudeSessionProvider';
import type { PreviousSessionItem } from '../PreviousSessionProvider';
import { createSession } from '../services/SessionService';
import { openClaudeTerminal, createTerminalForSession, TERMINAL_CLOSE_DELAY_MS } from '../services/TerminalService';
import * as SettingsService from '../services/SettingsService';
import * as DiffService from '../services/DiffService';
import * as TmuxService from '../services/TmuxService';
import { addProject, removeProject } from '../ProjectManagerService';
import { execGit } from '../gitService';
import { GitChangesPanel } from '../GitChangesPanel';
import { validateBranchName, getErrorMessage } from '../utils';
import { LanesError, GitError, ValidationError } from '../errors';
import { fileExists, ensureDir } from '../services/FileService';
import {
    getSessionChimeEnabled,
    setSessionChimeEnabled,
    clearSessionId,
    isGlobalStorageEnabled,
    getGlobalStoragePath,
    getWorktreesFolder
} from '../ClaudeSessionProvider';

/**
 * Register all session-related commands.
 * Session commands handle creating, opening, deleting, and managing Claude sessions.
 *
 * @param context - VS Code extension context
 * @param services - Service container with all dependencies
 */
export function registerSessionCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer
): void {
    const {
        sessionProvider,
        baseRepoPath,
        codeAgent
    } = services;

    const warnedMergeBaseBranches = new Set<string>();

    /**
     * Helper: Check if branch exists in git
     */
    async function branchExists(branch: string, worktreePath: string): Promise<boolean> {
        try {
            await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], worktreePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Helper: Generate diff content for git changes view
     */
    async function generateDiffContent(worktreePath: string, baseBranch: string): Promise<string> {
        return DiffService.generateDiffContent(worktreePath, baseBranch, warnedMergeBaseBranches as any);
    }

    /**
     * Register the branch change callback for GitChangesPanel
     */
    GitChangesPanel.setOnBranchChange(async (branchName: string, worktreePath: string) => {
        try {
            let actualBranch = branchName.trim();
            const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

            if (!branchNameRegex.test(actualBranch)) {
                vscode.window.showWarningMessage(`Invalid branch name format: '${branchName}'. Using default base branch.`);
                actualBranch = await DiffService.getBaseBranch(worktreePath);
            } else {
                let refExists = false;

                // Check local branch
                try {
                    await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${actualBranch}`], worktreePath);
                    refExists = true;
                } catch {
                    // Not a local branch
                }

                // Check remote branch (exact match)
                if (!refExists) {
                    try {
                        await execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${actualBranch}`], worktreePath);
                        refExists = true;
                    } catch {
                        // Not a remote branch
                    }
                }

                // Check if it's a valid ref (commit, tag, etc.)
                if (!refExists) {
                    try {
                        await execGit(['rev-parse', '--verify', `${actualBranch}^{commit}`], worktreePath);
                        refExists = true;
                    } catch {
                        // Not a valid ref
                    }
                }

                if (!refExists) {
                    vscode.window.showWarningMessage(`Branch '${branchName}' not found. Using default base branch.`);
                    actualBranch = await DiffService.getBaseBranch(worktreePath);
                }
            }

            const diffContent = await generateDiffContent(worktreePath, actualBranch);

            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage(`No changes found when comparing to '${actualBranch}'.`);
                return { diffContent: '', baseBranch: actualBranch };
            }

            return { diffContent, baseBranch: actualBranch };
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to change branch: ${getErrorMessage(err)}`);
            return null;
        }
    });

    // Command: Create a new session
    const createDisposable = vscode.commands.registerCommand('claudeWorktrees.createSession', async () => {
        console.log("Create Session Command Triggered!");

        const name = await vscode.window.showInputBox({
            prompt: "Session Name (creates new branch)",
            placeHolder: "fix-login"
        });

        if (!name) {
            vscode.window.showInformationMessage("Creation cancelled");
            return;
        }

        await createSession(name, '', 'acceptEdits', '', null, [], baseRepoPath, sessionProvider, codeAgent);
    });

    // Command: Open/resume a session
    const openDisposable = vscode.commands.registerCommand('claudeWorktrees.openSession', async (item: SessionItem) => {
        await openClaudeTerminal(item.label, item.worktreePath, undefined, undefined, undefined, codeAgent, baseRepoPath);
    });

    // Command: Delete a session
    const deleteDisposable = vscode.commands.registerCommand('claudeWorktrees.deleteSession', async (item: SessionItem) => {
        const answer = await vscode.window.showWarningMessage(
            `Delete session '${item.label}'?`,
            { modal: true },
            "Delete"
        );
        if (answer !== "Delete") {
            return;
        }

        try {
            // Kill terminal
            const termName = codeAgent ? codeAgent.getTerminalName(item.label) : `Claude: ${item.label}`;
            const terminal = vscode.window.terminals.find(t => t.name === termName);
            if (terminal) {
                terminal.dispose();
            }

            // Kill tmux session if in tmux mode
            if (TmuxService.isTmuxMode()) {
                const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(item.label);
                await TmuxService.killSession(tmuxSessionName);
            }

            // Remove from Project Manager
            await removeProject(item.worktreePath);

            // Remove worktree
            if (baseRepoPath) {
                await execGit(['worktree', 'remove', item.worktreePath, '--force'], baseRepoPath);
            }

            // Clean up global storage files if enabled
            if (isGlobalStorageEnabled()) {
                const globalStoragePath = getGlobalStoragePath(item.worktreePath, '.claude-status');
                if (globalStoragePath) {
                    const sessionStorageDir = path.dirname(globalStoragePath);
                    await fsPromises.rm(sessionStorageDir, { recursive: true, force: true }).catch(() => {
                        // Ignore errors - files may not exist
                    });
                }
            }

            sessionProvider.refresh();
            vscode.window.showInformationMessage(`Deleted session: ${item.label}`);

        } catch (err) {
            let userMessage = 'Failed to delete session.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to delete: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
        }
    });

    // Command: Setup status hooks for a session
    const setupHooksDisposable = vscode.commands.registerCommand('claudeWorktrees.setupStatusHooks', async (item?: SessionItem) => {
        if (!item) {
            vscode.window.showErrorMessage('Please right-click on a session to setup status hooks.');
            return;
        }
        try {
            const settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(item.worktreePath);
            vscode.window.showInformationMessage(`Status hooks configured for '${item.label}' at ${settingsPath}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to setup hooks: ${getErrorMessage(err)}`);
        }
    });

    // Command: Show git changes for a session
    const showGitChangesDisposable = vscode.commands.registerCommand('claudeWorktrees.showGitChanges', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to view git changes.');
            return;
        }

        if (!(await fileExists(item.worktreePath))) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        const branchValidation = validateBranchName(item.label);
        if (!branchValidation.valid) {
            vscode.window.showErrorMessage(branchValidation.error || `Branch '${item.label}' contains invalid characters. Cannot view changes.`);
            return;
        }

        try {
            const baseBranch = await DiffService.getBaseBranch(item.worktreePath);
            const diffContent = await generateDiffContent(item.worktreePath, baseBranch);

            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage(`No changes found when comparing to '${baseBranch}'.`);
                return;
            }

            GitChangesPanel.createOrShow(context.extensionUri, item.label, diffContent, item.worktreePath, baseBranch);
        } catch (err) {
            let userMessage = 'Failed to get git changes.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to get git changes: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
        }
    });

    // Command: Open session in new window
    const openWindowDisposable = vscode.commands.registerCommand('claudeWorktrees.openInNewWindow', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please click on a session to open in new window.');
            return;
        }

        if (!(await fileExists(item.worktreePath))) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        const terminalName = `Claude: ${item.label}`;
        const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);

        if (existingTerminal) {
            const choice = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Transfer session',
                        description: 'Close the terminal here and resume in the new window',
                        action: 'transfer'
                    },
                    {
                        label: 'Open anyway',
                        description: 'Open new window without closing terminal (session will conflict)',
                        action: 'open'
                    }
                ],
                {
                    placeHolder: 'This session has an active Claude terminal. What would you like to do?',
                    title: 'Active Session Detected'
                }
            );

            if (!choice) {
                return;
            }

            if (choice.action === 'transfer') {
                existingTerminal.dispose();
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        try {
            if (baseRepoPath) {
                const repoName = SettingsService.getRepoName(baseRepoPath).replace(/[<>:"/\\|?*]/g, '_');
                const projectName = `${repoName}-${item.label}`;
                await addProject(projectName, item.worktreePath, ['lanes']);
            }

            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(item.worktreePath), true);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open in new window: ${getErrorMessage(err)}`);
        }
    });

    // Command: Open previous session prompt
    const openPreviousPromptDisposable = vscode.commands.registerCommand('claudeWorktrees.openPreviousSessionPrompt', async (item: PreviousSessionItem) => {
        if (!item || !item.promptFilePath) {
            vscode.window.showErrorMessage('Please click on a previous session to view its prompt.');
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(item.promptFilePath);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open prompt file: ${getErrorMessage(err)}`);
        }
    });

    // Command: Enable chime for a session
    const enableChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.enableChime', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to enable chime.');
            return;
        }

        try {
            await setSessionChimeEnabled(item.worktreePath, true);
            await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', true);
            vscode.window.showInformationMessage(`Chime enabled for session '${item.label}'`);
            sessionProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to enable chime: ${getErrorMessage(err)}`);
        }
    });

    // Command: Disable chime for a session
    const disableChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.disableChime', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to disable chime.');
            return;
        }

        try {
            await setSessionChimeEnabled(item.worktreePath, false);
            await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', false);
            vscode.window.showInformationMessage(`Chime disabled for session '${item.label}'`);
            sessionProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to disable chime: ${getErrorMessage(err)}`);
        }
    });

    // Command: Clear session (start fresh)
    const clearSessionDisposable = vscode.commands.registerCommand('claudeWorktrees.clearSession', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to clear it.');
            return;
        }

        try {
            const sessionName = path.basename(item.worktreePath);
            const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

            // Check if the terminal lives in this window
            const existingTerminal = vscode.window.terminals.find(t => t.name === termName);

            if (existingTerminal) {
                // Terminal is in this window — process directly
                await clearSessionId(item.worktreePath);

                existingTerminal.dispose();

                // Kill tmux session if in tmux mode (will be recreated by openClaudeTerminal)
                if (TmuxService.isTmuxMode()) {
                    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(path.basename(item.worktreePath));
                    await TmuxService.killSession(tmuxSessionName);
                }

                await new Promise(resolve => setTimeout(resolve, TERMINAL_CLOSE_DELAY_MS));

                await openClaudeTerminal(sessionName, item.worktreePath, undefined, undefined, undefined, codeAgent, baseRepoPath, true);

                vscode.window.showInformationMessage(`Session '${sessionName}' cleared with fresh context.`);
            } else {
                // Terminal not in this window — write a clear request file
                // for the owning window's file watcher to pick up
                if (!baseRepoPath) {
                    vscode.window.showErrorMessage('Cannot clear session: no base repository path.');
                    return;
                }

                const clearDir = path.join(baseRepoPath, '.lanes', 'clear-requests');
                await ensureDir(clearDir);

                const config = {
                    worktreePath: item.worktreePath,
                    requestedAt: new Date().toISOString()
                };

                const configId = `${sessionName}-${Date.now()}`;
                const configPath = path.join(clearDir, `${configId}.json`);
                await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2));

                vscode.window.showInformationMessage(`Session '${sessionName}' clear request sent. The terminal will restart in its owning window.`);
            }
        } catch (err) {
            let userMessage = 'Failed to clear session.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to clear session: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
        }
    });

    // Command: Create terminal for a session
    const createTerminalDisposable = vscode.commands.registerCommand('claudeWorktrees.createTerminal', async (item: SessionItem) => {
        if (!item) {
            return;
        }

        await createTerminalForSession(item);
    });

    // Command: Search within a worktree
    const searchInWorktreeDisposable = vscode.commands.registerCommand('claudeWorktrees.searchInWorktree', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            return;
        }

        if (!(await fileExists(item.worktreePath))) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        try {
            const worktreesFolder = getWorktreesFolder();
            const sessionName = path.basename(item.worktreePath);
            const filesToInclude = `${worktreesFolder}/${sessionName}/**`;

            await vscode.commands.executeCommand('workbench.action.findInFiles', {
                query: '',
                filesToInclude: filesToInclude,
            });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open search in worktree: ${getErrorMessage(err)}`);
        }
    });

    // Command: Open workflow state for a session
    const openWorkflowStateDisposable = vscode.commands.registerCommand('claudeWorktrees.openWorkflowState', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to open workflow state.');
            return;
        }

        if (!(await fileExists(item.worktreePath))) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        const workflowStatePath = path.join(item.worktreePath, 'workflow-state.json');
        const resolvedPath = path.resolve(workflowStatePath);
        const resolvedWorktreePath = path.resolve(item.worktreePath);

        if (!resolvedPath.startsWith(resolvedWorktreePath)) {
            vscode.window.showErrorMessage('Invalid workflow state path');
            return;
        }

        try {
            if (!(await fileExists(workflowStatePath))) {
                vscode.window.showInformationMessage(`No active workflow for session '${item.label}'. The workflow state file is created when a workflow is started.`);
                return;
            }

            const document = await vscode.workspace.openTextDocument(workflowStatePath);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open workflow state: ${getErrorMessage(err)}`);
        }
    });

    // Command: Play chime sound (internal)
    const playChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.playChime', () => {
        services.sessionFormProvider.playChime();
    });

    // Command: Test chime sound (for debugging)
    const testChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.testChime', async () => {
        try {
            services.sessionFormProvider.playChime();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to test chime: ${getErrorMessage(err)}`);
        }
    });

    // Register all disposables
    const disposables = [
        createDisposable,
        openDisposable,
        deleteDisposable,
        setupHooksDisposable,
        showGitChangesDisposable,
        openWindowDisposable,
        openPreviousPromptDisposable,
        enableChimeDisposable,
        disableChimeDisposable,
        clearSessionDisposable,
        createTerminalDisposable,
        searchInWorktreeDisposable,
        openWorkflowStateDisposable,
        playChimeDisposable,
        testChimeDisposable
    ];

    disposables.forEach(d => context.subscriptions.push(d));
}
