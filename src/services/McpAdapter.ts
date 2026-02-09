/**
 * McpAdapter - MCP abstraction layer implementation.
 *
 * Implements IMcpAdapter using FileService pure functions for all file I/O.
 * No direct fs imports - all operations routed through FileService.
 * No MCP SDK imports - this is a clean abstraction boundary.
 *
 * Path conventions:
 * - Workflow state: {worktreePath}/workflow-state.json
 * - Pending session: {baseRepoPath}/.git/.lanes/pending-{sessionName}.json
 * - Clear request: {worktreePath}/.clear-request
 */

import * as path from 'path';
import { atomicWrite, readJson, fileExists } from './FileService';
import type { IMcpAdapter, PendingSessionConfig } from '../types/mcp';
import type { WorkflowState } from '../workflow/types';

/**
 * MCP adapter that isolates file I/O from MCP tool handlers.
 * All file operations are delegated to FileService pure functions.
 */
export class McpAdapter implements IMcpAdapter {

    // ---- Private path helpers ----

    /**
     * Get the path to the workflow state file in a worktree.
     */
    private getStatePath(worktreePath: string): string {
        return path.join(worktreePath, 'workflow-state.json');
    }

    /**
     * Get the path for a pending session config file.
     * Uses .git/.lanes/ directory in the base repo.
     */
    private getPendingSessionPath(baseRepoPath: string, sessionName: string): string {
        return path.join(baseRepoPath, '.git', '.lanes', `pending-${sessionName}.json`);
    }

    /**
     * Get the path for a clear-request marker file.
     */
    private getClearRequestPath(worktreePath: string): string {
        return path.join(worktreePath, '.clear-request');
    }

    // ---- IMcpAdapter implementation ----

    /**
     * Save workflow state to the worktree's state file.
     * Uses atomic write to prevent corruption on crash.
     */
    async saveState(worktreePath: string, state: WorkflowState): Promise<void> {
        await atomicWrite(
            this.getStatePath(worktreePath),
            JSON.stringify(state, null, 2)
        );
    }

    /**
     * Load workflow state from the worktree's state file.
     * Returns null if the file does not exist (ENOENT).
     */
    async loadState(worktreePath: string): Promise<WorkflowState | null> {
        return readJson<WorkflowState>(this.getStatePath(worktreePath));
    }

    /**
     * Write a pending session config for the extension to process.
     * The extension watches for these files and creates sessions.
     */
    async createPendingSession(config: PendingSessionConfig): Promise<void> {
        await atomicWrite(
            this.getPendingSessionPath(config.baseRepoPath, config.sessionName),
            JSON.stringify(config, null, 2)
        );
    }

    /**
     * Write a clear-request marker for the extension to process.
     * The extension watches for these files and clears sessions.
     */
    async createClearRequest(worktreePath: string): Promise<void> {
        await atomicWrite(
            this.getClearRequestPath(worktreePath),
            JSON.stringify({ timestamp: Date.now() })
        );
    }

    /**
     * Check whether a workflow state file exists in the worktree.
     */
    async hasState(worktreePath: string): Promise<boolean> {
        return fileExists(this.getStatePath(worktreePath));
    }
}

/** Singleton McpAdapter instance for use across the application. */
export const mcpAdapter = new McpAdapter();
