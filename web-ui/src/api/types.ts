/**
 * API Types for Lanes Web UI
 *
 * TypeScript types for all daemon REST API responses and request payloads.
 */

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

export type AgentStatusState =
    | 'working'
    | 'waiting_for_user'
    | 'active'
    | 'idle'
    | 'error';

export interface AgentSessionStatus {
    status: AgentStatusState;
    timestamp?: string;
    message?: string;
}

export interface WorkflowStatus {
    active: boolean;
    workflow?: string;
    step?: string;
    progress?: string;
    summary?: string;
}

export interface SessionData {
    sessionId: string;
    workflow?: string;
    agentName?: string;
    permissionMode?: string;
    terminal?: string;
    tmuxSessionName?: string;
}

export interface SessionInfo {
    name: string;
    worktreePath: string;
    branch: string;
    data: SessionData | null;
    status: AgentSessionStatus | null;
    workflowStatus: WorkflowStatus | null;
    isPinned: boolean;
}

// ---------------------------------------------------------------------------
// Daemon / registry types
// ---------------------------------------------------------------------------

export interface DaemonInfo {
    projectId?: string;
    workspaceRoot: string;
    port: number;
    pid: number;
    token: string;
    startedAt: string;
    projectName: string;
}

export interface GatewayProjectInfo {
    projectId: string;
    workspaceRoot: string;
    projectName: string;
    registeredAt: string;
    status: 'running' | 'registered';
    daemon: DaemonInfo | null;
}

export interface DiscoveryInfo {
    projectId: string;
    projectName: string;
    gitRemote: string | null;
    sessionCount: number;
    uptime: number;
    workspaceRoot: string;
    port: number;
    apiVersion: string;
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export interface HealthResponse {
    status: string;
    version: string;
}

// ---------------------------------------------------------------------------
// Agent types
// ---------------------------------------------------------------------------

export interface AgentInfo {
    name: string;
    displayName: string;
    cliCommand: string;
    sessionFileExtension: string;
    statusFileExtension: string;
    permissionModes: string[];
}

// ---------------------------------------------------------------------------
// Workflow types
// ---------------------------------------------------------------------------

export interface WorkflowInfo {
    name: string;
    description?: string;
    path?: string;
    isBuiltin?: boolean;
    steps?: WorkflowStep[];
}

export interface WorkflowStep {
    id: string;
    type: string;
    description?: string;
}

export interface WorkflowValidateResult {
    valid: boolean;
    errors?: string[];
}

export interface WorkflowState {
    workflowName?: string;
    currentStep?: string;
    completedSteps?: string[];
    outputs?: Record<string, unknown>;
    artefacts?: string[];
    tasks?: string[];
}

// ---------------------------------------------------------------------------
// Git types
// ---------------------------------------------------------------------------

export interface BranchInfo {
    name: string;
    isRemote: boolean;
    isCurrent?: boolean;
}

export interface GitBranchesResponse {
    branches: BranchInfo[];
}

export interface GitRepairResult {
    repaired: string[];
    errors: string[];
}

export interface DiffResult {
    diff: string;
    sessionName: string;
    baseBranch?: string;
}

export interface DiffFileEntry {
    path: string;
    status: string;
    beforeContent?: string;
    afterContent?: string;
    isBinary: boolean;
    previousPath?: string;
}

export interface DiffFilesResult {
    files: DiffFileEntry[];
    sessionName: string;
    baseBranch?: string;
}

export interface WorktreeInfo {
    path: string;
    branch: string;
    commit?: string;
    isClean?: boolean;
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface ConfigEntry {
    value: unknown;
    scope?: 'effective' | 'global' | 'local';
}

export interface ConfigGetAllResponse {
    config: Record<string, unknown>;
    scope?: 'effective' | 'global' | 'local';
}

// ---------------------------------------------------------------------------
// Terminal types
// ---------------------------------------------------------------------------

export interface TerminalInfo {
    name: string;
    sessionName?: string;
    pid?: number;
    cwd?: string;
}

export interface TerminalListResponse {
    terminals: TerminalInfo[];
}

export interface CreateTerminalRequest {
    sessionName?: string;
    name?: string;
    cwd?: string;
}

export interface CreateTerminalResponse {
    terminalName: string;
}

export interface TerminalSendRequest {
    text: string;
}

export interface TerminalOutputData {
    /** Terminal content (may include ANSI escape codes). */
    content: string;
    /** Number of terminal rows. */
    rows: number;
    /** Number of terminal columns. */
    cols: number;
}

export interface TerminalResizeRequest {
    cols: number;
    rows: number;
}

// ---------------------------------------------------------------------------
// Session request / response types
// ---------------------------------------------------------------------------

export interface CreateSessionRequest {
    name: string;
    branch?: string;
    workflow?: string;
    agent?: string;
    prompt?: string;
    permissionMode?: string;
}

export interface CreateSessionResponse {
    sessionName: string;
    worktreePath: string;
    branch: string;
}

export interface SessionListResponse {
    sessions: SessionInfo[];
}

export interface SessionStatusResponse {
    status: AgentSessionStatus;
    workflowStatus: WorkflowStatus;
}

export interface InsightsResponse {
    insights: string;
    analysis?: string;
    sessionName: string;
}

// ---------------------------------------------------------------------------
// Generic error response
// ---------------------------------------------------------------------------

export interface ApiError {
    error: string;
}
