/**
 * `lanes status [session-name]` — Show session status details.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerStatusCommand(program: Command): void {
    program
        .command('status [session-name]')
        .description('Show session status')
        .option('--json', 'Output as JSON')
        .action(async (sessionName: string | undefined, options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    if (!sessionName) {
                        console.log(
                            operations.targetKind === 'remote'
                                ? 'Tip: Use "lanes list --host <url>" to see all sessions, or "lanes status <name> --host <url>" for details.'
                                : 'Tip: Use "lanes list" to see all sessions, or "lanes status <name>" for details.'
                        );
                        return;
                    }

                    const result = await operations.getSessionStatus(sessionName);
                    if (options.json) {
                        console.log(JSON.stringify(result, null, 2));
                        return;
                    }

                    console.log(`Session:   ${result.name}`);
                    console.log(`Agent:     ${result.agent}`);
                    console.log(`Status:    ${result.status}`);
                    if (result.sessionId) {
                        console.log(`Session ID: ${result.sessionId}`);
                    }
                    if (result.timestamp) {
                        console.log(`Updated:   ${result.timestamp}`);
                    }
                    if (result.workflow) {
                        console.log(`Workflow:  ${result.workflow.workflow || 'active'}`);
                        if (result.workflow.step) {
                            console.log(`Step:      ${result.workflow.step}`);
                        }
                        if (result.workflow.summary) {
                            console.log(`Summary:   ${result.workflow.summary}`);
                        }
                    }
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
