/**
 * AgentLaunchService - Shared launch preparation for all adapters.
 *
 * Centralizes workflow/permission restoration, settings + MCP setup,
 * agent resolution, command building, and session lookup so frontends
 * can focus on terminal/process behavior.
 */

import * as path from 'path';
import * as os from 'os';
import * as fsPromises from 'fs/promises';
import { CodeAgent, McpConfig, McpConfigDelivery, getAgent, DEFAULT_AGENT_NAME } from '../codeAgents';
import { getSessionId, getSessionPermissionMode, getSessionWorkflow, getSettingsDir, getSessionFilePath } from '../session/SessionDataService';
import { ensureDir, readJson, writeJson } from './FileService';
import type { AgentSessionData } from '../session/types';
import * as SettingsService from './SettingsService';
import { discoverWorkflows } from '../workflow/discovery';
import { getErrorMessage } from '../utils';

// ---------------------------------------------------------------------------
// Types used by VS Code / CLI (original interface)
// ---------------------------------------------------------------------------

export interface PrepareAgentLaunchOptions {
    worktreePath: string;
    workflow?: string | null;
    /** Fail the launch unless MCP is configured through a transient CLI mechanism. */
    requireTransientMcp?: boolean;
    /** Do not read or write persistent Lanes session metadata for this launch. */
    transientSession?: boolean;
    permissionMode?: string;
    codeAgent?: CodeAgent;
    repoRoot?: string;
    /** Root path for discovering built-in workflows (extension or package root). */
    extensionPath?: string;
    /** Custom workflows folder relative to repo root (default: '.lanes/workflows'). */
    customWorkflowsFolder?: string;
    onWarning?: (message: string) => void;
    fallbackMcpConfigFactory?: (params: {
        worktreePath: string;
        workflowPath: string;
        repoRoot: string;
    }) => McpConfig | null;

    // --- Bridge-style fields (optional, for callers that resolve agent/workflow externally) ---
    /** Agent name to resolve via getAgent() when codeAgent is not provided. */
    agentName?: string;
    /** Fallback agent name when neither codeAgent nor agentName is set. */
    defaultAgentName?: string;
    /** Callback-based workflow resolver (alternative to extensionPath/customWorkflowsFolder). */
    workflowResolver?: (workflow: string) => Promise<string | null>;
}

export interface PreparedAgentLaunchContext {
    /** Reserved session log file for a fresh launch, persisted before starting the process. */
    sessionPath?: string;
    effectiveWorkflow: string | null;
    effectivePermissionMode: string;
    settingsPath?: string;
    mcpConfigPath?: string;
    mcpConfigOverrides?: string[];
    sessionData: AgentSessionData | null;
    /** Resolved code agent (always set when agentName/defaultAgentName was used). */
    codeAgent?: CodeAgent;
}

// ---------------------------------------------------------------------------
// Types used by bridge (command building)
// ---------------------------------------------------------------------------

export type LaunchMode = 'start' | 'resume';

export interface LaunchCommandResult {
    mode: LaunchMode;
    command: string;
}

export interface LaunchCommandInput {
    prompt?: string;
    promptFilePath?: string;
    preferResume?: boolean;
}

/**
 * Context shape expected by buildAgentLaunchCommand.
 * PreparedAgentLaunchContext satisfies this when codeAgent is set.
 */
export interface LaunchContext {
    sessionPath?: string;
    codeAgent: CodeAgent;
    sessionData: { sessionId: string; logPath?: string } | null;
    effectiveWorkflow: string | null;
    effectivePermissionMode: string | undefined;
    settingsPath?: string;
    mcpConfigPath?: string;
    mcpConfigOverrides?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getMcpConfigDelivery(codeAgent?: CodeAgent): McpConfigDelivery {
    return codeAgent?.getMcpConfigDelivery() ?? 'cli';
}

async function writeTransientMcpConfig(config: McpConfig): Promise<string> {
    // A unique private directory prevents another local process from pre-creating
    // or symlinking the config path before Lanes writes agent launch credentials.
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'lanes-quick-start-'));
    await fsPromises.chmod(tempDir, 0o700);
    const configPath = path.join(tempDir, 'mcp-config.json');
    await fsPromises.writeFile(configPath, JSON.stringify(config, null, 2), {
        encoding: 'utf-8',
        flag: 'wx',
        mode: 0o600,
    });
    return configPath;
}

function resolveAgentFromName(agentName?: string, defaultAgentName?: string): CodeAgent {
    const requested = agentName ?? defaultAgentName ?? DEFAULT_AGENT_NAME;
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

export function normalizeMcpConfig(config: McpConfig | null): McpConfig | null {
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

/**
 * Resolves a workflow name to its absolute YAML path using either:
 * 1. A workflowResolver callback (bridge style)
 * 2. discoverWorkflows with extensionPath/customWorkflowsFolder (VS Code/CLI style)
 */
async function resolveWorkflowPath(
    workflow: string,
    repoRoot: string,
    extensionPath?: string,
    customWorkflowsFolder?: string,
    workflowResolver?: (workflow: string) => Promise<string | null>,
): Promise<string | null> {
    if (path.isAbsolute(workflow) && workflow.endsWith('.yaml')) {
        return workflow;
    }

    // Prefer callback resolver if provided
    if (workflowResolver) {
        const resolved = await workflowResolver(workflow);
        if (!resolved) {
            throw new Error(`Workflow not found: ${workflow}`);
        }
        return resolved;
    }

    // Fall back to discovery-based resolution
    const workflows = await discoverWorkflows({
        extensionPath: extensionPath || repoRoot,
        workspaceRoot: repoRoot,
        customWorkflowsFolder: customWorkflowsFolder || '.lanes/workflows',
    });

    const matched = workflows.find(w => w.name === workflow);
    return matched?.path ?? null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function prepareAgentLaunchContext(
    options: PrepareAgentLaunchOptions
): Promise<PreparedAgentLaunchContext> {
    const {
        worktreePath,
        workflow,
        requireTransientMcp,
        transientSession,
        permissionMode,
        repoRoot,
        extensionPath,
        customWorkflowsFolder,
        onWarning,
        fallbackMcpConfigFactory,
        agentName,
        defaultAgentName,
        workflowResolver,
    } = options;

    // Resolve code agent: prefer explicit codeAgent, then resolve from name
    const codeAgent = options.codeAgent
        ?? (agentName || defaultAgentName ? resolveAgentFromName(agentName, defaultAgentName) : undefined);

    // --- Resolve workflow ---
    let effectiveWorkflow: string | null = workflow || null;
    if (!effectiveWorkflow && !transientSession) {
        effectiveWorkflow = await getSessionWorkflow(worktreePath);
    }

    if (effectiveWorkflow && !path.isAbsolute(effectiveWorkflow)) {
        const effectiveRepoRoot = repoRoot || await SettingsService.getBaseRepoPath(worktreePath);

        if (workflowResolver) {
            // Bridge-style: use callback resolver
            try {
                effectiveWorkflow = await resolveWorkflowPath(
                    effectiveWorkflow, effectiveRepoRoot,
                    undefined, undefined, workflowResolver);
            } catch {
                onWarning?.(`Workflow '${effectiveWorkflow}' not found.`);
                effectiveWorkflow = null;
            }
        } else {
            // VS Code/CLI-style: use discovery
            const resolved = await resolveWorkflowPath(
                effectiveWorkflow, effectiveRepoRoot,
                extensionPath, customWorkflowsFolder);
            if (resolved) {
                effectiveWorkflow = resolved;
            } else {
                onWarning?.(`Workflow '${effectiveWorkflow}' not found. Run 'lanes workflow list' to see available workflows.`);
                effectiveWorkflow = null;
            }
        }
    }

    // --- Resolve permission mode ---
    let effectivePermissionMode = permissionMode;
    if (!effectivePermissionMode && !transientSession) {
        effectivePermissionMode = await getSessionPermissionMode(worktreePath) || undefined;
    }
    effectivePermissionMode = effectivePermissionMode || 'acceptEdits';
    // Some agents (Pi) always run unrestricted and cannot enforce acceptEdits.
    const permissionModes = codeAgent?.getPermissionModes();
    if (permissionModes?.length === 1) {
        effectivePermissionMode = permissionModes[0].id;
    }

    // --- Settings + MCP config ---
    let settingsPath: string | undefined;
    let mcpConfigPath: string | undefined;
    let mcpConfigOverrides: string[] | undefined;
    const workflowPathForMcp = effectiveWorkflow || '';

    if (requireTransientMcp) {
        if (!codeAgent?.supportsMcp()) {
            throw new Error(`${codeAgent?.displayName ?? 'The selected agent'} does not support MCP.`);
        }
        if (getMcpConfigDelivery(codeAgent) === 'settings') {
            throw new Error(`${codeAgent.displayName} cannot receive MCP configuration without modifying project settings.`);
        }
    }

    try {
        let mcpConfigForSettings: McpConfig | undefined;
        let mcpConfig: McpConfig | null = null;
        let mcpConfigDelivery: McpConfigDelivery | undefined;

        const effectiveRepoRoot = repoRoot || await SettingsService.getBaseRepoPath(worktreePath);

        if (codeAgent?.supportsMcp()) {
            mcpConfig = codeAgent.getMcpConfig(worktreePath, workflowPathForMcp, effectiveRepoRoot);
            // Normalize MCP server paths (bridge-style fix for bundled paths)
            if (workflowResolver) {
                mcpConfig = normalizeMcpConfig(mcpConfig);
            }
            mcpConfigDelivery = getMcpConfigDelivery(codeAgent);
            if (mcpConfig && mcpConfigDelivery === 'settings') {
                mcpConfigForSettings = mcpConfig;
            }
        } else if (fallbackMcpConfigFactory) {
            mcpConfig = fallbackMcpConfigFactory({
                worktreePath,
                workflowPath: workflowPathForMcp,
                repoRoot: effectiveRepoRoot,
            });
            mcpConfigDelivery = 'cli';
        }

        // A session without an assigned workflow exposes only session_create.
        if (mcpConfig && !effectiveWorkflow) {
            for (const server of Object.values(mcpConfig.mcpServers)) {
                const workflowArgIndex = server.args.indexOf('--workflow-path');
                if (workflowArgIndex !== -1) { server.args.splice(workflowArgIndex, 2); }
            }
        }

        if (!transientSession) {
            settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(
                worktreePath,
                workflowResolver ? (workflow ? effectiveWorkflow : null) : (effectiveWorkflow ?? undefined),
                codeAgent,
                mcpConfigForSettings,
                effectivePermissionMode
            );
        }

        if (mcpConfig) {
            const delivery = mcpConfigDelivery ?? getMcpConfigDelivery(codeAgent);
            if (delivery === 'cli-overrides' && codeAgent) {
                mcpConfigOverrides = codeAgent.buildMcpOverrides(mcpConfig);
            } else if (delivery === 'cli') {
                if (transientSession) {
                    mcpConfigPath = await writeTransientMcpConfig(mcpConfig);
                } else {
                    mcpConfigPath = path.join(path.dirname(settingsPath!), 'mcp-config.json');
                    await fsPromises.mkdir(path.dirname(mcpConfigPath), { recursive: true });
                    await fsPromises.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
                }
            }
        }

        if (requireTransientMcp && !mcpConfigPath && !mcpConfigOverrides?.length) {
            throw new Error(`${codeAgent?.displayName ?? 'The selected agent'} did not produce a transient MCP configuration.`);
        }
    } catch (err) {
        const message = `Failed to configure agent settings: ${getErrorMessage(err)}`;
        if (requireTransientMcp) {
            throw new Error(`Failed to configure required Lanes MCP: ${getErrorMessage(err)}`);
        }
        onWarning?.(message);
    }

    if (codeAgent?.getProjectSettingsPath(worktreePath)) {
        settingsPath = undefined;
    }

    const sessionData = transientSession ? null : await getSessionId(worktreePath, codeAgent);
    let sessionPath: string | undefined;
    if (!transientSession && !sessionData && codeAgent) {
        const identity = codeAgent.createSessionIdentity(getSettingsDir(worktreePath));
        if (identity) {
            // Pi may not create a log until its first response. Reserving the path
            // makes resume reliable even when startup is idle or the CLI blocks.
            const metadataPath = getSessionFilePath(worktreePath);
            await ensureDir(path.dirname(metadataPath));
            const existing = await readJson<Record<string, unknown>>(metadataPath).catch(() => null) || {};
            await writeJson(metadataPath, {
                ...existing,
                ...identity,
                agentName: codeAgent.name,
                timestamp: new Date().toISOString()
            });
            sessionPath = identity.logPath;
        }
    }

    return {
        sessionPath,
        effectiveWorkflow,
        effectivePermissionMode,
        settingsPath,
        mcpConfigPath,
        mcpConfigOverrides,
        sessionData,
        codeAgent,
    };
}

// ---------------------------------------------------------------------------
// Command building (used by bridge)
// ---------------------------------------------------------------------------

export async function buildAgentLaunchCommand(
    context: LaunchContext | PreparedAgentLaunchContext,
    input: LaunchCommandInput = {}
): Promise<LaunchCommandResult> {
    const agent = context.codeAgent;
    if (!agent) {
        throw new Error('buildAgentLaunchCommand requires codeAgent to be set');
    }
    const preferResume = input.preferResume ?? true;
    if (preferResume && context.sessionData?.sessionId) {
        try {
            const command = agent.buildResumeCommand(context.sessionData.sessionId, {
                sessionPath: context.sessionData.logPath,
                permissionMode: context.effectivePermissionMode,
                settingsPath: context.settingsPath,
                mcpConfigPath: context.mcpConfigPath,
                mcpConfigOverrides: context.mcpConfigOverrides
            });
            return { mode: 'resume', command };
        } catch {
            // Invalid persisted session ids should not block a fresh launch.
        }
    }

    const command = agent.buildStartCommand({
        sessionPath: context.sessionPath,
        promptFilePath: input.promptFilePath,
        permissionMode: context.effectivePermissionMode,
        settingsPath: context.settingsPath,
        mcpConfigPath: context.mcpConfigPath,
        mcpConfigOverrides: context.mcpConfigOverrides,
        prompt: input.prompt
    });
    return { mode: 'start', command };
}
