/**
 * `lanes list` — List active sessions with their status.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
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
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');
                const worktreesDir = path.join(repoRoot, worktreesFolder);

                // Get worktree list from git
                let output: string;
                try {
                    output = await execGit(['worktree', 'list', '--porcelain'], repoRoot);
                } catch {
                    exitWithError('Failed to list worktrees. Is this a git repository?');
                }

                // Parse porcelain output
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

                    // Only show worktrees under the configured worktrees folder
                    if (!worktreePath.startsWith(worktreesDir)) {continue;}

                    const branch = branchLine.replace('branch refs/heads/', '').trim();
                    const name = path.basename(worktreePath);

                    // Get session status
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

                // Table output
                console.log(`${'NAME'.padEnd(25)} ${'STATUS'.padEnd(12)} ${'AGENT'.padEnd(10)} ${'BRANCH'.padEnd(30)} WORKFLOW`);
                console.log('-'.repeat(90));
                for (const s of sessions) {
                    console.log(
                        `${s.name.padEnd(25)} ${s.status.padEnd(12)} ${s.agent.padEnd(10)} ${s.branch.padEnd(30)} ${s.workflow || ''}`
                    );
                }
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
