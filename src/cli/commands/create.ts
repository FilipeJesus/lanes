/**
 * `lanes create` — Create a new session and exec into the agent.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, exitWithError } from '../utils';
import { validateSessionName } from '../../core/validation';
import { validateBranchName, sanitizeSessionName, getErrorMessage } from '../../core/utils';
import { validateAndGetAgent, getAvailableAgents } from '../../core/codeAgents';
import { LocalSettingsPropagationMode } from '../../core/localSettings';
import {
    saveSessionWorkflow,
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';
import { createSessionWorktree } from '../../core/services/SessionCreationService';
import { execIntoAgent } from './open';

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
                const worktreesFolder = config.get('lanes', 'worktreesFolder', '.worktrees');

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

                // Create worktree via core service
                console.log(`Creating session '${sanitizedName}'...`);
                const propagationMode = config.get<LocalSettingsPropagationMode>('lanes', 'localSettingsPropagation', 'copy');

                const { worktreePath } = await createSessionWorktree({
                    repoRoot,
                    sessionName: sanitizedName,
                    sourceBranch: options.branch,
                    worktreesFolder,
                    codeAgent,
                    localSettingsPropagation: propagationMode,
                    onWarning: (msg) => console.warn(`Warning: ${msg}`),
                });

                // Save workflow if specified
                if (options.workflow) {
                    await saveSessionWorkflow(worktreePath, options.workflow);
                }

                console.log(`Session '${sanitizedName}' created.`);

                // Exec into the agent
                await execIntoAgent({
                    sessionName: sanitizedName,
                    worktreePath,
                    repoRoot,
                    codeAgent,
                    config,
                    prompt: options.prompt,
                    permissionMode: options.permissionMode || config.get('lanes', 'permissionMode', 'acceptEdits'),
                    workflow: options.workflow,
                    useTmux: options.tmux || config.get<string>('lanes', 'terminalMode', 'vscode') === 'tmux',
                    isNewSession: true,
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
