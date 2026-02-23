/**
 * MCP Abstraction Layer - Interface definitions.
 *
 * Provides a clean abstraction for MCP file-based operations,
 * isolating tool handlers from direct file system access.
 * No MCP SDK types are imported here - this is a pure abstraction.
 */

import type { WorkflowState } from '../core/workflow/types';

/**
 * Configuration for a pending Claude session request.
 * Matches the structure written to pending-session.json files
 * by the MCP adapter layer.
 */
export interface PendingSessionConfig {
    /** The base repository path */
    baseRepoPath: string;
    /** The session/branch name */
    sessionName: string;
    /** Optional workflow to start */
    workflow?: string;
    /** Timestamp when request was created */
    timestamp: number;
}

/**
 * Abstraction layer for MCP file-based operations.
 * Isolates MCP tool handlers from direct file system access,
 * routing all I/O through FileService pure functions.
 */
export interface IMcpAdapter {
    /** Save workflow state to the worktree's state file */
    saveState(worktreePath: string, state: WorkflowState): Promise<void>;
    /** Load workflow state from the worktree's state file, or null if not found */
    loadState(worktreePath: string): Promise<WorkflowState | null>;
    /** Write a pending session config for the extension to process */
    createPendingSession(config: PendingSessionConfig): Promise<void>;
    /** Write a clear-request marker for the extension to process */
    createClearRequest(worktreePath: string): Promise<void>;
    /** Check whether a workflow state file exists in the worktree */
    hasState(worktreePath: string): Promise<boolean>;
}
