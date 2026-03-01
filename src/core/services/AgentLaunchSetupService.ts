import * as fs from 'fs/promises';
import * as path from 'path';
import { CodeAgent, McpConfig, McpConfigDelivery, getAgent, DEFAULT_AGENT_NAME } from '../codeAgents';
import * as SettingsService from './SettingsService';
import {
    getSessionId,
    getSessionPermissionMode,
    getSessionWorkflow
} from '../session/SessionDataService';

export interface LaunchContextInput {
    worktreePath: string;
    workflow?: string | null;
    permissionMode?: string;
    codeAgent?: CodeAgent;
    agentName?: string;
    defaultAgentName?: string;
    repoRoot?: string;
    workflowResolver?: (workflow: string) => Promise<string | null>;
}

export interface LaunchContext {
    codeAgent: CodeAgent;
    sessionData: { sessionId: string } | null;
    effectiveWorkflow: string | null;
    effectivePermissionMode: string | undefined;
    settingsPath?: string;
    mcpConfigPath?: string;
    mcpConfigOverrides?: string[];
}

export type LaunchMode = 'start' | 'resume';

export interface LaunchCommandResult {
    mode: LaunchMode;
    command: string;
}

export interface LaunchCommandInput {
    prompt?: string;
    preferResume?: boolean;
}

function resolveAgent(input: LaunchContextInput): CodeAgent {
    if (input.codeAgent) {
        return input.codeAgent;
    }
    const requested = input.agentName ?? input.defaultAgentName ?? DEFAULT_AGENT_NAME;
    return getAgent(requested) ?? getAgent(DEFAULT_AGENT_NAME)!;
}

function normalizeMcpServerPath(rawPath: string): string {
    const marker = path.join('core', 'codeAgents', 'mcp', 'server.js');
    if (!rawPath.endsWith(marker)) {
        return rawPath;
    }

    const prefix = rawPath.slice(0, rawPath.length - marker.length);
    return path.join(prefix, 'mcp', 'server.js');
}

async function resolveWorkflowPath(
    workflow: string | null | undefined,
    resolver?: (workflow: string) => Promise<string | null>
): Promise<string | null> {
    if (!workflow) {
        return null;
    }
    if (path.isAbsolute(workflow) && workflow.endsWith('.yaml')) {
        return workflow;
    }
    if (!resolver) {
        return workflow;
    }
    const resolved = await resolver(workflow);
    if (!resolved) {
        throw new Error(`Workflow not found: ${workflow}`);
    }
    return resolved;
}

function normalizeMcpConfig(config: McpConfig | null): McpConfig | null {
    if (!config) {
        return null;
    }
    const normalized: McpConfig = { mcpServers: {} };
    for (const [name, server] of Object.entries(config.mcpServers)) {
        const args = [...server.args];
        if (args.length > 0) {
            args[0] = normalizeMcpServerPath(args[0]);
        }
        normalized.mcpServers[name] = {
            command: server.command,
            args
        };
    }
    return normalized;
}

export async function prepareAgentLaunchContext(input: LaunchContextInput): Promise<LaunchContext> {
    const codeAgent = resolveAgent(input);
    const effectiveWorkflow = await resolveWorkflowPath(
        input.workflow ?? await getSessionWorkflow(input.worktreePath),
        input.workflowResolver
    );

    const sessionMode = await getSessionPermissionMode(input.worktreePath) ?? undefined;
    const effectivePermissionMode = input.permissionMode ?? sessionMode ?? undefined;

    let mcpConfigForSettings: McpConfig | null = null;
    let mcpConfigForCommand: McpConfig | null = null;
    let mcpConfigDelivery: McpConfigDelivery | undefined;

    if (effectiveWorkflow && codeAgent.supportsMcp()) {
        const repoRoot = input.repoRoot || await SettingsService.getBaseRepoPath(input.worktreePath);
        const rawConfig = codeAgent.getMcpConfig(input.worktreePath, effectiveWorkflow, repoRoot);
        mcpConfigForCommand = normalizeMcpConfig(rawConfig);
        mcpConfigDelivery = codeAgent.getMcpConfigDelivery();
        if (mcpConfigDelivery === 'settings') {
            mcpConfigForSettings = mcpConfigForCommand;
        }
    }

    const settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(
        input.worktreePath,
        input.workflow ? effectiveWorkflow : null,
        codeAgent,
        mcpConfigForSettings
    );

    let mcpConfigPath: string | undefined;
    let mcpConfigOverrides: string[] | undefined;
    if (effectiveWorkflow && mcpConfigForCommand) {
        if (mcpConfigDelivery === 'cli-overrides') {
            mcpConfigOverrides = codeAgent.buildMcpOverrides(mcpConfigForCommand);
        } else if (mcpConfigDelivery === 'cli') {
            mcpConfigPath = path.join(path.dirname(settingsPath), 'mcp-config.json');
            await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfigForCommand, null, 2), 'utf-8');
        }
    }

    const settingsPathForCommand = codeAgent.getProjectSettingsPath(input.worktreePath)
        ? undefined
        : settingsPath;

    const sessionData = await getSessionId(input.worktreePath, codeAgent);

    return {
        codeAgent,
        sessionData: sessionData?.sessionId ? { sessionId: sessionData.sessionId } : null,
        effectiveWorkflow,
        effectivePermissionMode,
        settingsPath: settingsPathForCommand,
        mcpConfigPath,
        mcpConfigOverrides
    };
}

export async function buildAgentLaunchCommand(
    context: LaunchContext,
    input: LaunchCommandInput = {}
): Promise<LaunchCommandResult> {
    const preferResume = input.preferResume ?? true;
    if (preferResume && context.sessionData?.sessionId) {
        try {
            const command = context.codeAgent.buildResumeCommand(context.sessionData.sessionId, {
                settingsPath: context.settingsPath,
                mcpConfigPath: context.mcpConfigPath,
                mcpConfigOverrides: context.mcpConfigOverrides
            });
            return { mode: 'resume', command };
        } catch {
            // Invalid persisted session ids should not block a fresh launch.
        }
    }

    const command = context.codeAgent.buildStartCommand({
        permissionMode: context.effectivePermissionMode,
        settingsPath: context.settingsPath,
        mcpConfigPath: context.mcpConfigPath,
        mcpConfigOverrides: context.mcpConfigOverrides,
        prompt: input.prompt
    });
    return { mode: 'start', command };
}
