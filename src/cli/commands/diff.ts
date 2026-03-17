/**
 * `lanes diff <session-name>` — Show git diff for a session.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerDiffCommand(program: Command): void {
    program
        .command('diff <session-name>')
        .description('Show git diff for a session')
        .option('--base <branch>', 'Base branch to diff against')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const result = await operations.getSessionDiff(sessionName, {
                        baseBranch: options.base,
                    });
                    if (!result.diff || result.diff.trim() === '') {
                        console.log(`No changes found when comparing to '${result.baseBranch}'.`);
                        return;
                    }
                    console.log(result.diff);
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
