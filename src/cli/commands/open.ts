/**
 * `lanes open <session-name>` — Open/resume a session by exec-ing into the agent.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { launchCliSession } from '../sessionLauncher';
import { getErrorMessage } from '../../core/utils';

export function registerOpenCommand(program: Command): void {
    program
        .command('open <session-name>')
        .description('Open/resume a session')
        .option('--tmux', 'Use tmux backend')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const launch = await operations.openSession(sessionName, {
                        preferTmux: options.tmux,
                    });
                    if (operations.targetKind === 'remote') {
                        console.log(`Session '${sessionName}' opened on ${operations.host}.`);
                    }
                    await launchCliSession(launch);
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
