/**
 * `lanes insights <session-name>` — Generate conversation insights.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { fileExists } from '../../core/services/FileService';
import { generateInsights, formatInsightsReport } from '../../core/services/InsightsService';
import { analyzeInsights } from '../../core/services/InsightsAnalyzer';
import { getSessionAgentName } from '../../core/session/SessionDataService';
import { getAgent } from '../../core/codeAgents';
import { getErrorMessage } from '../../core/utils';

export function registerInsightsCommand(program: Command): void {
    program
        .command('insights <session-name>')
        .description('Generate conversation insights for a session')
        .option('--json', 'Output as JSON')
        .action(async (sessionName: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const agentName = await getSessionAgentName(worktreePath);
                const agent = getAgent(agentName);
                if (!agent?.supportsFeature('insights')) {
                    exitWithError(`Insights are not supported by ${agent?.displayName ?? agentName}.`);
                }

                const insights = await generateInsights(worktreePath);

                if (insights.sessionCount === 0) {
                    console.log(`No conversation data found for session '${sessionName}'.`);
                    return;
                }

                if (options.json) {
                    console.log(JSON.stringify(insights, null, 2));
                    return;
                }

                const analysis = analyzeInsights(insights);
                const report = formatInsightsReport(sessionName, insights, analysis);
                console.log(report);
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
