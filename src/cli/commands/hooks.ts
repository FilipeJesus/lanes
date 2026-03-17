/**
 * `lanes hooks <session-name>` — Setup status hooks for a session.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerHooksCommand(program: Command): void {
    program
        .command('hooks <session-name>')
        .description('Setup status hooks for a session')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const settingsPath = await operations.setupSessionHooks(sessionName);
                    console.log(`Status hooks configured for '${sessionName}' at ${settingsPath}`);
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
