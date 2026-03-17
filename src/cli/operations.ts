import type { WorkflowStatus } from '../core/session/types';
import type { CodeAgent } from '../core/codeAgents/CodeAgent';
import { SettingsScope, SettingsView } from '../core/services/UnifiedSettingsService';
import {
    resolveCliDaemonTarget,
    type CliDaemonTarget,
    type CliDaemonTargetOptions,
} from './targeting';
import type {
    CliDaemonSessionLaunchRequest,
    CliSessionLaunchRequest,
} from './sessionLauncher';

export interface CliSessionSummary {
    name: string;
    branch: string;
    path: string;
    status: string;
    agent: string;
    workflow?: string;
}

export interface CliSessionStatusResult {
    name: string;
    agent: string;
    status: string;
    sessionId: string | null;
    timestamp: string | null;
    workflow: WorkflowStatus | null;
}

export interface CliDiffResult {
    diff: string;
    baseBranch: string;
}

export interface CliInsightsResult {
    text: string;
    json: unknown;
}

export interface CliWorkflowSummary {
    name: string;
    description?: string;
    isBuiltin: boolean;
}

export interface CliRepairResult {
    broken: Array<{ sessionName: string; reason: string }>;
    repaired: string[];
    repairedCount: number;
    failures: string[];
}

export interface CliOperations {
    readonly targetKind: 'local' | 'remote';
    readonly host?: string;
    listSessions(): Promise<CliSessionSummary[]>;
    getSessionStatus(sessionName: string): Promise<CliSessionStatusResult>;
    createSession(input: {
        sessionName: string;
        sourceBranch?: string;
        codeAgent: CodeAgent;
        prompt?: string;
        workflow?: string;
        permissionMode: string;
        preferTmux?: boolean;
    }): Promise<CliSessionLaunchRequest>;
    openSession(sessionName: string, input?: { preferTmux?: boolean }): Promise<CliSessionLaunchRequest>;
    clearSession(sessionName: string, input?: { preferTmux?: boolean }): Promise<CliSessionLaunchRequest>;
    deleteSession(sessionName: string): Promise<void>;
    getSessionDiff(sessionName: string, input?: { baseBranch?: string }): Promise<CliDiffResult>;
    getSessionInsights(sessionName: string, input?: { includeJson?: boolean }): Promise<CliInsightsResult>;
    repairWorktrees(input?: { dryRun?: boolean }): Promise<CliRepairResult>;
    listWorkflows(): Promise<CliWorkflowSummary[]>;
    listConfig(view: SettingsView): Promise<Record<string, unknown>>;
    getConfig(key: string, view: SettingsView): Promise<unknown>;
    setConfig(key: string, value: unknown, scope: SettingsScope): Promise<void>;
}

function createDaemonLaunchRequest(
    sessionName: string,
    target: CliDaemonTarget,
    launch: CliDaemonSessionLaunchRequest['launch']
): CliDaemonSessionLaunchRequest {
    return {
        kind: 'daemon',
        sessionName,
        client: target.client,
        launch,
        target,
    };
}

function createDaemonCliOperations(target: CliDaemonTarget): CliOperations {
    return {
        targetKind: target.kind,
        host: target.kind === 'remote' ? target.host : undefined,
        async listSessions() {
            const response = await target.client.listSessions();
            return response.sessions.map((session) => ({
                name: session.name,
                branch: session.branch,
                path: session.worktreePath,
                status: session.status?.status || 'idle',
                agent: session.data?.agentName || '',
                workflow: session.workflowStatus?.workflow,
            }));
        },
        async getSessionStatus(sessionName) {
            const listResponse = await target.client.listSessions();
            const session = listResponse.sessions.find((entry) => entry.name === sessionName);
            if (!session) {
                throw new Error(`Session '${sessionName}' not found.`);
            }
            const statusResponse = await target.client.getSessionStatus(sessionName);
            return {
                name: sessionName,
                agent: session.data?.agentName || '',
                status: statusResponse.status?.status || 'idle',
                sessionId: session.data?.sessionId || null,
                timestamp: statusResponse.status?.timestamp || session.status?.timestamp || null,
                workflow: statusResponse.workflowStatus,
            };
        },
        async createSession(input) {
            const launch = await target.client.createSession({
                name: input.sessionName,
                branch: input.sourceBranch,
                agent: input.codeAgent.name,
                prompt: input.prompt,
                workflow: input.workflow || undefined,
                permissionMode: input.permissionMode,
                tmux: Boolean(input.preferTmux),
            });
            return createDaemonLaunchRequest(input.sessionName, target, launch);
        },
        async openSession(sessionName, input = {}) {
            const launch = await target.client.openSession(sessionName, {
                tmux: Boolean(input.preferTmux),
            });
            return createDaemonLaunchRequest(sessionName, target, launch);
        },
        async clearSession(sessionName, input = {}) {
            await target.client.clearSession(sessionName);
            const launch = await target.client.openSession(sessionName, {
                tmux: Boolean(input.preferTmux),
            });
            return createDaemonLaunchRequest(sessionName, target, launch);
        },
        async deleteSession(sessionName) {
            await target.client.deleteSession(sessionName);
        },
        async getSessionDiff(sessionName, input = {}) {
            const result = await target.client.getSessionDiff(
                sessionName,
                input.baseBranch ? { baseBranch: input.baseBranch } : undefined
            );
            return {
                diff: result.diff,
                baseBranch: result.baseBranch,
            };
        },
        async getSessionInsights(sessionName, input = {}) {
            const result = await target.client.getSessionInsights(sessionName, {
                includeAnalysis: input.includeJson,
            });
            return {
                text: result.insights,
                json: result,
            };
        },
        async repairWorktrees(input = {}) {
            const result = await target.client.repairWorktrees({
                dryRun: Boolean(input.dryRun),
            });
            return {
                broken: result.broken.map((entry) => ({
                    sessionName: entry.sessionName,
                    reason: entry.reason,
                })),
                repaired: [],
                repairedCount: result.repairResult?.successCount || 0,
                failures: result.repairResult?.failures || [],
            };
        },
        async listWorkflows() {
            const response = await target.client.listWorkflows();
            return response.workflows.map((workflow) => ({
                name: workflow.name,
                description: workflow.description,
                isBuiltin: workflow.isBuiltin,
            }));
        },
        async listConfig(view) {
            const response = await target.client.getAllConfig(view);
            return response.config;
        },
        async getConfig(key, view) {
            const response = await target.client.getConfig(key, view);
            return response.value;
        },
        async setConfig(key, value, scope) {
            await target.client.setConfig(key, value, scope);
        },
    };
}

export async function withCliOperations<T>(
    repoRoot: string,
    _config: unknown,
    options: CliDaemonTargetOptions,
    handler: (operations: CliOperations) => Promise<T>
): Promise<T> {
    const target = await resolveCliDaemonTarget(repoRoot, options);
    return handler(createDaemonCliOperations(target));
}
