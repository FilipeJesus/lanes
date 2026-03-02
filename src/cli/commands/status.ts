/**
 * `lanes status [session-name]` — Show session status details.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import {
    getAgentStatus,
    getSessionAgentName,
    getSessionId,
    getWorkflowStatus,
} from '../../core/session/SessionDataService';
import { getErrorMessage } from '../../core/utils';
import { fileExists } from '../../core/services/FileService';

export function registerStatusCommand(program: Command): void {
    program
        .command('status [session-name]')
        .description('Show session status')
        .option('--json', 'Output as JSON')
        .action(async (sessionName: string | undefined, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

                if (!sessionName) {
                    // Show summary of all sessions — delegate to list
                    console.log('Tip: Use "lanes list" to see all sessions, or "lanes status <name>" for details.');
                    return;
                }

                const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

                if (!await fileExists(worktreePath)) {
                    exitWithError(`Session '${sessionName}' not found.`);
                }

                const agentStatus = await getAgentStatus(worktreePath);
                const agentName = await getSessionAgentName(worktreePath);
                const sessionData = await getSessionId(worktreePath);
                const workflowStatus = await getWorkflowStatus(worktreePath);

                const result = {
                    name: sessionName,
                    agent: agentName,
                    status: agentStatus?.status || 'idle',
                    sessionId: sessionData?.sessionId || null,
                    timestamp: sessionData?.timestamp || null,
                    workflow: workflowStatus,
                };

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
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
