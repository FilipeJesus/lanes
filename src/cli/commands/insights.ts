/**
 * `lanes insights <session-name>` — Generate conversation insights.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerInsightsCommand(program: Command): void {
    program
        .command('insights <session-name>')
        .description('Generate conversation insights for a session')
        .option('--json', 'Output as JSON')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const result = await operations.getSessionInsights(sessionName, {
                        includeJson: options.json,
                    });

                    if (options.json) {
                        console.log(JSON.stringify(result.json, null, 2));
                        return;
                    }

                    console.log(result.text);
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
