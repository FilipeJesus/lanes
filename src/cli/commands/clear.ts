/**
 * `lanes clear <session-name>` — Clear a session and restart fresh.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import {
    clearSessionId,
    getSessionAgentName,
    initializeGlobalStorageContext,
    getSessionTerminalMode,
} from '../../core/session/SessionDataService';
import { validateAndGetAgent } from '../../core/codeAgents';
import * as TmuxService from '../../core/services/TmuxService';
import { getErrorMessage } from '../../core/utils';
import { execIntoAgent } from './open';

export function registerClearCommand(program: Command): void {
    program
        .command('clear <session-name>')
        .description('Clear a session and restart with fresh context')
        .option('--tmux', 'Use tmux backend')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                // Kill tmux session if applicable
                const terminalMode = await getSessionTerminalMode(worktreePath);
                if (terminalMode === 'tmux') {
                    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
                    await TmuxService.killSession(tmuxSessionName).catch(() => {});
                }

                // Clear session ID
                await clearSessionId(worktreePath);

                // Resolve agent
                const agentName = await getSessionAgentName(worktreePath);
                const { agent: codeAgent, warning } = await validateAndGetAgent(agentName);
                if (warning) {exitWithError(warning);}
                if (!codeAgent) {exitWithError(`Agent '${agentName}' not available.`);}

                initializeGlobalStorageContext(
                    path.join(repoRoot, '.lanes'),
                    repoRoot,
                    codeAgent
                );

                console.log(`Session '${sessionName}' cleared. Starting fresh...`);

                // Exec into agent with fresh session
                await execIntoAgent({
                    sessionName,
                    worktreePath,
                    repoRoot,
                    codeAgent,
                    config,
                    useTmux: options.tmux || config.get<string>('lanes', 'terminalMode', 'vscode') === 'tmux',
                    isNewSession: true,
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
