/**
 * Core session types - platform-agnostic type definitions for session management.
 *
 * These types were extracted from AgentSessionProvider to decouple them
 * from VS Code APIs, enabling reuse in CLI, web, or other frontends.
 */

/** Valid agent status states */
export type AgentStatusState = 'working' | 'waiting_for_user' | 'active' | 'idle' | 'error';

/** Agent status (file name determined by CodeAgent) */
export interface AgentSessionStatus {
    status: AgentStatusState;
    timestamp?: string;
    message?: string;
}

/** Valid status values for validation */
export const VALID_STATUS_VALUES: AgentStatusState[] = ['working', 'waiting_for_user', 'active', 'idle', 'error'];

/**
 * Default file names used when no CodeAgent is configured.
 * These are Claude-specific defaults for backward compatibility.
 */
export const DEFAULTS = {
    sessionFileName: '.claude-session',
    statusFileName: '.claude-status',
};

/**
 * Fixed path for repo-local session storage (relative to repo root).
 * All per-session data lives under: <repo>/.lanes/current-sessions/<sessionName>/
 */
export const NON_GLOBAL_SESSION_PATH = '.lanes/current-sessions';

export interface AgentSessionData {
    sessionId: string;
    timestamp?: string;
    workflow?: string;
    permissionMode?: string;
    agentName?: string;
    isChimeEnabled?: boolean;
    taskListId?: string;
    terminal?: 'code' | 'tmux';
    /** Path to the agent's session log file (for polling status on hookless agents) */
    logPath?: string;
}

export interface WorkflowStatus {
    active: boolean;
    workflow?: string;
    step?: string;
    progress?: string;
    summary?: string;
}
