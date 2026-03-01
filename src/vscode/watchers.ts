/**
 * File system watchers for Lanes extension
 *
 * This module sets up all file system watchers that monitor changes to:
 * - Session status and session files (agent-specific file names via CodeAgent)
 * - Prompts directory
 * - Workflows folder
 * - Worktree folders
 * - Pending session requests from MCP
 */

import * as vscode from 'vscode';
import * as path from 'path';

import { ensureDir } from '../core/services/FileService';
import type { ServiceContainer } from '../types/serviceContainer';
import { getStatusWatchPattern, getSessionWatchPattern } from '../core/services/SettingsService';
import { checkPendingSessions, checkClearRequests, getPendingSessionsDir } from './services/SessionProcessService';
import { getWorktreesFolder } from './providers/AgentSessionProvider';
import { getPromptsDir } from './providers/PreviousSessionProvider';

/**
 * Register all file system watchers for the extension.
 *
 * @param context - VS Code extension context for subscriptions
 * @param services - Service container with all dependencies
 * @param refreshWorkflows - Callback to refresh workflow views
 * @param validateWorkflow - Optional function to validate workflows (for pending sessions)
 */
export function registerWatchers(
    context: vscode.ExtensionContext,
    services: ServiceContainer,
    refreshWorkflows: () => Promise<void>,
    validateWorkflow?: any
): void {
    const { sessionProvider, previousSessionProvider, workflowsProvider, workspaceRoot, baseRepoPath, extensionPath, codeAgent } = services;

    // Determine which path to watch (base repo or workspace root)
    const watchPath = baseRepoPath || workspaceRoot;

    // ============================================
    // 1. Watch for status file changes
    // ============================================
    if (watchPath) {
        const statusWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, getStatusWatchPattern())
        );

        // Refresh on any status file change
        statusWatcher.onDidChange(() => sessionProvider.refresh());
        statusWatcher.onDidCreate(() => sessionProvider.refresh());
        statusWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(statusWatcher);

        // ============================================
        // 2. Watch for session file changes
        // ============================================
        const sessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, getSessionWatchPattern())
        );

        sessionWatcher.onDidChange(() => sessionProvider.refresh());
        sessionWatcher.onDidCreate(() => sessionProvider.refresh());
        sessionWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(sessionWatcher);
    }

    // ============================================
    // 3. Watch for changes to the prompts folder
    // ============================================
    if (watchPath) {
        const promptsDirPath = getPromptsDir(watchPath);
        if (promptsDirPath) {
            const promptsWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(promptsDirPath, '*.txt')
            );

            promptsWatcher.onDidChange(() => previousSessionProvider.refresh());
            promptsWatcher.onDidCreate(() => previousSessionProvider.refresh());
            promptsWatcher.onDidDelete(() => previousSessionProvider.refresh());

            context.subscriptions.push(promptsWatcher);
        }
    }

    // ============================================
    // 4. Watch for changes to custom workflows folder
    // ============================================
    if (workspaceRoot) {
        const config = vscode.workspace.getConfiguration('lanes');
        const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.lanes/workflows');
        const customWorkflowsPath = path.join(workspaceRoot, customWorkflowsFolder);

        const workflowsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(customWorkflowsPath, '*.yaml')
        );

        workflowsWatcher.onDidChange(() => refreshWorkflows());
        workflowsWatcher.onDidCreate(() => refreshWorkflows());
        workflowsWatcher.onDidDelete(() => refreshWorkflows());

        context.subscriptions.push(workflowsWatcher);
    }

    // ============================================
    // 5. Watch for worktree folder changes
    // ============================================
    if (watchPath) {
        const worktreesFolder = getWorktreesFolder();
        const worktreeFolderWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, `${worktreesFolder}/*`)
        );

        // When worktrees are added/removed, both views need updating
        worktreeFolderWatcher.onDidCreate(() => {
            sessionProvider.refresh();
            previousSessionProvider.refresh();
        });
        worktreeFolderWatcher.onDidDelete(() => {
            sessionProvider.refresh();
            previousSessionProvider.refresh();
        });

        context.subscriptions.push(worktreeFolderWatcher);
    }

    // ============================================
    // 6. Watch for custom workflows folder changes (duplicate watcher for workflowsProvider)
    // ============================================
    if (watchPath) {
        const customWorkflowsFolder = vscode.workspace.getConfiguration('lanes').get<string>('customWorkflowsFolder', '.lanes/workflows');
        const customWorkflowsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, `${customWorkflowsFolder}/*.yaml`)
        );

        customWorkflowsWatcher.onDidChange(() => workflowsProvider.refresh());
        customWorkflowsWatcher.onDidCreate(() => workflowsProvider.refresh());
        customWorkflowsWatcher.onDidDelete(() => workflowsProvider.refresh());

        context.subscriptions.push(customWorkflowsWatcher);
    }

    // ============================================
    // 7. Watch for pending session requests from MCP
    // ============================================
    if (baseRepoPath) {
        const pendingSessionsDir = getPendingSessionsDir(baseRepoPath);
        // Ensure the directory exists for the watcher (fire-and-forget, watcher will work once dir exists)
        ensureDir(pendingSessionsDir).catch(err => {
            console.warn('Lanes: Failed to create pending sessions directory:', err);
        });

        const pendingSessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(pendingSessionsDir, '*.json')
        );

        pendingSessionWatcher.onDidCreate(async (uri) => {
            console.log(`Pending session file detected: ${uri.fsPath}`);
            await checkPendingSessions(baseRepoPath, extensionPath, sessionProvider, codeAgent, validateWorkflow);
        });

        context.subscriptions.push(pendingSessionWatcher);
    }

    // Check for any pending sessions on startup (outside the if block)
    if (baseRepoPath) {
        // Run asynchronously to not block extension activation
        checkPendingSessions(baseRepoPath, extensionPath, sessionProvider, codeAgent, validateWorkflow).catch(err => {
            console.error('Failed to check pending sessions on startup:', err);
        });
    }

    // ============================================
    // 8. Watch for session clear requests from MCP
    // ============================================
    if (baseRepoPath) {
        const clearRequestsDir = path.join(baseRepoPath, '.lanes', 'clear-requests');
        // Ensure the directory exists for the watcher (fire-and-forget, watcher will work once dir exists)
        ensureDir(clearRequestsDir).catch(err => {
            console.warn('Lanes: Failed to create clear requests directory:', err);
        });

        const clearRequestWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(clearRequestsDir, '*.json')
        );

        clearRequestWatcher.onDidCreate(async (uri) => {
            console.log(`Clear request file detected: ${uri.fsPath}`);
            await checkClearRequests(uri.fsPath, codeAgent, baseRepoPath, sessionProvider, undefined, workspaceRoot);
        });

        context.subscriptions.push(clearRequestWatcher);
    }
}
