import type { WorkflowStatus } from '../core/session/types';
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

export interface CliWorkflowValidationResult {
    isValid: boolean;
    errors: string[];
}

export interface CliAgentInfo {
    name: string;
    displayName: string;
    permissionModes: Array<{
        id: string;
        label: string;
        flag?: string;
    }>;
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
        agentName: string;
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
    createWorkflow(input: { name: string; from?: string; content?: string }): Promise<{ path: string }>;
    validateWorkflow(input: { content?: string; workflowPath?: string }): Promise<CliWorkflowValidationResult>;
    listAgents(): Promise<CliAgentInfo[]>;
    getAgentConfig(agentName: string): Promise<CliAgentInfo | null>;
    listConfig(view: SettingsView): Promise<Record<string, unknown>>;
    getConfig(key: string, view: SettingsView): Promise<unknown>;
    setConfig(key: string, value: unknown, scope: SettingsScope): Promise<void>;
    setupSessionHooks(sessionName: string): Promise<string>;
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
                agent: input.agentName,
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
        async createWorkflow(input) {
            return target.client.createWorkflow(input);
        },
        async validateWorkflow(input) {
            return target.client.validateWorkflow(input);
        },
        async listAgents() {
            const response = await target.client.listAgents();
            return response.agents.map((agent) => ({
                name: agent.name,
                displayName: agent.displayName,
                permissionModes: agent.permissionModes,
            }));
        },
        async getAgentConfig(agentName) {
            const response = await target.client.getAgentConfig(agentName);
            if (!response.config) {
                return null;
            }
            return {
                name: response.config.name,
                displayName: response.config.displayName,
                permissionModes: response.config.permissionModes,
            };
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
        async setupSessionHooks(sessionName) {
            const response = await target.client.setupSessionHooks(sessionName);
            return response.settingsPath;
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
