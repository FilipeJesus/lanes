/**
 * Canned API response factories for Playwright e2e tests.
 * Types mirror web-ui/src/api/types.ts.
 */

// ---------------------------------------------------------------------------
// Daemon / Gateway
// ---------------------------------------------------------------------------

export interface DaemonInfo {
    projectId: string;
    workspaceRoot: string;
    port: number;
    pid: number;
    token: string;
    startedAt: string;
    projectName: string;
}

export function makeDaemonInfo(overrides: Partial<DaemonInfo> = {}): DaemonInfo {
    return {
        projectId: 'project-my-app',
        workspaceRoot: '/home/user/projects/my-app',
        port: 9100,
        pid: 12345,
        token: 'test-token-abc123',
        startedAt: new Date().toISOString(),
        projectName: 'my-app',
        ...overrides,
    };
}

export interface GatewayProjectInfo {
    projectId: string;
    workspaceRoot: string;
    projectName: string;
    registeredAt: string;
    status: 'running' | 'registered';
    daemon: DaemonInfo | null;
}

export function makeProjectInfo(overrides: Partial<GatewayProjectInfo> = {}): GatewayProjectInfo {
    const projectId = overrides.projectId ?? 'project-my-app';
    const projectName = overrides.projectName ?? 'my-app';
    const workspaceRoot = overrides.workspaceRoot ?? '/home/user/projects/my-app';
    const daemon =
        overrides.daemon === null
            ? null
            : makeDaemonInfo({
                  projectId,
                  projectName,
                  workspaceRoot,
                  ...(overrides.daemon ?? {}),
              });

    return {
        projectId,
        workspaceRoot,
        projectName,
        registeredAt: new Date().toISOString(),
        status: daemon ? 'running' : 'registered',
        daemon,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Health & Discovery
// ---------------------------------------------------------------------------

export function makeHealthResponse() {
    return { status: 'ok', version: '1' };
}

export interface DiscoveryInfo {
    projectId: string;
    projectName: string;
    gitRemote: string | null;
    sessionCount: number;
    uptime: number;
    workspaceRoot: string;
    port: number;
}

export function makeDiscoveryInfo(overrides: Partial<DiscoveryInfo> = {}): DiscoveryInfo {
    return {
        projectId: 'project-my-app',
        projectName: 'my-app',
        gitRemote: 'https://github.com/user/my-app.git',
        sessionCount: 2,
        uptime: 3600,
        workspaceRoot: '/home/user/projects/my-app',
        port: 9100,
        apiVersion: '1',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionInfo {
    name: string;
    worktreePath: string;
    branch: string;
    data: { sessionId: string; agentName?: string; workflow?: string };
    status: { status: string; timestamp?: string; message?: string } | null;
    workflowStatus: { active: boolean; workflow?: string; step?: string; progress?: string } | null;
    isPinned: boolean;
}

export function makeSessionInfo(overrides: Partial<SessionInfo> = {}): SessionInfo {
    const name = overrides.name ?? 'test-session';
    return {
        name,
        worktreePath: `/home/user/projects/my-app/.worktrees/${name}`,
        branch: name,
        data: { sessionId: `session-${Date.now()}`, agentName: 'claude' },
        status: { status: 'idle' },
        workflowStatus: { active: false },
        isPinned: false,
        ...overrides,
    };
}

export function makeSessionListResponse(sessions: SessionInfo[] = []) {
    return { sessions };
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export function makeDiffFilesResult(files: { path: string; status: string }[] = []) {
    return {
        files: files.map((f) => ({ ...f, isBinary: false })),
        sessionName: 'test-session',
    };
}

export function makeDiffResult(diff = '') {
    return { diff, sessionName: 'test-session' };
}

// ---------------------------------------------------------------------------
// Worktree
// ---------------------------------------------------------------------------

export function makeWorktreeInfo(overrides: Partial<{ path: string; branch: string; commit: string; isClean: boolean }> = {}) {
    return {
        worktree: {
            path: '/home/user/projects/my-app/.worktrees/test-session',
            branch: 'test-session',
            commit: 'abc1234567890def',
            isClean: true,
            ...overrides,
        },
    };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function makeWorkflowState(overrides: Partial<{ workflowName: string; currentStep: string; completedSteps: string[] }> = {}) {
    return { state: overrides.workflowName ? overrides : null };
}

export interface WorkflowInfo {
    name: string;
    description?: string;
    path?: string;
    isBuiltin?: boolean;
    steps?: { id: string; type: string; description?: string }[];
}

export function makeWorkflowInfo(overrides: Partial<WorkflowInfo> = {}): WorkflowInfo {
    return {
        name: 'feature-dev',
        description: 'Standard feature development workflow',
        isBuiltin: true,
        steps: [
            { id: 'plan', type: 'step', description: 'Plan the implementation' },
            { id: 'implement', type: 'step', description: 'Implement the feature' },
            { id: 'test', type: 'step', description: 'Write tests' },
        ],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export function makeInsightsResponse(overrides: Partial<{ insights: string; analysis: string }> = {}) {
    return {
        insights: overrides.insights ?? 'Session has 5 files changed with 120 additions.',
        analysis: overrides.analysis ?? 'The changes implement a new login page.',
        sessionName: 'test-session',
    };
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export interface AgentInfo {
    name: string;
    displayName: string;
    cliCommand: string;
    sessionFileExtension: string;
    statusFileExtension: string;
    permissionModes: Array<{ id: string; label: string; flag?: string }>;
}

export function makeAgentInfo(overrides: Partial<AgentInfo> = {}): AgentInfo {
    return {
        name: 'claude',
        displayName: 'Claude Code',
        cliCommand: 'claude',
        sessionFileExtension: '.claude-session',
        statusFileExtension: '.claude-status',
        permissionModes: [{ id: 'acceptEdits', label: 'Accept Edits' }],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Git
// ---------------------------------------------------------------------------

export function makeGitBranchesResponse(branches: { name: string; isRemote: boolean }[] = []) {
    return {
        branches: branches.length > 0 ? branches : [
            { name: 'main', isRemote: false, isCurrent: true },
            { name: 'develop', isRemote: false },
        ],
    };
}
