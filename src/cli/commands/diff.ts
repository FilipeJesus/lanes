/**
 * `lanes diff <session-name>` — Show git diff for a session.
 */

import { Command } from 'commander';
import * as path from 'path';
import { addDaemonHostOption, createCliDaemonClient, initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import * as DiffService from '../../core/services/DiffService';
import { getErrorMessage } from '../../core/utils';

export function registerDiffCommand(program: Command): void {
    addDaemonHostOption(program
        .command('diff <session-name>')
        .description('Show git diff for a session')
        .option('--base <branch>', 'Base branch to diff against'))
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();

                if (options.host) {
                    const client = await createCliDaemonClient(repoRoot, options);
                    const result = await client.getSessionDiff(
                        sessionName,
                        options.base ? { baseBranch: options.base } : undefined
                    );

                    if (!result.diff || result.diff.trim() === '') {
                        console.log(`No changes found when comparing to '${result.baseBranch}'.`);
                        return;
                    }

                    console.log(result.diff);
                    return;
                }

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
