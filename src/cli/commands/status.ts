/**
 * `lanes status [session-name]` — Show session status details.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { withCliDaemonTarget } from '../targeting';
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
                await withCliDaemonTarget(repoRoot, options, {
                    daemon: async ({ client }) => {
                        if (!sessionName) {
                            console.log('Tip: Use "lanes list --host <url>" to see all sessions, or "lanes status <name> --host <url>" for details.');
                            return;
                        }

                        const listResponse = await client.listSessions();
                        const session = listResponse.sessions.find((entry) => entry.name === sessionName);
                        if (!session) {
                            exitWithError(`Session '${sessionName}' not found.`);
                        }

                        const statusResponse = await client.getSessionStatus(sessionName);
                        const result = {
                            name: sessionName,
                            agent: session.data?.agentName || '',
                            status: statusResponse.status?.status || 'idle',
                            sessionId: session.data?.sessionId || null,
                            timestamp: statusResponse.status?.timestamp || session.status?.timestamp || null,
                            workflow: statusResponse.workflowStatus,
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
                    },
                    local: async () => {
                        const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

                        if (!sessionName) {
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
                    },
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
