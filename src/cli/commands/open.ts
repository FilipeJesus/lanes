/**
 * `lanes open <session-name>` — Open/resume a session by exec-ing into the agent.
 */

import { Command } from 'commander';
import * as path from 'path';
import { execSync } from 'child_process';
import { initCli, exitWithError } from '../utils';
import { CliConfigProvider } from '../adapters/CliConfigProvider';
import { fileExists } from '../../core/services/FileService';
import { getErrorMessage } from '../../core/utils';
import {
    getSessionAgentName,
    getOrCreateTaskListId,
    saveSessionPermissionMode,
    saveSessionTerminalMode,
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';
import { validateAndGetAgent } from '../../core/codeAgents';
import { CodeAgent } from '../../core/codeAgents/CodeAgent';
import { prepareAgentLaunchContext } from '../../core/services/AgentLaunchService';
import * as TmuxService from '../../core/services/TmuxService';

/**
 * Shared function used by both `lanes open` and `lanes create` to exec into an agent.
 */
export async function execIntoAgent(opts: {
    sessionName: string;
    worktreePath: string;
    repoRoot: string;
    codeAgent: CodeAgent;
    config: CliConfigProvider;
    prompt?: string;
    permissionMode?: string;
    workflow?: string | null;
    useTmux: boolean;
    isNewSession: boolean;
}): Promise<void> {
    const {
        sessionName, worktreePath, repoRoot, codeAgent, config,
        prompt, permissionMode, workflow, useTmux, isNewSession,
    } = opts;

    // Get or create task list ID
    const taskListId = await getOrCreateTaskListId(worktreePath, sessionName);

    const launch = await prepareAgentLaunchContext({
        worktreePath,
        workflow,
        permissionMode,
        codeAgent,
        repoRoot,
        onWarning: (message) => console.warn(`Warning: ${message}`),
    });

    // Build the command
    let command: string;

    if (!isNewSession && launch.sessionData?.sessionId) {
        // Resume existing session
        command = codeAgent.buildResumeCommand(launch.sessionData.sessionId, {
            settingsPath: launch.settingsPath,
            mcpConfigPath: launch.mcpConfigPath,
            mcpConfigOverrides: launch.mcpConfigOverrides,
        });
    } else {
        // Start fresh session
        await saveSessionPermissionMode(worktreePath, launch.effectivePermissionMode);

        command = codeAgent.buildStartCommand({
            permissionMode: launch.effectivePermissionMode,
            settingsPath: launch.settingsPath,
            mcpConfigPath: launch.mcpConfigPath,
            mcpConfigOverrides: launch.mcpConfigOverrides,
            prompt: prompt || undefined,
        });
    }

    // Set up environment
    const env: Record<string, string> = {
        ...process.env as Record<string, string>,
        CLAUDE_CODE_TASK_LIST_ID: taskListId,
    };

    // Persist terminal mode so delete/clear can detect tmux sessions
    await saveSessionTerminalMode(worktreePath, useTmux ? 'tmux' : 'code');

    if (useTmux) {
        // Tmux mode: create/attach to tmux session
        if (!await TmuxService.isTmuxInstalled()) {
            exitWithError('Tmux is not installed. Install tmux or omit --tmux.');
        }

        const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
        const tmuxSessionExists = await TmuxService.sessionExists(tmuxSessionName);

        if (tmuxSessionExists) {
            // Attach to existing session
            execSync(`tmux attach-session -t ${tmuxSessionName}`, {
                cwd: worktreePath,
                stdio: 'inherit',
                env,
            });
        } else {
            // Create new tmux session and send the agent command
            await TmuxService.createSession(tmuxSessionName, worktreePath);
            await TmuxService.sendCommand(tmuxSessionName, `export CLAUDE_CODE_TASK_LIST_ID='${taskListId}'`);
            await TmuxService.sendCommand(tmuxSessionName, command);

            // Attach to the session
            execSync(`tmux attach-session -t ${tmuxSessionName}`, {
                cwd: worktreePath,
                stdio: 'inherit',
                env,
            });
        }
    } else {
        // Default mode: exec into the agent process directly
        try {
            execSync(command, {
                cwd: worktreePath,
                stdio: 'inherit',
                env,
            });
        } catch {
            // Agent exited — this is normal (user quit the agent)
        }
    }
}

export function registerOpenCommand(program: Command): void {
    program
        .command('open <session-name>')
        .description('Open/resume a session')
        .option('--tmux', 'Use tmux backend')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                // Resolve agent from session metadata
                const agentName = await getSessionAgentName(worktreePath);
                const { agent: codeAgent, warning } = await validateAndGetAgent(agentName);
                if (warning) {exitWithError(warning);}
                if (!codeAgent) {exitWithError(`Agent '${agentName}' not available.`);}

                // Re-initialize storage context with session's agent
                initializeGlobalStorageContext(
                    path.join(repoRoot, '.lanes'),
                    repoRoot,
                    codeAgent
                );

                await execIntoAgent({
                    sessionName,
                    worktreePath,
                    repoRoot,
                    codeAgent,
                    config,
                    useTmux: options.tmux || config.get<string>('lanes', 'terminalMode', 'vscode') === 'tmux',
                    isNewSession: false,
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
