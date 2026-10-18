import * as crypto from 'crypto';
import * as path from 'path';
import {
    CodeAgent,
    DEFAULT_AGENT_NAME,
    getAgent,
    getDefaultAgent,
    isCliAvailable,
} from '../../core/codeAgents';
import { getErrorMessage } from '../../core/utils';
import { execGit } from '../../gitService';

export type QuickStartGitExecutor = (args: string[], cwd: string) => Promise<string>;

export interface QuickStartLaunchRequest {
    taskName: string;
    repoRoot: string;
    codeAgent: CodeAgent;
    mcpWorkflowPath: string;
}

export interface QuickStartOptions {
    repoRoot?: string;
    extensionPath: string;
    getConfiguredAgentName: () => string;
    openTerminal: (request: QuickStartLaunchRequest) => Promise<void>;
    showError: (message: string) => void;
    showWarning: (message: string) => void;
    gitRepositoryCheck?: (repoRoot: string) => Promise<boolean>;
    cliAvailabilityCheck?: (cliCommand: string) => Promise<boolean>;
}

/**
 * Build a stable repository-and-agent-specific identity for Quick Start
 * terminals and tmux sessions. Tmux session names are global to the user, so
 * both values are needed to prevent attaching to another launch.
 */
export function getQuickStartTaskName(repoRoot: string, agentName: string): string {
    const normalizedPath = path.normalize(repoRoot).toLowerCase();
    const normalizedAgent = agentName.replace(/[^a-zA-Z0-9_-]/g, '_') || 'agent';
    const repoHash = crypto.createHash('sha256')
        .update(`${normalizedPath}:${normalizedAgent}`)
        .digest('hex')
        .substring(0, 8);
    const repoName = path.basename(repoRoot).replace(/[^a-zA-Z0-9_-]/g, '_') || 'repository';
    return `Quick Start-${normalizedAgent}-${repoName}-${repoHash}`;
}

/** Verify the launch directory is an actual Git working tree. */
export async function isQuickStartGitRepository(
    repoRoot: string,
    gitExecutor: QuickStartGitExecutor = execGit
): Promise<boolean> {
    try {
        const result = await gitExecutor(['rev-parse', '--is-inside-work-tree'], repoRoot);
        return result.trim() === 'true';
    } catch {
        return false;
    }
}

/**
 * Quick Start must supply MCP transiently so launching it never edits an
 * agent's project settings or the repository's .gitignore.
 */
export function getQuickStartMcpUnsupportedReason(codeAgent: CodeAgent): string | null {
    if (!codeAgent.supportsMcp()) {
        return `${codeAgent.displayName} does not support MCP.`;
    }

    if (codeAgent.getMcpConfigDelivery() === 'settings') {
        return `${codeAgent.displayName} only supports project-settings MCP delivery, which Quick Start disables to avoid modifying repository files.`;
    }

    return null;
}

/** Execute one Quick Start invocation using the current default-agent setting. */
export async function executeQuickStart(options: QuickStartOptions): Promise<void> {
    const repoRoot = options.repoRoot;
    const gitRepositoryCheck = options.gitRepositoryCheck ?? isQuickStartGitRepository;
    if (!repoRoot || !await gitRepositoryCheck(repoRoot)) {
        options.showError('Open a Git repository before starting a Quick Start session.');
        return;
    }

    const defaultAgentResult = getDefaultAgent(options.getConfiguredAgentName());
    if (defaultAgentResult.warning) {
        options.showWarning(defaultAgentResult.warning);
    }
    const codeAgent = getAgent(defaultAgentResult.agent) ?? getAgent(DEFAULT_AGENT_NAME)!;

    const unsupportedReason = getQuickStartMcpUnsupportedReason(codeAgent);
    if (unsupportedReason) {
        options.showError(`Quick Start is unavailable: ${unsupportedReason}`);
        return;
    }

    const cliAvailabilityCheck = options.cliAvailabilityCheck ?? isCliAvailable;
    if (!await cliAvailabilityCheck(codeAgent.cliCommand)) {
        options.showError(
            `${codeAgent.displayName} CLI ('${codeAgent.cliCommand}') is not installed. ` +
            'Install it or change the default agent in Lanes settings.'
        );
        return;
    }

    try {
        await options.openTerminal({
            taskName: getQuickStartTaskName(repoRoot, codeAgent.name),
            repoRoot,
            codeAgent,
            mcpWorkflowPath: path.join(options.extensionPath, 'workflows', 'default.yaml'),
        });
    } catch (err) {
        options.showError(`Quick Start could not configure the required Lanes MCP: ${getErrorMessage(err)}`);
    }
}
