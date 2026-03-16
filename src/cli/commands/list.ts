/**
 * `lanes list` — List active sessions with their status.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { withCliDaemonTarget } from '../targeting';
import { execGit } from '../../core/gitService';
import {
    getAgentStatus,
    getSessionAgentName,
    getWorkflowStatus,
} from '../../core/session/SessionDataService';
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
                await withCliDaemonTarget(repoRoot, options, {
                    daemon: async ({ client }) => {
                        const response = await client.listSessions();
                        const sessions = response.sessions.map((session) => ({
                            name: session.name,
                            branch: session.branch,
                            path: session.worktreePath,
                            status: session.status?.status || 'idle',
                            agent: session.data?.agentName || '',
                            workflow: session.workflowStatus?.workflow,
                        }));

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
                    },
                    local: async () => {
                        const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                        const worktreesDir = path.join(repoRoot, worktreesFolder);

                        let output: string;
                        try {
                            output = await execGit(['worktree', 'list', '--porcelain'], repoRoot);
                        } catch {
                            exitWithError('Failed to list worktrees. Is this a git repository?');
                        }

                        const sessions: Array<{
                            name: string;
                            branch: string;
                            path: string;
                            status: string;
                            agent: string;
                            workflow?: string;
                        }> = [];

                        const blocks = output.split('\n\n').filter(Boolean);
                        for (const block of blocks) {
                            const lines = block.split('\n');
                            const worktreeLine = lines.find(l => l.startsWith('worktree '));
                            const branchLine = lines.find(l => l.startsWith('branch '));

                            if (!worktreeLine || !branchLine) {continue;}

                            const worktreePath = worktreeLine.replace('worktree ', '').trim();

                            if (!worktreePath.startsWith(worktreesDir)) {continue;}

                            const branch = branchLine.replace('branch refs/heads/', '').trim();
                            const name = path.basename(worktreePath);

                            const agentStatus = await getAgentStatus(worktreePath);
                            const agentName = await getSessionAgentName(worktreePath);
                            const workflowStatus = await getWorkflowStatus(worktreePath);

                            sessions.push({
                                name,
                                branch,
                                path: worktreePath,
                                status: agentStatus?.status || 'idle',
                                agent: agentName,
                                workflow: workflowStatus?.workflow,
                            });
                        }

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
                    },
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
