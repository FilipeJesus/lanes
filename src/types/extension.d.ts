/**
 * Extension-specific type definitions.
 *
 * This file contains types that are shared across multiple modules
 * but specific to the extension's functionality.
 */

/**
 * Pending session request from MCP server.
 */
export interface PendingSessionConfig {
    name: string;
    sourceBranch: string;
    prompt?: string;
    workflow?: string;
    requestedAt: string;
}

/**
 * Clear session request from MCP server.
 */
export interface ClearSessionConfig {
    worktreePath: string;
    requestedAt: string;
}
