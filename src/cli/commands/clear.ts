/**
 * `lanes clear <session-name>` — Clear a session and restart fresh.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { launchCliSession } from '../sessionLauncher';
import { getErrorMessage } from '../../core/utils';

export function registerClearCommand(program: Command): void {
    program
        .command('clear <session-name>')
        .description('Clear a session and restart with fresh context')
        .option('--tmux', 'Use tmux backend')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const launch = await operations.clearSession(sessionName, {
                        preferTmux: options.tmux,
                    });
                    console.log(
                        operations.targetKind === 'remote'
                            ? `Session '${sessionName}' cleared on ${operations.host}.`
                            : `Session '${sessionName}' cleared. Starting fresh...`
                    );
                    await launchCliSession(launch);
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
