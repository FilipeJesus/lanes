import type { TerminalOutputData } from '../core/interfaces/ITerminalIOProvider';
import type { AgentSessionData, AgentSessionStatus, WorkflowStatus } from '../core/session/types';
import type { SettingsScope, SettingsView } from '../core/services/UnifiedSettingsService';
import type { WorkflowState } from '../core/workflow/types';

export interface DaemonHealthResponse {
    status: string;
    version: string;
}

export interface DaemonDiscoveryResponse {
    projectId: string;
    projectName: string;
    gitRemote: string | null;
    sessionCount: number;
    uptime: number;
    workspaceRoot: string;
    port: number;
    apiVersion: string;
}

export interface DaemonSessionSummary {
    name: string;
    worktreePath: string;
    branch: string;
    data: AgentSessionData | null;
    status: AgentSessionStatus | null;
    workflowStatus: WorkflowStatus | null;
    isPinned: boolean;
    notificationsEnabled: boolean;
}

export interface DaemonSessionListResponse {
    sessions: DaemonSessionSummary[];
}

export interface DaemonSessionLaunchResponse {
    command: string;
    terminalMode: 'vscode' | 'tmux';
    attachCommand?: string;
    tmuxSessionName?: string;
}

export interface DaemonSessionCreateResponse extends DaemonSessionLaunchResponse {
    sessionName: string;
    worktreePath: string;
    sessionId: string;
}

export interface DaemonSessionOpenResponse extends DaemonSessionLaunchResponse {
    success: true;
    worktreePath: string;
}

export interface DaemonSessionStatusResponse {
    status: AgentSessionStatus | null;
    workflowStatus: WorkflowStatus | null;
}

export interface DaemonSuccessResponse {
    success: true;
}

export interface DaemonSessionInsightsResponse {
    insights: string;
    analysis: null;
    sessionName: string;
}

export interface DaemonBranchInfo {
    name: string;
    isCurrent: boolean;
}

export interface DaemonBranchListResponse {
    branches: DaemonBranchInfo[];
}

export interface DaemonDiffResponse {
    diff: string;
    baseBranch: string;
}

export interface DaemonDiffFileEntry {
    path: string;
    status: string;
    previousPath?: string;
    beforeContent?: string;
    afterContent?: string;
    isBinary: boolean;
}

export interface DaemonDiffFilesResponse {
    files: DaemonDiffFileEntry[];
    baseBranch: string;
}

export interface DaemonWorktreeInfo {
    path: string;
    branch: string;
    commit: string;
}

export interface DaemonWorktreeInfoResponse {
    worktree: DaemonWorktreeInfo | null;
}

export interface DaemonBrokenWorktree {
    sessionName: string;
    worktreePath: string;
    reason: string;
}

export interface DaemonWorktreeRepairResult {
    successCount: number;
    failures: string[];
}

export interface DaemonRepairWorktreesResponse {
    broken: DaemonBrokenWorktree[];
    repairResult: DaemonWorktreeRepairResult | null;
}

export interface DaemonWorkflowStep {
    id: string;
    type: string;
    description?: string;
}

export interface DaemonWorkflowInfo {
    name: string;
    path: string;
    description?: string;
    isBuiltin: boolean;
    steps?: DaemonWorkflowStep[];
}

export interface DaemonWorkflowListResponse {
    workflows: DaemonWorkflowInfo[];
}

export interface DaemonWorkflowValidateResponse {
    isValid: boolean;
    errors: string[];
}

export interface DaemonWorkflowCreateResponse {
    path: string;
}

export interface DaemonWorkflowStateResponse {
    state: WorkflowState | Record<string, unknown> | null;
}

export interface DaemonAgentPermissionMode {
    id: string;
    label: string;
    flag?: string;
}

export interface DaemonAgentInfo {
    name: string;
    displayName: string;
    cliCommand: string;
    sessionFileExtension: string;
    statusFileExtension: string;
    logoSvg?: string;
    permissionModes: DaemonAgentPermissionMode[];
}

export interface DaemonAgentListResponse {
    agents: DaemonAgentInfo[];
}

export interface DaemonAgentConfigResponse {
    config: DaemonAgentInfo | null;
}

export interface DaemonConfigGetAllResponse {
    config: Record<string, unknown>;
    scope: SettingsView;
}

export interface DaemonConfigGetResponse {
    value: unknown;
    scope: SettingsView;
}

export interface DaemonConfigSetResponse {
    success: true;
    scope: SettingsScope;
}

export interface DaemonTerminalInfo {
    name: string;
    sessionName: string;
}

export interface DaemonTerminalListResponse {
    terminals: DaemonTerminalInfo[];
}

export interface DaemonTerminalCreateResponse {
    terminalName: string;
    attachCommand: string;
}

export interface DaemonTerminalSendResponse {
    success: true;
}

export interface DaemonTerminalResizeResponse {
    success: true;
}

export type {
    TerminalOutputData,
};
