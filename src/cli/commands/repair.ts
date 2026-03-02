/**
 * `lanes repair` — Repair broken worktrees.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import * as BrokenWorktreeService from '../../core/services/BrokenWorktreeService';
import { getErrorMessage } from '../../core/utils';

export function registerRepairCommand(program: Command): void {
    program
        .command('repair')
        .description('Detect and repair broken worktrees')
        .option('--dry-run', 'Only detect broken worktrees, do not repair')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

                const broken = await BrokenWorktreeService.detectBrokenWorktrees(repoRoot, worktreesFolder);

                if (broken.length === 0) {
                    console.log('No broken worktrees found.');
                    return;
                }

                console.log(`Found ${broken.length} broken worktree(s):`);
                for (const wt of broken) {
                    console.log(`  - ${wt.sessionName} (branch: ${wt.expectedBranch})`);
                }

                if (options.dryRun) {
                    return;
                }

                console.log('\nRepairing...');
                const result = await BrokenWorktreeService.repairBrokenWorktrees(repoRoot, broken);

                for (const failure of result.failures) {
                    console.error(`  Failed: ${failure.sessionName} — ${failure.error}`);
                }

                for (const wt of broken) {
                    if (!result.failures.find(f => f.sessionName === wt.sessionName)) {
                        console.log(`  Repaired: ${wt.sessionName}`);
                    }
                }

                console.log(`\nDone: ${result.successCount} repaired, ${result.failures.length} failed.`);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
