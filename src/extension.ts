/**
 * Lanes Extension - Main Entry Point
 *
 * This is the main entry point for the VS Code extension.
 * It initializes all services, providers, commands, and watchers.
 *
 * The extension manages isolated Claude Code sessions using Git worktrees.
 * Each session gets its own worktree and dedicated terminal.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import {
    ClaudeSessionProvider,
    SessionItem,
    getSessionId,
    getSessionChimeEnabled,
    clearSessionId,
    initializeGlobalStorageContext,
    isGlobalStorageEnabled,
    getGlobalStoragePath,
    getRepoIdentifier,
    getWorktreesFolder,
    getWorkflowStatus
} from './ClaudeSessionProvider';

import { SessionFormProvider, PermissionMode } from './SessionFormProvider';
import { initializeGitPath } from './gitService';
import { PreviousSessionProvider } from './PreviousSessionProvider';
import { WorkflowsProvider } from './WorkflowsProvider';

import { clearCache as clearProjectManagerCache, initialize as initializeProjectManagerService } from './ProjectManagerService';
import * as BrokenWorktreeService from './services/BrokenWorktreeService';
import * as SettingsService from './services/SettingsService';
import * as SessionService from './services/SessionService';
import * as TerminalService from './services/TerminalService';
import { getErrorMessage } from './utils';

import { ClaudeCodeAgent, CodeAgent } from './codeAgents';
import type { ServiceContainer } from './types/serviceContainer';

import { registerAllCommands } from './commands';
import { registerWatchers } from './watchers';
import { validateWorkflow as validateWorkflowService } from './services/WorkflowService';
import { createSession } from './services/SessionService';
import { openClaudeTerminal } from './services/TerminalService';

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

    // Inject openClaudeTerminal into SessionService
    // This must be done early, before any session creation calls
    SessionService.setOpenClaudeTerminal(TerminalService.openClaudeTerminal);

    // Initialize git path from VS Code Git Extension (with fallback to 'git')
    await initializeGitPath();

    // Initialize Project Manager service with extension context
    initializeProjectManagerService(context);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    // Debug: Check if we found a workspace
    if (!workspaceRoot) {
        console.error("No workspace detected!");
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

    // Check for and offer to repair broken worktrees (e.g., after container rebuild)
    if (baseRepoPath) {
        // Run asynchronously to not block extension activation
        BrokenWorktreeService.checkAndRepairBrokenWorktrees(baseRepoPath).catch(err => {
            console.error('Lanes: Error checking for broken worktrees:', getErrorMessage(err));
        });
    }

    // Create the global code agent instance
    // This provides agent-specific behavior for terminal commands, file naming, etc.
    const codeAgent = new ClaudeCodeAgent();
    console.log(`Code agent initialized: ${codeAgent.displayName}`);

    // Initialize global storage context for session file storage
    // This must be done before creating the session provider
    initializeGlobalStorageContext(context.globalStorageUri, baseRepoPath, codeAgent, context);
    console.log(`Global storage initialized at: ${context.globalStorageUri.fsPath}`);

    // Initialize Tree Data Provider with the base repo path
    // This ensures sessions are always listed from the main repository
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot, baseRepoPath);
    const sessionTreeView = vscode.window.createTreeView('claudeSessionsView', {
        treeDataProvider: sessionProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(sessionTreeView);
    context.subscriptions.push(sessionProvider);

    // Update chime and workflow context keys when session selection changes
    sessionTreeView.onDidChangeSelection(async (e) => {
        if (e.selection.length > 0) {
            const item = e.selection[0] as SessionItem;
            if (item.worktreePath) {
                const chimeEnabled = await getSessionChimeEnabled(item.worktreePath);
                await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', chimeEnabled);

                // Set workflow context key to show/hide workflow button
                const workflowStatus = await getWorkflowStatus(item.worktreePath);
                await vscode.commands.executeCommand('setContext', 'lanes.hasWorkflow', workflowStatus !== null);
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
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SessionFormProvider.viewType,
            sessionFormProvider
        )
    );

    // Handle form submission - creates a new session with optional prompt and acceptance criteria
    // Use baseRepoPath for creating sessions to ensure worktrees are created in the main repo
    sessionFormProvider.setOnSubmit(async (name: string, prompt: string, acceptanceCriteria: string, sourceBranch: string, permissionMode: PermissionMode, workflow: string | null) => {
        await createSession(name, prompt, acceptanceCriteria, permissionMode, sourceBranch, workflow, baseRepoPath, sessionProvider, codeAgent);
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

    // Initial workflow load
    refreshWorkflows();

    // Create service container for dependency injection
    const services: ServiceContainer = {
        extensionContext: context,
        sessionProvider,
        sessionFormProvider,
        previousSessionProvider,
        workflowsProvider,
        workspaceRoot,
        baseRepoPath,
        extensionPath: context.extensionPath,
        codeAgent
    };

    // Register all file system watchers
    // This includes watchers for status files, session files, prompts, workflows, worktrees, and MCP requests
    registerWatchers(context, services, refreshWorkflows, validateWorkflowService);

    // Listen for configuration changes to update hooks when storage location changes
    // Use a flag to prevent concurrent execution during async operations
    let isUpdatingStorageConfig = false;
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('lanes.useGlobalStorage')) {
            // Prevent concurrent execution
            if (isUpdatingStorageConfig) {
                return;
            }
            isUpdatingStorageConfig = true;

            try {
                // Notify user about the change
                const useGlobal = isGlobalStorageEnabled();
                const message = useGlobal
                    ? 'Lanes: Global storage enabled. New sessions will use global storage for tracking files.'
                    : 'Lanes: Global storage disabled. New sessions will use worktree directories for tracking files.';
                vscode.window.showInformationMessage(message);

                // Offer to update existing worktrees
                if (baseRepoPath) {
                    const worktreesDir = path.join(baseRepoPath, getWorktreesFolder());
                    if (fs.existsSync(worktreesDir)) {
                        const updateExisting = await vscode.window.showQuickPick(
                            [
                                { label: 'Yes', description: 'Update hooks in all existing worktrees' },
                                { label: 'No', description: 'Only apply to new sessions' }
                            ],
                            {
                                placeHolder: 'Would you like to update hooks in existing worktrees?',
                                title: 'Update Existing Sessions'
                            }
                        );

                        if (updateExisting?.label === 'Yes') {
                            try {
                                const worktrees = fs.readdirSync(worktreesDir);
                                let updated = 0;
                                for (const worktree of worktrees) {
                                    const worktreePath = path.join(worktreesDir, worktree);
                                    if (fs.statSync(worktreePath).isDirectory()) {
                                        await SettingsService.getOrCreateExtensionSettingsFile(worktreePath);
                                        updated++;
                                    }
                                }
                                vscode.window.showInformationMessage(`Updated settings files in ${updated} worktree(s).`);
                            } catch (err) {
                                vscode.window.showErrorMessage(`Failed to update some worktrees: ${getErrorMessage(err)}`);
                            }
                        }
                    }
                }

                // Refresh the session provider to reflect any changes
                sessionProvider.refresh();
            } finally {
                isUpdatingStorageConfig = false;
            }
        }
    });

    context.subscriptions.push(configChangeDisposable);

    // Register all commands (session, workflow, repair)
    registerAllCommands(context, services, refreshWorkflows);

    // Auto-resume Claude session when opened in a worktree with an existing session
    if (isInWorktree && workspaceRoot) {
        const sessionData = await getSessionId(workspaceRoot);
        if (sessionData?.sessionId) {
            const sessionName = path.basename(workspaceRoot);
            // Brief delay to ensure VS Code is fully ready
            setTimeout(() => {
                openClaudeTerminal(sessionName, workspaceRoot, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath);
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
}
