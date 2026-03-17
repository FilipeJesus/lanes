/**
 * `lanes delete <session-name>` — Delete a session and its worktree.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerDeleteCommand(program: Command): void {
    program
        .command('delete <session-name>')
        .alias('rm')
        .description('Delete a session and its worktree')
        .option('--force', 'Force deletion without confirmation')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    if (!options.force) {
                        if (operations.targetKind === 'remote') {
                            console.log(`This will delete session '${sessionName}' from ${operations.host}.`);
                        } else {
                            console.log(`This will delete session '${sessionName}' and its worktree.`);
                        }
                        console.log('Use --force to skip this message.');
                        exitWithError('Deletion cancelled. Use --force to confirm.');
                    }

                    await operations.deleteSession(sessionName);
                    console.log(`Session '${sessionName}' deleted.`);
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
