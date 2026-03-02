import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import type { ServiceContainer } from '../../types/serviceContainer';
import type { SessionItem } from '../providers/AgentSessionProvider';
import type { PreviousSessionItem } from '../providers/PreviousSessionProvider';
import { createSession } from '../services/SessionService';
import { openAgentTerminal, createTerminalForSession, TERMINAL_CLOSE_DELAY_MS } from '../services/TerminalService';
import * as SettingsService from '../../core/services/SettingsService';
import * as DiffService from '../../core/services/DiffService';
import * as TmuxService from '../../core/services/TmuxService';
import { addProject, removeProject } from '../ProjectManagerService';
import { execGit } from '../../gitService';
import { GitChangesPanel } from '../providers/GitChangesPanel';
import { validateBranchName, getErrorMessage } from '../../core/utils';
import { LanesError, GitError, ValidationError } from '../../core/errors';
import { fileExists, ensureDir } from '../../core/services/FileService';
import { generateInsights, formatInsightsReport } from '../../core/services/InsightsService';
import { analyzeInsights } from '../../core/services/InsightsAnalyzer';
import {
    getSessionChimeEnabled,
    setSessionChimeEnabled,
    clearSessionId,
    getSettingsDir,
    getWorktreesFolder,
    getSessionTerminalMode,
    getSessionAgentName
} from '../providers/AgentSessionProvider';
import { getAgent } from '../../core/codeAgents';

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
        const config = vscode.workspace.getConfiguration('lanes');
        return DiffService.generateDiffContent(worktreePath, baseBranch, warnedMergeBaseBranches as any, {
            includeUncommitted: config.get<boolean>('includeUncommittedChanges', true),
            onWarning: (msg) => vscode.window.showWarningMessage(msg),
        });
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
                actualBranch = await DiffService.getBaseBranch(worktreePath, vscode.workspace.getConfiguration('lanes').get<string>('baseBranch', ''));
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
                    actualBranch = await DiffService.getBaseBranch(worktreePath, vscode.workspace.getConfiguration('lanes').get<string>('baseBranch', ''));
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
    const createDisposable = vscode.commands.registerCommand('lanes.createSession', async () => {
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
    const openDisposable = vscode.commands.registerCommand('lanes.openSession', async (item: SessionItem) => {
        const agentName = await getSessionAgentName(item.worktreePath);
        const sessionAgent = getAgent(agentName) || codeAgent;
        await openAgentTerminal(item.label, item.worktreePath, undefined, undefined, undefined, sessionAgent, baseRepoPath);
    });

    // Command: Delete a session
    const deleteDisposable = vscode.commands.registerCommand('lanes.deleteSession', async (item: SessionItem) => {
        const answer = await vscode.window.showWarningMessage(
            `Delete session '${item.label}'?`,
            { modal: true },
            "Delete"
        );
        if (answer !== "Delete") {
            return;
        }

        try {
            // Kill terminal — resolve agent from session to find correct terminal name
            const deleteAgentName = await getSessionAgentName(item.worktreePath);
            const deleteAgent = getAgent(deleteAgentName) || codeAgent;
            const termName = deleteAgent ? deleteAgent.getTerminalName(item.label) : `Claude: ${item.label}`;
            const terminal = vscode.window.terminals.find(t => t.name === termName);
            if (terminal) {
                terminal.dispose();
            }

            // Kill tmux session if this session used tmux
            if ((await getSessionTerminalMode(item.worktreePath)) === 'tmux') {
                const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(item.label);
                await TmuxService.killSession(tmuxSessionName);
            }

            // Remove from Project Manager
            await removeProject(item.worktreePath);

            // Remove worktree
            if (baseRepoPath) {
                await execGit(['worktree', 'remove', item.worktreePath, '--force'], baseRepoPath);
            }

            // Clean up repo-local settings files
            {
                const settingsDir = getSettingsDir(item.worktreePath);
                await fsPromises.rm(settingsDir, { recursive: true, force: true }).catch(() => {
                    // Ignore errors - files may not exist
                });
            }

            // Clean up pin state for the deleted session
            await sessionProvider.unpinSession(item.worktreePath);

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
    const setupHooksDisposable = vscode.commands.registerCommand('lanes.setupStatusHooks', async (item?: SessionItem) => {
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
    const showGitChangesDisposable = vscode.commands.registerCommand('lanes.showGitChanges', async (item: SessionItem) => {
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
            const baseBranch = await DiffService.getBaseBranch(item.worktreePath, vscode.workspace.getConfiguration('lanes').get<string>('baseBranch', ''));
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
    const openWindowDisposable = vscode.commands.registerCommand('lanes.openInNewWindow', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please click on a session to open in new window.');
            return;
        }

        if (!(await fileExists(item.worktreePath))) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        const terminalName = codeAgent ? codeAgent.getTerminalName(item.label) : `Claude: ${item.label}`;
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
    const openPreviousPromptDisposable = vscode.commands.registerCommand('lanes.openPreviousSessionPrompt', async (item: PreviousSessionItem) => {
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
    const enableChimeDisposable = vscode.commands.registerCommand('lanes.enableChime', async (item: SessionItem) => {
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
    const disableChimeDisposable = vscode.commands.registerCommand('lanes.disableChime', async (item: SessionItem) => {
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
    const clearSessionDisposable = vscode.commands.registerCommand('lanes.clearSession', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to clear it.');
            return;
        }

        try {
            const sessionName = path.basename(item.worktreePath);
            const clearAgentName = await getSessionAgentName(item.worktreePath);
            const clearAgent = getAgent(clearAgentName) || codeAgent;
            const termName = clearAgent ? clearAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

            // Check if the terminal lives in this window
            const existingTerminal = vscode.window.terminals.find(t => t.name === termName);

            if (existingTerminal) {
                // Terminal is in this window — process directly
                await clearSessionId(item.worktreePath);

                existingTerminal.dispose();

                // Kill tmux session if this session used tmux (will be recreated by openClaudeTerminal)
                if ((await getSessionTerminalMode(item.worktreePath)) === 'tmux') {
                    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(path.basename(item.worktreePath));
                    await TmuxService.killSession(tmuxSessionName);
                }

                await new Promise(resolve => setTimeout(resolve, TERMINAL_CLOSE_DELAY_MS));

                await openAgentTerminal(sessionName, item.worktreePath, undefined, undefined, undefined, clearAgent, baseRepoPath, true);

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
    const createTerminalDisposable = vscode.commands.registerCommand('lanes.createTerminal', async (item: SessionItem) => {
        if (!item) {
            return;
        }

        await createTerminalForSession(item);
    });

    // Command: Search within a worktree
    const searchInWorktreeDisposable = vscode.commands.registerCommand('lanes.searchInWorktree', async (item: SessionItem) => {
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
    const openWorkflowStateDisposable = vscode.commands.registerCommand('lanes.openWorkflowState', async (item: SessionItem) => {
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
    const playChimeDisposable = vscode.commands.registerCommand('lanes.playChime', () => {
        services.sessionFormProvider.playChime();
    });

    // Command: Test chime sound (for debugging)
    const testChimeDisposable = vscode.commands.registerCommand('lanes.testChime', async () => {
        try {
            services.sessionFormProvider.playChime();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to test chime: ${getErrorMessage(err)}`);
        }
    });

    // Command: Generate insights for a session
    const generateInsightsDisposable = vscode.commands.registerCommand('lanes.generateInsights', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to generate insights.');
            return;
        }

        const agentName = await getSessionAgentName(item.worktreePath);
        const agent = getAgent(agentName);
        if (!agent?.supportsFeature('insights')) {
            vscode.window.showInformationMessage(`Insights are not supported by ${agent?.displayName ?? agentName}.`);
            return;
        }

        try {
            const insights = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Generating insights...' },
                () => generateInsights(item.worktreePath)
            );

            if (insights.sessionCount === 0) {
                vscode.window.showInformationMessage(`No conversation data found for session '${item.label}'.`);
                return;
            }

            const analysis = analyzeInsights(insights);
            const report = formatInsightsReport(item.label, insights, analysis);
            const document = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to generate insights: ${getErrorMessage(err)}`);
        }
    });

    // Command: Pin a session
    const pinSessionDisposable = vscode.commands.registerCommand('lanes.pinSession', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to pin.');
            return;
        }

        try {
            await sessionProvider.pinSession(item.worktreePath);
            sessionProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to pin session: ${getErrorMessage(err)}`);
        }
    });

    // Command: Unpin a session
    const unpinSessionDisposable = vscode.commands.registerCommand('lanes.unpinSession', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to unpin.');
            return;
        }

        try {
            await sessionProvider.unpinSession(item.worktreePath);
            sessionProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to unpin session: ${getErrorMessage(err)}`);
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
        testChimeDisposable,
        generateInsightsDisposable,
        pinSessionDisposable,
        unpinSessionDisposable
    ];

    // Demo automation command: fill the session form programmatically
    const demoFillFormDisposable = vscode.commands.registerCommand(
        'lanes.demoFillForm',
        (args?: { name?: string; prompt?: string; sourceBranch?: string; agent?: string; workflow?: string; autoSubmit?: boolean }) => {
            if (args) {
                services.sessionFormProvider.fillForm(args);
            }
        }
    );
    disposables.push(demoFillFormDisposable);

    disposables.forEach(d => context.subscriptions.push(d));
}
