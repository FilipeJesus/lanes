/**
 * `lanes create` — Create a new session and exec into the agent.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { launchCliSession } from '../sessionLauncher';
import { validateSessionName } from '../../core/validation';
import { validateBranchName, sanitizeSessionName, getErrorMessage } from '../../core/utils';
import { validateAndGetAgent, getAvailableAgents } from '../../core/codeAgents';
import {
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';

export function registerCreateCommand(program: Command): void {
    program
        .command('create')
        .description('Create a new session and open it')
        .requiredOption('--name <name>', 'Session name (used as branch name)')
        .option('--branch <source>', 'Source branch to create from', '')
        .option('--agent <agent>', 'AI agent to use (claude, codex, cortex, gemini, opencode)')
        .option('--prompt <text>', 'Starting prompt for the agent')
        .option('--workflow <name>', 'Workflow template name')
        .option('--permission-mode <mode>', 'Permission mode for the agent')
        .option('--tmux', 'Use tmux backend')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();

                // Resolve agent
                const agentName = options.agent || config.get('lanes', 'defaultAgent', 'claude');
                const { agent: codeAgent, warning } = await validateAndGetAgent(agentName);
                if (warning) {
                    exitWithError(warning);
                }
                if (!codeAgent) {
                    exitWithError(`Unknown agent '${agentName}'. Available: ${getAvailableAgents().join(', ')}`);
                }

                // Re-initialize storage context with the resolved agent
                initializeGlobalStorageContext(
                    path.join(repoRoot, '.lanes'),
                    repoRoot,
                    codeAgent
                );

                // Sanitize and validate name
                const sanitizedName = sanitizeSessionName(options.name);
                if (!sanitizedName) {
                    exitWithError('Session name contains no valid characters.');
                }

                const nameValidation = validateSessionName(sanitizedName);
                if (!nameValidation.valid) {
                    exitWithError(nameValidation.error || 'Invalid session name.');
                }

                const branchValidation = validateBranchName(sanitizedName);
                if (!branchValidation.valid) {
                    exitWithError(branchValidation.error || 'Invalid branch name.');
                }
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    if (operations.targetKind === 'local') {
                        console.log(`Creating session '${sanitizedName}'...`);
                    }

                    const launch = await operations.createSession({
                        sessionName: sanitizedName,
                        sourceBranch: options.branch,
                        codeAgent,
                        prompt: options.prompt,
                        workflow: options.workflow,
                        permissionMode: options.permissionMode || config.get('lanes', 'permissionMode', 'acceptEdits'),
                        preferTmux: options.tmux,
                    });

                    console.log(
                        operations.targetKind === 'remote'
                            ? `Session '${sanitizedName}' created on ${operations.host}.`
                            : `Session '${sanitizedName}' created.`
                    );

                    await launchCliSession(launch);
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
