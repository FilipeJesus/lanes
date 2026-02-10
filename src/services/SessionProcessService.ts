/**
 * SessionProcessService - MCP pending session request processing
 *
 * This service handles the processing of session requests from the MCP server.
 * The MCP server writes JSON config files to .lanes/pending-sessions/ and .lanes/clear-requests/,
 * which are then processed by this service.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';

import { fileExists } from './FileService';
import type { PendingSessionConfig } from '../types/extension';
import type { ClearSessionConfig } from '../types/extension';
import { ClaudeSessionProvider, getSessionTerminalMode } from '../ClaudeSessionProvider';
import { CodeAgent } from '../codeAgents';
import { getErrorMessage } from '../utils';
import { createSession as createSessionService } from './SessionService';
import { openClaudeTerminal as openClaudeTerminalService } from './TerminalService';
import * as TmuxService from './TmuxService';

// validateWorkflow still comes from extension.ts (WorkflowService extraction was in 07-02)
let validateWorkflow: any = null;

/**
 * Get the directory where MCP server writes pending session requests.
 * Uses the workspace's .lanes directory instead of the home directory.
 * @param repoRoot The root directory of the repository
 * @returns The path to the pending sessions directory
 */
export function getPendingSessionsDir(repoRoot: string): string {
    return path.join(repoRoot, '.lanes', 'pending-sessions');
}

/**
 * Process a pending session request from the MCP server.
 * Creates the session and opens the terminal, then deletes the config file.
 */
export async function processPendingSession(
    configPath: string,
    workspaceRoot: string | undefined,
    extensionPath: string,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent,
    // Internal functions from extension (temporary - validateWorkflow still from extension)
    validateWorkflowFn?: any
): Promise<void> {
    if (!workspaceRoot) {
        console.error('Cannot process pending session: no workspace root');
        return;
    }

    // Use passed validateWorkflow function or fall back to parameter
    const validateWorkflowImpl = validateWorkflowFn;

    try {
        // Read and parse the config file
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: PendingSessionConfig = JSON.parse(configContent);

        console.log(`Processing pending session request: ${config.name}`);

        // Validate and resolve workflow if provided
        let resolvedWorkflowPath: string | null = null;
        if (config.workflow && validateWorkflowImpl) {
            const { isValid, resolvedPath, availableWorkflows } = await validateWorkflowImpl(
                config.workflow,
                extensionPath,
                workspaceRoot
            );
            if (!isValid) {
                // Delete config file to prevent re-processing
                await fsPromises.unlink(configPath);
                const availableList = availableWorkflows.length > 0
                    ? availableWorkflows.join(', ')
                    : 'none found';
                vscode.window.showErrorMessage(
                    `Invalid workflow '${config.workflow}'. Available workflows: ${availableList}. ` +
                    `Session '${config.name}' was not created.`
                );
                return;
            }
            resolvedWorkflowPath = resolvedPath || null;
        }

        // Delete the config file first to prevent re-processing
        await fsPromises.unlink(configPath);

        // Use SessionService.createSession
        await createSessionService(
            config.name,
            config.prompt || '',
            'acceptEdits',
            config.sourceBranch,
            resolvedWorkflowPath, // workflow - resolved path to workflow YAML file
            [], // attachments - MCP sessions don't support attachments yet
            workspaceRoot,
            sessionProvider,
            codeAgent
        );

    } catch (err) {
        console.error(`Failed to process pending session ${configPath}:`, err);
        // Try to delete the config file even on error to prevent infinite retries
        try {
            await fsPromises.unlink(configPath);
        } catch {
            // Ignore deletion errors
        }
        vscode.window.showErrorMessage(`Failed to create session from MCP request: ${getErrorMessage(err)}`);
    }
}

/**
 * Check for and process any pending session requests.
 * Called on startup and when new files are detected.
 */
export async function checkPendingSessions(
    workspaceRoot: string | undefined,
    extensionPath: string,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent,
    // Internal functions from extension (temporary - validateWorkflow still from extension)
    validateWorkflowFn?: any
): Promise<void> {
    if (!workspaceRoot) {
        return;
    }

    try {
        const pendingSessionsDir = getPendingSessionsDir(workspaceRoot);
        // Ensure directory exists
        if (!await fileExists(pendingSessionsDir)) {
            return;
        }

        const files = await fsPromises.readdir(pendingSessionsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
            const configPath = path.join(pendingSessionsDir, file);
            await processPendingSession(configPath, workspaceRoot, extensionPath, sessionProvider, codeAgent, validateWorkflowFn);
        }
    } catch (err) {
        console.error('Failed to check pending sessions:', err);
    }
}

/**
 * Alias for processClearRequest to match the naming pattern of checkPendingSessions.
 * This is used by the file watcher to process clear requests.
 */
export const checkClearRequests = processClearRequest;

/**
 * Atomically claim a clear request file by deleting it.
 * Returns true if this window successfully claimed the file, false if another window already did.
 */
async function claimClearRequest(configPath: string): Promise<boolean> {
    try {
        await fsPromises.unlink(configPath);
        return true;
    } catch (err: any) {
        if (err.code === 'ENOENT') {
            // Another window already claimed this file
            return false;
        }
        throw err;
    }
}

/**
 * Check if the clear request file still exists on disk.
 */
async function clearRequestExists(configPath: string): Promise<boolean> {
    try {
        await fsPromises.access(configPath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Execute the clear request: clear session ID, dispose terminal, open new terminal.
 */
async function executeClearRequest(
    config: ClearSessionConfig,
    codeAgent: CodeAgent,
    baseRepoPath: string | undefined,
    clearSessionIdImpl: (worktreePath: string) => Promise<void>
): Promise<void> {
    await clearSessionIdImpl(config.worktreePath);

    const sessionName = path.basename(config.worktreePath);
    const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

    const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
    if (existingTerminal) {
        existingTerminal.dispose();

        // Kill tmux session if this session used tmux
        if ((await getSessionTerminalMode(config.worktreePath)) === 'tmux') {
            const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
            await TmuxService.killSession(tmuxSessionName);
        }

        // Brief delay to ensure terminal is closed
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    await openClaudeTerminalService(sessionName, config.worktreePath, undefined, undefined, undefined, codeAgent, baseRepoPath, true);
    console.log(`Session cleared: ${sessionName}`);
}

/**
 * Process a pending session clear request from the MCP server.
 * Closes the existing terminal and opens a new one with fresh context.
 *
 * When multiple VS Code windows are open for the same project, each window's
 * file watcher fires on the same clear request file. This function uses terminal
 * ownership to ensure only the window that owns the terminal processes the request.
 */
export async function processClearRequest(
    configPath: string,
    codeAgent: CodeAgent,
    baseRepoPath: string | undefined,
    sessionProvider: ClaudeSessionProvider,
    // Internal functions from extension (temporary)
    clearSessionIdFn?: any,
    workspaceRoot?: string
): Promise<void> {
    const clearSessionIdImpl = clearSessionIdFn || (async (worktreePath: string) => {
        const { clearSessionId: _clearSessionId } = require('../ClaudeSessionProvider');
        await _clearSessionId(worktreePath);
    });

    try {
        // Read and parse the config file (but don't delete yet — we need to check ownership)
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: ClearSessionConfig = JSON.parse(configContent);

        console.log(`Processing clear request for: ${config.worktreePath}`);

        const sessionName = path.basename(config.worktreePath);
        const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

        // Check if this window owns the terminal
        const ownsTerminal = vscode.window.terminals.some(t => t.name === termName);

        if (ownsTerminal) {
            // This window owns the terminal — atomically claim the request file
            const claimed = await claimClearRequest(configPath);
            if (!claimed) {
                console.log(`Clear request already claimed by another window: ${sessionName}`);
                return;
            }

            await executeClearRequest(config, codeAgent, baseRepoPath, clearSessionIdImpl);
            return;
        }

        // Terminal not found in this window — give the owning window time to claim
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if another window already handled it
        if (!await clearRequestExists(configPath)) {
            console.log(`Clear request handled by another window: ${sessionName}`);
            return;
        }

        // File still exists — check if this is the primary window (base repo)
        const isPrimaryWindow = workspaceRoot !== undefined && baseRepoPath !== undefined && workspaceRoot === baseRepoPath;

        if (isPrimaryWindow) {
            // Primary window claims as fallback (e.g. terminal was manually closed)
            const claimed = await claimClearRequest(configPath);
            if (!claimed) {
                console.log(`Clear request already claimed by another window: ${sessionName}`);
                return;
            }

            console.log(`Primary window claiming orphaned clear request: ${sessionName}`);
            await executeClearRequest(config, codeAgent, baseRepoPath, clearSessionIdImpl);
            return;
        }

        // Non-primary window — wait additional time, then try as last resort
        await new Promise(resolve => setTimeout(resolve, 500));

        if (!await clearRequestExists(configPath)) {
            console.log(`Clear request handled by another window: ${sessionName}`);
            return;
        }

        // Last resort: no other window handled it, claim it
        const claimed = await claimClearRequest(configPath);
        if (!claimed) {
            console.log(`Clear request already claimed by another window: ${sessionName}`);
            return;
        }

        console.log(`Last-resort window claiming clear request: ${sessionName}`);
        await executeClearRequest(config, codeAgent, baseRepoPath, clearSessionIdImpl);

    } catch (err: any) {
        if (err.code === 'ENOENT') {
            // File was already claimed/processed by another window during read
            return;
        }
        console.error(`Failed to process clear request ${configPath}:`, err);
        // Try to delete the config file even on error to prevent infinite retries
        try {
            await fsPromises.unlink(configPath);
        } catch {
            // Ignore deletion errors
        }
        vscode.window.showErrorMessage(`Failed to clear session: ${getErrorMessage(err)}`);
    }
}
