/**
 * SessionProcessService - MCP pending session request processing
 *
 * This service handles the processing of session requests from the MCP server.
 * The MCP server writes JSON config files to .lanes/pending-sessions/ and .lanes/clear-requests/,
 * which are then processed by this service.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import type { PendingSessionConfig } from '../types/extension';
import type { ClearSessionConfig } from '../types/extension';
import { ClaudeSessionProvider } from '../ClaudeSessionProvider';
import { CodeAgent } from '../codeAgents';
import { getErrorMessage } from '../utils';

// Re-export from extension for now (temporary measure)
// These will be resolved when SessionService is extracted in 07-03
let createSession: any = null;
let openClaudeTerminal: any = null;
let clearSessionId: any = null;
let validateWorkflow: any = null;

// Lazy import from extension to avoid circular dependency
// These functions are internal to extension.ts and not exported
// The service accepts them as parameters for now

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
 *
 * Note: This function temporarily calls createSession from extension.ts.
 * This will be resolved when SessionService is extracted in plan 07-03.
 */
export async function processPendingSession(
    configPath: string,
    workspaceRoot: string | undefined,
    extensionPath: string,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent,
    // Internal functions from extension (temporary)
    createSessionFn?: any,
    validateWorkflowFn?: any
): Promise<void> {
    if (!workspaceRoot) {
        console.error('Cannot process pending session: no workspace root');
        return;
    }

    // Use passed functions or get from extension
    const createSessionImpl = createSessionFn;
    const validateWorkflowImpl = validateWorkflowFn;

    if (!createSessionImpl) {
        console.error('processPendingSession: createSession function not provided');
        return;
    }

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

        // Use the provided createSession logic
        await createSessionImpl(
            config.name,
            config.prompt || '',
            '', // acceptanceCriteria
            'default' as any, // permissionMode
            config.sourceBranch,
            resolvedWorkflowPath, // workflow - resolved path to workflow YAML file
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
 *
 * Note: This function temporarily calls processPendingSession with extension functions.
 * This will be resolved when SessionService is extracted in plan 07-03.
 */
export async function checkPendingSessions(
    workspaceRoot: string | undefined,
    extensionPath: string,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent,
    // Internal functions from extension (temporary)
    createSessionFn?: any,
    validateWorkflowFn?: any,
    processPendingSessionFn?: any
): Promise<void> {
    if (!workspaceRoot) {
        return;
    }

    try {
        const pendingSessionsDir = getPendingSessionsDir(workspaceRoot);
        // Ensure directory exists
        if (!fs.existsSync(pendingSessionsDir)) {
            return;
        }

        const files = await fsPromises.readdir(pendingSessionsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
            const configPath = path.join(pendingSessionsDir, file);

            if (processPendingSessionFn) {
                await processPendingSessionFn(configPath, workspaceRoot, extensionPath, sessionProvider, codeAgent);
            } else {
                await processPendingSession(configPath, workspaceRoot, extensionPath, sessionProvider, codeAgent, createSessionFn, validateWorkflowFn);
            }
        }
    } catch (err) {
        console.error('Failed to check pending sessions:', err);
    }
}

/**
 * Process a pending session clear request from the MCP server.
 * Closes the existing terminal and opens a new one with fresh context.
 *
 * Note: This function temporarily calls openClaudeTerminal from extension.ts.
 * This will be resolved when SessionService is extracted in plan 07-03.
 */
export async function processClearRequest(
    configPath: string,
    codeAgent: CodeAgent,
    baseRepoPath: string | undefined,
    sessionProvider: ClaudeSessionProvider,
    // Internal functions from extension (temporary)
    clearSessionIdFn?: any,
    openClaudeTerminalFn?: any
): Promise<void> {
    const clearSessionIdImpl = clearSessionIdFn || ((path: string) => {
        const { clearSessionId: _clearSessionId } = require('../ClaudeSessionProvider');
        _clearSessionId(path);
    });

    const openClaudeTerminalImpl = openClaudeTerminalFn;

    if (!openClaudeTerminalImpl) {
        console.error('processClearRequest: openClaudeTerminal function not provided');
        return;
    }

    try {
        // Read and parse the config file
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: ClearSessionConfig = JSON.parse(configContent);

        console.log(`Processing clear request for: ${config.worktreePath}`);

        // Delete the config file first to prevent re-processing
        await fsPromises.unlink(configPath);

        // Clear the session ID so the new terminal starts fresh instead of resuming
        if (clearSessionIdImpl) {
            clearSessionIdImpl(config.worktreePath);
        }

        const sessionName = path.basename(config.worktreePath);
        const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

        // Find and close the existing terminal
        const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
        if (existingTerminal) {
            existingTerminal.dispose();
            // Brief delay to ensure terminal is closed
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Open a new terminal with fresh session (skip workflow prompt for cleared sessions)
        await openClaudeTerminalImpl(sessionName, config.worktreePath, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath, true);

        console.log(`Session cleared: ${sessionName}`);

    } catch (err) {
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
