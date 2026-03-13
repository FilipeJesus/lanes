/**
 * Lanes Extension - Main Entry Point
 *
 * This is the main entry point for the VS Code extension.
 * It initializes all services, providers, commands, and watchers.
 *
 * The extension manages isolated AI agent sessions using Git worktrees.
 * Each session gets its own worktree and dedicated terminal.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';

import { fileExists, readDir, isDirectory } from '../core/services/FileService';

import {
    AgentSessionProvider,
    SessionItem,
    getSessionId,
    clearSessionId,
    initializeGlobalStorageContext,
    getWorktreesFolder,
} from './providers/AgentSessionProvider';

import { SessionFormProvider, PermissionMode } from './providers/SessionFormProvider';
import { initializeGitPath } from '../gitService';
import { PreviousSessionProvider } from './providers/PreviousSessionProvider';
import { WorkflowsProvider } from './providers/WorkflowsProvider';

import { clearCache as clearProjectManagerCache, initialize as initializeProjectManagerService } from './ProjectManagerService';
import * as BrokenWorktreeService from '../core/services/BrokenWorktreeService';
import * as SettingsService from '../core/services/SettingsService';
import * as SessionService from './services/SessionService';
import * as TerminalService from './services/TerminalService';
import { disposeAll as disposeAllPolling } from './services/PollingStatusService';
import { getErrorMessage } from '../core/utils';

import { CodeAgent, getDefaultAgent, getAgent, isCliAvailable, DEFAULT_AGENT_NAME } from '../core/codeAgents';
import type { ServiceContainer } from '../types/serviceContainer';

import { registerAllCommands } from './commands';
import { registerWatchers } from './watchers';
import { validateWorkflow as validateWorkflowService } from '../core/services/WorkflowService';
import { createSession } from './services/SessionService';
import { openAgentTerminal, openDaemonSessionTerminal } from './services/TerminalService';
import { VscodeConfigProvider } from './adapters/VscodeConfigProvider';
import { DaemonService } from './services/DaemonService';
import { resolveWorkspaceSupport } from './workspaceSupport';
import { getDaemonLogPath } from '../daemon/lifecycle';

/**
 * Activate the extension.
 *
 * This is the main entry point called by VS Code when the extension is activated.
 * It initializes all services, providers, commands, and watchers.
 *
 * @param context - VS Code extension context
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('Congratulations, "Lanes" is now active!');

    // Inject openAgentTerminal into SessionService
    // This must be done early, before any session creation calls
    SessionService.setOpenAgentTerminal(TerminalService.openAgentTerminal);

    // Register hookless terminal tracking (terminal close -> idle status)
    TerminalService.registerHooklessTerminalTracking(context);

    // Initialize git path from VS Code Git Extension (with fallback to 'git')
    await initializeGitPath();

    // Initialize Project Manager service with extension context
    initializeProjectManagerService(context);

    const workspaceSupport = resolveWorkspaceSupport();
    const workspaceRoot = workspaceSupport.workspaceRoot;

    if (workspaceSupport.warningMessage) {
        vscode.window.showWarningMessage(workspaceSupport.warningMessage);
    }

    // Debug: Check if we found a supported workspace
    if (!workspaceRoot) {
        console.error(`Lanes: ${workspaceSupport.requirementMessage}`);
    } else {
        console.log(`Workspace detected: ${workspaceRoot}`);
    }

    // Detect if we're in a worktree and resolve the base repository path
    // This ensures sessions are listed from the main repo even when opened in a worktree
    const baseRepoPath = workspaceRoot ? await SettingsService.getBaseRepoPath(workspaceRoot) : undefined;

    // Track if we're in a worktree - we'll use this to auto-resume session after setup
    const isInWorktree = baseRepoPath && baseRepoPath !== workspaceRoot;

    if (isInWorktree) {
        console.log(`Running in worktree. Base repo: ${baseRepoPath}`);
    }

    // Initialize the unified settings bridge.
    // This ensures VS Code settings changes are written to .lanes/settings.yaml
    // so that CLI and JetBrains adapters see the same configuration.
    let configProvider = new VscodeConfigProvider();
    if (baseRepoPath) {
        try {
            await configProvider.initialize(baseRepoPath);
        } catch (err) {
            console.error('Lanes: Failed to initialize settings bridge:', getErrorMessage(err));
        }
    }
    context.subscriptions.push({ dispose: () => configProvider.dispose() });

    // Check for and offer to repair broken worktrees (e.g., after container rebuild)
    if (baseRepoPath) {
        // Run asynchronously to not block extension activation
        (async () => {
            try {
                const brokenWorktrees = await BrokenWorktreeService.detectBrokenWorktrees(baseRepoPath, getWorktreesFolder());

                if (brokenWorktrees.length === 0) {
                    return;
                }

                const sessionNames = brokenWorktrees.map(w => w.sessionName).join(', ');
                const count = brokenWorktrees.length;
                const plural = count > 1 ? 's' : '';

                const answer = await vscode.window.showWarningMessage(
                    `Found ${count} broken worktree${plural}: ${sessionNames}. This can happen after a container rebuild. Would you like to repair them?`,
                    'Repair',
                    'Ignore'
                );

                if (answer !== 'Repair') {
                    return;
                }

                const result = await BrokenWorktreeService.repairBrokenWorktrees(baseRepoPath, brokenWorktrees);

                if (result.failures.length === 0) {
                    vscode.window.showInformationMessage(
                        `Successfully repaired ${result.successCount} worktree${result.successCount > 1 ? 's' : ''}.`
                    );
                } else if (result.successCount > 0) {
                    vscode.window.showWarningMessage(
                        `Repaired ${result.successCount} worktree${result.successCount > 1 ? 's' : ''}, but ${result.failures.length} failed. Check the console for details.`
                    );
                    console.error('Lanes: Failed to repair some worktrees:', result.failures.map(f => `${f.sessionName}: ${f.error}`));
                } else {
                    vscode.window.showErrorMessage(
                        `Failed to repair worktrees. Check the console for details.`
                    );
                    console.error('Lanes: Failed to repair worktrees:', result.failures.map(f => `${f.sessionName}: ${f.error}`));
                }
            } catch (err) {
                console.error('Lanes: Error checking for broken worktrees:', getErrorMessage(err));
            }
        })();
    }

    // Read the useDaemon flag early so we know whether to set up DaemonService
    const useDaemon = vscode.workspace.getConfiguration('lanes').get<boolean>('useDaemon', false);

    // Create the global code agent instance using the factory
    // Reads lanes.defaultAgent setting and creates the appropriate agent
    // CLI availability is checked lazily at session creation time, not here.
    const defaultAgentResult = getDefaultAgent(vscode.workspace.getConfiguration('lanes').get<string>('defaultAgent', DEFAULT_AGENT_NAME));
    if (defaultAgentResult.warning) {
        vscode.window.showWarningMessage(defaultAgentResult.warning);
    }
    const defaultAgentName = defaultAgentResult.agent;
    const codeAgent: CodeAgent = getAgent(defaultAgentName) || getAgent(DEFAULT_AGENT_NAME)!;
    console.log(`Code agent initialized: ${codeAgent.displayName} (${codeAgent.name})`);

    // Initialize global storage context for session file storage
    // This must be done before creating the session provider
    initializeGlobalStorageContext(context.globalStorageUri, baseRepoPath, codeAgent, context, configProvider);
    console.log(`Global storage initialized at: ${context.globalStorageUri.fsPath}`);

    // Initialize Tree Data Provider with the base repo path
    // This ensures sessions are always listed from the main repository
    const sessionProvider = new AgentSessionProvider(workspaceRoot, baseRepoPath, codeAgent, context);
    sessionProvider.setDaemonModeEnabled(useDaemon);
    const sessionTreeView = vscode.window.createTreeView('lanesSessionsView', {
        treeDataProvider: sessionProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(sessionTreeView);
    context.subscriptions.push(sessionProvider);

    // Initialize daemon service if lanes.useDaemon is enabled
    let daemonService: DaemonService | undefined;
    if (useDaemon && baseRepoPath) {
        daemonService = new DaemonService(baseRepoPath, context.extensionPath, () => sessionProvider.refresh());
        try {
            await daemonService.initialize();
            // Wire daemon client into the session tree provider
            if (daemonService.isEnabled()) {
                sessionProvider.setDaemonClient(daemonService.getClient());
                sessionProvider.refresh();
            } else {
                const daemonError = daemonService.getLastError();
                if (daemonError) {
                    void showDaemonUnavailableMessage(daemonError);
                }
            }
        } catch (err) {
            console.error('Lanes: Failed to initialize daemon service:', getErrorMessage(err));
            void showDaemonUnavailableMessage(getErrorMessage(err));
            daemonService = undefined;
        }
    }

    // Update chime and workflow context keys when session selection changes
    sessionTreeView.onDidChangeSelection(async (e) => {
        if (e.selection.length > 0) {
            const item = e.selection[0] as SessionItem;
            if (item.worktreePath) {
                await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', item.chimeEnabled);
                await vscode.commands.executeCommand('setContext', 'lanes.hasWorkflow', item.workflowStatus !== null);
            }
        }
    });

    // Initialize Previous Sessions Provider
    const previousSessionProvider = new PreviousSessionProvider(workspaceRoot, baseRepoPath);
    vscode.window.registerTreeDataProvider('previousSessionsView', previousSessionProvider);
    context.subscriptions.push(previousSessionProvider);

    // Initialize Workflows Provider
    const workflowsProvider = new WorkflowsProvider(context.extensionPath, workspaceRoot);
    vscode.window.registerTreeDataProvider('workflowsView', workflowsProvider);
    context.subscriptions.push(workflowsProvider);

    // Initialize Session Form Provider (webview in sidebar)
    const sessionFormProvider = new SessionFormProvider(context.extensionUri);
    sessionFormProvider.setWorkspaceRestrictionMessage(
        workspaceSupport.isSupported ? undefined : workspaceSupport.requirementMessage
    );
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SessionFormProvider.viewType,
            sessionFormProvider,
            { webviewOptions: { retainContextWhenHidden: true } }
        )
    );

    const getActiveDaemonClient = () => daemonService?.getClient();

    // Set default agent for the form dropdown
    sessionFormProvider.setDefaultAgent(defaultAgentName);

    // Handle form submission - creates a new session with optional prompt
    // Use baseRepoPath for creating sessions to ensure worktrees are created in the main repo
    sessionFormProvider.setOnSubmit(async (name: string, agent: string, prompt: string, sourceBranch: string, permissionMode: PermissionMode, workflow: string | null, attachments: string[]) => {
        if (!services.workspaceSupport.isSupported) {
            vscode.window.showErrorMessage(services.workspaceSupport.requirementMessage);
            throw new Error(services.workspaceSupport.requirementMessage);
        }

        // Resolve agent name to CodeAgent instance
        const selectedAgent = getAgent(agent) || codeAgent;

        // Validate CLI availability at session creation time (not during activation)
        const cliAvailable = await isCliAvailable(selectedAgent.cliCommand);
        if (!cliAvailable) {
            vscode.window.showErrorMessage(
                `${selectedAgent.displayName} CLI ('${selectedAgent.cliCommand}') is not installed. ` +
                `Please install it or select a different agent from the dropdown.\n` +
                `Tip: You can change the default agent in Settings > Lanes > Default Agent.`
            );
            throw new Error(`CLI not available`);
        }

        if (services.daemonModeEnabled) {
            const daemonClient = getActiveDaemonClient();
            if (!daemonClient) {
                vscode.window.showErrorMessage(
                    'Lanes daemon mode is enabled, but the daemon is unavailable. ' +
                    'Reload the window after fixing daemon startup, or disable "Lanes: Use Daemon".'
                );
                throw new Error('Daemon mode enabled but daemon client is unavailable');
            }

            const result = await daemonClient.createSession({
                name,
                agent: selectedAgent.name,
                prompt,
                sourceBranch,
                permissionMode,
                workflow,
                attachments,
            });
            sessionProvider.refresh();
            await openDaemonSessionTerminal(result.sessionName, result.worktreePath, result, selectedAgent);
            return;
        }

        await createSession(
            name,
            prompt,
            permissionMode,
            sourceBranch,
            workflow,
            attachments,
            services.baseRepoPath,
            sessionProvider,
            selectedAgent,
            services.workspaceSupport.requirementMessage
        );
    });

    // Handle auto-prompt request - improve prompt using the selected agent
    sessionFormProvider.setOnAutoPrompt(async (prompt: string, agentName: string) => {
        const agent = getAgent(agentName) || codeAgent;
        const result = agent.buildPromptImproveCommand(prompt);
        if (!result) {
            throw new Error(`${agent.displayName} does not support prompt improvement`);
        }
        const { command, args } = result;

        return new Promise<string>((resolve, reject) => {
            const child = execFile(command, args, {
                timeout: 60000,
                maxBuffer: 1024 * 1024
            }, (error, stdout) => {
                if (error) {
                    const execError = error as { killed?: boolean; signal?: string };
                    if (execError.killed || execError.signal === 'SIGTERM') {
                        reject(new Error('Agent command timed out'));
                    } else {
                        reject(new Error(`Agent command failed: ${error.message}`));
                    }
                    return;
                }

                const result = stdout.trim();
                if (!result) {
                    reject(new Error('Agent returned empty response'));
                    return;
                }

                resolve(result);
            });

            // Close stdin so the CLI doesn't hang waiting for piped input
            child.stdin?.end();
        });
    });

    // Helper function to refresh workflows in both the tree view and the session form
    async function refreshWorkflows(): Promise<void> {
        workflowsProvider.refresh();
        // Wait for the tree to update, then get the workflows
        // We need to trigger getChildren to populate the workflows list
        await workflowsProvider.getChildren();
        const workflows = workflowsProvider.getWorkflows();
        sessionFormProvider.updateWorkflows(workflows);
    }

    // Register callback for refresh workflows button in session form
    sessionFormProvider.setOnRefreshWorkflows(async () => {
        await refreshWorkflows();
    });

    // Create service container for dependency injection
    const services: ServiceContainer = {
        extensionContext: context,
        sessionProvider,
        sessionFormProvider,
        previousSessionProvider,
        workflowsProvider,
        workspaceRoot,
        baseRepoPath,
        workspaceSupport,
        extensionPath: context.extensionPath,
        codeAgent,
        daemonModeEnabled: useDaemon,
        daemonClient: daemonService?.getClient()
    };

    let watcherRegistration: vscode.Disposable | undefined;
    context.subscriptions.push({
        dispose: () => {
            watcherRegistration?.dispose();
        }
    });
    context.subscriptions.push({
        dispose: () => {
            daemonService?.dispose();
        }
    });

    async function reinitializeConfigProvider(repoPath: string | undefined): Promise<void> {
        configProvider.dispose();
        configProvider = new VscodeConfigProvider();
        if (repoPath) {
            try {
                await configProvider.initialize(repoPath);
            } catch (err) {
                console.error('Lanes: Failed to initialize settings bridge:', getErrorMessage(err));
            }
        }
        initializeGlobalStorageContext(context.globalStorageUri, repoPath, codeAgent, context, configProvider);
    }

    async function resetDaemonService(): Promise<void> {
        daemonService?.dispose();
        daemonService = undefined;
        services.daemonClient = undefined;
        sessionProvider.setDaemonClient(undefined);

        const daemonEnabled = vscode.workspace.getConfiguration('lanes').get<boolean>('useDaemon', false);
        if (!daemonEnabled || !services.baseRepoPath) {
            return;
        }

        const nextDaemonService = new DaemonService(
            services.baseRepoPath,
            context.extensionPath,
            () => sessionProvider.refresh()
        );
        try {
            await Promise.race([
                nextDaemonService.initialize(),
                new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Daemon initialization timed out')), 5000))
            ]);
            if (nextDaemonService.isEnabled()) {
                daemonService = nextDaemonService;
                services.daemonClient = nextDaemonService.getClient();
                sessionProvider.setDaemonClient(services.daemonClient);
                sessionProvider.refresh();
            }
        } catch (err) {
            const message = `Lanes daemon mode is enabled, but startup failed: ${getErrorMessage(err)}`;
            console.error(message);
            void vscode.window.showErrorMessage(
                `${message}. Check ${getDaemonLogPath()} and reload the window after fixing it, or disable "Lanes: Use Daemon".`
            );
        }
    }

    function resetWatchers(): void {
        watcherRegistration?.dispose();
        watcherRegistration = registerWatchers(services, refreshWorkflows, validateWorkflowService);
    }

    let workspaceRefreshCounter = 0;
    async function refreshWorkspaceState(options?: { showWarning?: boolean }): Promise<void> {
        const refreshId = ++workspaceRefreshCounter;
        const nextWorkspaceSupport = resolveWorkspaceSupport();
        const nextWorkspaceRoot = nextWorkspaceSupport.workspaceRoot;
        const nextBaseRepoPath = nextWorkspaceRoot
            ? await SettingsService.getBaseRepoPath(nextWorkspaceRoot)
            : undefined;

        if (refreshId !== workspaceRefreshCounter) {
            return;
        }

        services.workspaceSupport = nextWorkspaceSupport;
        services.workspaceRoot = nextWorkspaceRoot;
        services.baseRepoPath = nextBaseRepoPath;

        if (options?.showWarning && nextWorkspaceSupport.warningMessage) {
            vscode.window.showWarningMessage(nextWorkspaceSupport.warningMessage);
        }

        if (!nextWorkspaceRoot) {
            console.error(`Lanes: ${nextWorkspaceSupport.requirementMessage}`);
        } else {
            console.log(`Workspace detected: ${nextWorkspaceRoot}`);
        }

        sessionProvider.updateRoots(nextWorkspaceRoot, nextBaseRepoPath);
        previousSessionProvider.updateRoots(nextWorkspaceRoot, nextBaseRepoPath);
        workflowsProvider.updateWorkspaceRoot(nextWorkspaceRoot);
        sessionFormProvider.setWorkspaceRestrictionMessage(
            nextWorkspaceSupport.isSupported ? undefined : nextWorkspaceSupport.requirementMessage
        );

        await reinitializeConfigProvider(nextBaseRepoPath);
        await resetDaemonService();
        resetWatchers();
        await refreshWorkflows();
        sessionProvider.refresh();
        previousSessionProvider.refresh();
        workflowsProvider.refresh();
    }

    // Initial workflow load and watcher setup
    await refreshWorkflows();
    resetWatchers();

    // Listen for configuration changes
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('lanes.defaultAgent')) {
            const newAgentResult = getDefaultAgent(vscode.workspace.getConfiguration('lanes').get<string>('defaultAgent', DEFAULT_AGENT_NAME));
            if (newAgentResult.warning) {
                vscode.window.showWarningMessage(newAgentResult.warning);
            }
            sessionFormProvider.setDefaultAgent(newAgentResult.agent);
        }
        if (event.affectsConfiguration('lanes.useDaemon')) {
            vscode.window.showInformationMessage(
                'Lanes: The "Use Daemon" setting change will take effect after reloading the window.',
                'Reload Window'
            ).then(selection => {
                if (selection === 'Reload Window') {
                    void vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        }
    });

    context.subscriptions.push(configChangeDisposable);
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            void refreshWorkspaceState({ showWarning: true });
        })
    );

    // Register all commands (session, workflow, repair)
    registerAllCommands(context, services, refreshWorkflows);

    // Backward-compatible aliases (remove in next release)
    const aliasMap: Record<string, string> = {
        'claudeWorktrees.createSession': 'lanes.createSession',
        'claudeWorktrees.deleteSession': 'lanes.deleteSession',
        'claudeWorktrees.openSession': 'lanes.openSession',
        'claudeWorktrees.setupStatusHooks': 'lanes.setupStatusHooks',
        'claudeWorktrees.showGitChanges': 'lanes.showGitChanges',
        'claudeWorktrees.openInNewWindow': 'lanes.openInNewWindow',
        'claudeWorktrees.openPreviousSessionPrompt': 'lanes.openPreviousSessionPrompt',
        'claudeWorktrees.enableChime': 'lanes.enableChime',
        'claudeWorktrees.disableChime': 'lanes.disableChime',
        'claudeWorktrees.testChime': 'lanes.testChime',
        'claudeWorktrees.clearSession': 'lanes.clearSession',
        'claudeWorktrees.createTerminal': 'lanes.createTerminal',
        'claudeWorktrees.searchInWorktree': 'lanes.searchInWorktree',
        'claudeWorktrees.openWorkflowState': 'lanes.openWorkflowState',
        'claudeWorktrees.playChime': 'lanes.playChime',
    };
    for (const [oldId, newId] of Object.entries(aliasMap)) {
        context.subscriptions.push(
            vscode.commands.registerCommand(oldId, (...args: unknown[]) =>
                vscode.commands.executeCommand(newId, ...args)
            )
        );
    }

    // Auto-resume session when opened in a worktree with an existing session
    if (isInWorktree && workspaceRoot) {
        const sessionData = await getSessionId(workspaceRoot);
        if (sessionData?.sessionId) {
            const sessionName = path.basename(workspaceRoot);
            const resumeAgent = (sessionData.agentName ? getAgent(sessionData.agentName) : null) || codeAgent;
            // Brief delay to ensure VS Code is fully ready
            setTimeout(() => {
                openAgentTerminal(sessionName, workspaceRoot, undefined, undefined, undefined, resumeAgent, baseRepoPath);
            }, 500);
        }
    }

    // Initial refresh to ensure tree view shows current state after activation/reload
    sessionProvider.refresh();
}

/**
 * Deactivate the extension.
 *
 * VS Code handles cleanup of subscriptions automatically,
 * but we also clear cached references to other extensions.
 */
export function deactivate(): void {
    // Clear Project Manager cache to avoid stale references
    clearProjectManagerCache();
    // Dispose all active polling trackers for hookless agents
    disposeAllPolling();
}

async function showDaemonUnavailableMessage(details: string): Promise<void> {
    const selection = await vscode.window.showWarningMessage(
        `Lanes daemon unavailable; using local mode. ${details}`,
        'Open Log'
    );

    if (selection !== 'Open Log') {
        return;
    }

    try {
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(getDaemonLogPath()));
        await vscode.window.showTextDocument(document, { preview: false });
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to open daemon log: ${getErrorMessage(err)}`);
    }
}
