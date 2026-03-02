/**
 * `lanes hooks <session-name>` — Setup status hooks for a session.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import { getSessionAgentName, initializeGlobalStorageContext } from '../../core/session/SessionDataService';
import { getAgent } from '../../core/codeAgents';
import * as SettingsService from '../../core/services/SettingsService';
import { getErrorMessage } from '../../core/utils';

export function registerHooksCommand(program: Command): void {
    program
        .command('hooks <session-name>')
        .description('Setup status hooks for a session')
        .action(async (sessionName: string) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const agentName = await getSessionAgentName(worktreePath);
                const codeAgent = getAgent(agentName);

                if (codeAgent) {
                    initializeGlobalStorageContext(
                        path.join(repoRoot, '.lanes'),
                        repoRoot,
                        codeAgent
                    );
                }

                const settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(
                    worktreePath, undefined, codeAgent ?? undefined
                );

                console.log(`Status hooks configured for '${sessionName}' at ${settingsPath}`);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
