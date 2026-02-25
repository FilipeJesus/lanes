/**
 * AgentLaunchService - Shared launch preparation for CLI and VS Code.
 *
 * Centralizes workflow/permission restoration, settings + MCP setup,
 * and session lookup so frontends can focus on terminal/process behavior.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { CodeAgent, McpConfig, McpConfigDelivery } from '../codeAgents';
import { getSessionId, getSessionPermissionMode, getSessionWorkflow } from '../session/SessionDataService';
import type { AgentSessionData } from '../session/types';
import * as SettingsService from './SettingsService';
import { getErrorMessage } from '../utils';

export interface PrepareAgentLaunchOptions {
    worktreePath: string;
    workflow?: string | null;
    permissionMode?: string;
    codeAgent?: CodeAgent;
    repoRoot?: string;
    onWarning?: (message: string) => void;
    fallbackMcpConfigFactory?: (params: {
        worktreePath: string;
        workflowPath: string;
        repoRoot: string;
    }) => McpConfig | null;
}

export interface PreparedAgentLaunchContext {
    effectiveWorkflow: string | null;
    effectivePermissionMode: string;
    settingsPath?: string;
    mcpConfigPath?: string;
    mcpConfigOverrides?: string[];
    sessionData: AgentSessionData | null;
}

function getMcpConfigDelivery(codeAgent?: CodeAgent): McpConfigDelivery {
    return codeAgent?.getMcpConfigDelivery() ?? 'cli';
}

export async function prepareAgentLaunchContext(
    options: PrepareAgentLaunchOptions
): Promise<PreparedAgentLaunchContext> {
    const {
        worktreePath,
        workflow,
        permissionMode,
        codeAgent,
        repoRoot,
        onWarning,
        fallbackMcpConfigFactory,
    } = options;

    let effectiveWorkflow: string | null = workflow || null;
    if (!effectiveWorkflow) {
        effectiveWorkflow = await getSessionWorkflow(worktreePath);
    }

    let effectivePermissionMode = permissionMode;
    if (!effectivePermissionMode) {
        effectivePermissionMode = await getSessionPermissionMode(worktreePath) || undefined;
    }
    effectivePermissionMode = effectivePermissionMode || 'acceptEdits';

    let settingsPath: string | undefined;
    let mcpConfigPath: string | undefined;
    let mcpConfigOverrides: string[] | undefined;

    try {
        let mcpConfigForSettings: McpConfig | undefined;
        let mcpConfig: McpConfig | null = null;
        let mcpConfigDelivery: McpConfigDelivery | undefined;

        if (effectiveWorkflow) {
            const effectiveRepoRoot = repoRoot || await SettingsService.getBaseRepoPath(worktreePath);

            if (codeAgent?.supportsMcp()) {
                mcpConfig = codeAgent.getMcpConfig(worktreePath, effectiveWorkflow, effectiveRepoRoot);
                mcpConfigDelivery = getMcpConfigDelivery(codeAgent);
                if (mcpConfig && mcpConfigDelivery === 'settings') {
                    mcpConfigForSettings = mcpConfig;
                }
            } else if (fallbackMcpConfigFactory) {
                mcpConfig = fallbackMcpConfigFactory({
                    worktreePath,
                    workflowPath: effectiveWorkflow,
                    repoRoot: effectiveRepoRoot,
                });
                mcpConfigDelivery = 'cli';
            }
        }

        settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(
            worktreePath,
            effectiveWorkflow ?? undefined,
            codeAgent,
            mcpConfigForSettings
        );

        if (effectiveWorkflow && mcpConfig) {
            const delivery = mcpConfigDelivery ?? getMcpConfigDelivery(codeAgent);
            if (delivery === 'cli-overrides' && codeAgent) {
                mcpConfigOverrides = codeAgent.buildMcpOverrides(mcpConfig);
            } else if (delivery === 'cli') {
                mcpConfigPath = path.join(path.dirname(settingsPath), 'mcp-config.json');
                await fsPromises.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
            }
        }
    } catch (err) {
        onWarning?.(`Failed to create extension settings file: ${getErrorMessage(err)}`);
    }

    if (codeAgent?.getProjectSettingsPath(worktreePath)) {
        settingsPath = undefined;
    }

    const sessionData = await getSessionId(worktreePath, codeAgent);

    return {
        effectiveWorkflow,
        effectivePermissionMode,
        settingsPath,
        mcpConfigPath,
        mcpConfigOverrides,
        sessionData,
    };
}
