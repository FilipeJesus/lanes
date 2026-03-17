/**
 * `lanes repair` — Repair broken worktrees.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerRepairCommand(program: Command): void {
    program
        .command('repair')
        .description('Detect and repair broken worktrees')
        .option('--dry-run', 'Only detect broken worktrees, do not repair')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const result = await operations.repairWorktrees({
                        dryRun: Boolean(options.dryRun),
                    });

                    if (result.broken.length === 0) {
                        console.log('No broken worktrees found.');
                        return;
                    }

                    console.log(`Found ${result.broken.length} broken worktree(s):`);
                    for (const worktree of result.broken) {
                        console.log(`  - ${worktree.sessionName} (${worktree.reason})`);
                    }

                    if (options.dryRun) {
                        return;
                    }

                    if (result.repaired.length > 0) {
                        console.log('\nRepairing...');
                        for (const sessionName of result.repaired) {
                            console.log(`  Repaired: ${sessionName}`);
                        }
                    }

                    for (const failure of result.failures) {
                        console.error(`  Failed: ${failure}`);
                    }

                    console.log(`\nDone: ${result.repairedCount} repaired, ${result.failures.length} failed.`);
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
