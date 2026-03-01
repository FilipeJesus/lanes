/**
 * `lanes diff <session-name>` — Show git diff for a session.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import * as DiffService from '../../core/services/DiffService';
import { getErrorMessage } from '../../core/utils';

export function registerDiffCommand(program: Command): void {
    program
        .command('diff <session-name>')
        .description('Show git diff for a session')
        .option('--base <branch>', 'Base branch to diff against')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const baseBranch = options.base ||
                    await DiffService.getBaseBranch(
                        worktreePath,
                        config.get('lanes', 'baseBranch', '')
                    );

                const includeUncommitted = config.get('lanes', 'includeUncommittedChanges', true);

                const diffContent = await DiffService.generateDiffContent(
                    worktreePath,
                    baseBranch,
                    new Set(),
                    {
                        includeUncommitted,
                        onWarning: (msg) => console.warn(`Warning: ${msg}`),
                    }
                );

                if (!diffContent || diffContent.trim() === '') {
                    console.log(`No changes found when comparing to '${baseBranch}'.`);
                    return;
                }

                console.log(diffContent);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
