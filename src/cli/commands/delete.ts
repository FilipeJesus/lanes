/**
 * `lanes delete <session-name>` — Delete a session and its worktree.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { addDaemonHostOption, createCliDaemonClient, initCli, exitWithError } from '../utils';
import { execGit } from '../../core/gitService';
import { fileExists } from '../../core/services/FileService';
import * as TmuxService from '../../core/services/TmuxService';
import { getSessionTerminalMode } from '../../core/session/SessionDataService';
import { getErrorMessage } from '../../core/utils';

export function registerDeleteCommand(program: Command): void {
    addDaemonHostOption(program
        .command('delete <session-name>')
        .alias('rm')
        .description('Delete a session and its worktree')
        .option('--force', 'Force deletion without confirmation'))
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();

                if (options.host) {
                    if (!options.force) {
                        console.log(`This will delete session '${sessionName}' from ${options.host}.`);
                        console.log('Use --force to skip this message.');
                        exitWithError('Deletion cancelled. Use --force to confirm.');
                    }

                    const client = await createCliDaemonClient(repoRoot, options);
                    await client.deleteSession(sessionName);
                    console.log(`Session '${sessionName}' deleted.`);
                    return;
                }

                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                if (!options.force) {
                    console.log(`This will delete session '${sessionName}' and its worktree.`);
                    console.log(`Use --force to skip this message.`);
                    exitWithError('Deletion cancelled. Use --force to confirm.');
                }

                // Kill tmux session if applicable
                const terminalMode = await getSessionTerminalMode(worktreePath);
                if (terminalMode === 'tmux') {
                    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(sessionName);
                    await TmuxService.killSession(tmuxSessionName).catch(() => {});
                }

                // Remove worktree
                await execGit(['worktree', 'remove', worktreePath, '--force'], repoRoot);

                // Clean up session management files
                const sessionMgmtDir = path.join(repoRoot, '.lanes', 'current-sessions', sessionName);
                await fsPromises.rm(sessionMgmtDir, { recursive: true, force: true }).catch(() => {});

                console.log(`Session '${sessionName}' deleted.`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
