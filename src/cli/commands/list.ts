/**
 * `lanes list` — List active sessions with their status.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerListCommand(program: Command): void {
    program
        .command('list')
        .alias('ls')
        .description('List active sessions')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const sessions = await operations.listSessions();
                    if (options.json) {
                        console.log(JSON.stringify(sessions, null, 2));
                        return;
                    }

                    if (sessions.length === 0) {
                        console.log('No active sessions.');
                        return;
                    }

                    console.log(`${'NAME'.padEnd(25)} ${'STATUS'.padEnd(12)} ${'AGENT'.padEnd(10)} ${'BRANCH'.padEnd(30)} WORKFLOW`);
                    console.log('-'.repeat(90));
                    for (const session of sessions) {
                        console.log(
                            `${session.name.padEnd(25)} ${session.status.padEnd(12)} ${session.agent.padEnd(10)} ${session.branch.padEnd(30)} ${session.workflow || ''}`
                        );
                    }
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
