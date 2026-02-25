/**
 * `lanes create` — Create a new session and exec into the agent.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError, getBranchesInWorktrees } from '../utils';
import { execGit } from '../../core/gitService';
import { fileExists, ensureDir, writeJson } from '../../core/services/FileService';
import { validateSessionName } from '../../core/validation';
import { validateBranchName, sanitizeSessionName, getErrorMessage } from '../../core/utils';
import { validateAndGetAgent, getAvailableAgents } from '../../core/codeAgents';
import { propagateLocalSettings, LocalSettingsPropagationMode } from '../../core/localSettings';
import * as BrokenWorktreeService from '../../core/services/BrokenWorktreeService';
import {
    getSessionFilePath,
    saveSessionWorkflow,
    initializeGlobalStorageContext,
} from '../../core/session/SessionDataService';
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

                const worktreePath = path.join(repoRoot, worktreesFolder, sanitizedName);

                // Ensure worktrees directory exists
                await fsPromises.mkdir(path.join(repoRoot, worktreesFolder), { recursive: true });

                // Check if branch already exists
                const branchAlreadyExists = await BrokenWorktreeService.branchExists(repoRoot, sanitizedName);

                if (branchAlreadyExists) {
                    const branchesInUse = await getBranchesInWorktrees(repoRoot);
                    if (branchesInUse.has(sanitizedName)) {
                        exitWithError(
                            `Branch '${sanitizedName}' is already checked out in another worktree. ` +
                            `Git does not allow the same branch in multiple worktrees.`
                        );
                    }
                    // Use existing branch
                    console.log(`Using existing branch '${sanitizedName}'...`);
                    await execGit(['worktree', 'add', worktreePath, sanitizedName], repoRoot);
                } else {
                    // Create new branch
                    const sourceBranch = options.branch.trim();
                    if (sourceBranch) {
                        const sourceValidation = validateBranchName(sourceBranch);
                        if (!sourceValidation.valid) {
                            exitWithError(sourceValidation.error || 'Invalid source branch name.');
                        }

                        // Fetch from remote
                        let remote = 'origin';
                        let branchName = sourceBranch;
                        if (sourceBranch.includes('/')) {
                            const parts = sourceBranch.split('/');
                            remote = parts[0];
                            branchName = parts.slice(1).join('/');
                        }

                        try {
                            await execGit(['fetch', remote, branchName], repoRoot);
                        } catch {
                            console.warn(`Warning: Could not fetch '${sourceBranch}'. Using local data.`);
                        }

                        // Verify source exists
                        const sourceExists = await BrokenWorktreeService.branchExists(repoRoot, sourceBranch);
                        let remoteExists = false;
                        if (!sourceExists) {
                            try {
                                await execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${sourceBranch}`], repoRoot);
                                remoteExists = true;
                            } catch { /* not found */ }
                        }

                        if (!sourceExists && !remoteExists) {
                            exitWithError(`Source branch '${sourceBranch}' does not exist.`);
                        }

                        console.log(`Creating session '${sanitizedName}' from '${sourceBranch}'...`);
                        await execGit(['worktree', 'add', worktreePath, '-b', sanitizedName, sourceBranch], repoRoot);
                    } else {
                        console.log(`Creating session '${sanitizedName}'...`);
                        await execGit(['worktree', 'add', worktreePath, '-b', sanitizedName], repoRoot);
                    }
                }

                // Propagate local settings
                try {
                    const propagationMode = config.get<LocalSettingsPropagationMode>('lanes', 'localSettingsPropagation', 'copy');
                    await propagateLocalSettings(repoRoot, worktreePath, propagationMode, codeAgent);
                } catch (err) {
                    console.warn(`Warning: Failed to propagate local settings: ${getErrorMessage(err)}`);
                }

                // Seed session file
                const sessionFilePath = getSessionFilePath(worktreePath);
                await ensureDir(path.dirname(sessionFilePath));
                await writeJson(sessionFilePath, {
                    agentName: codeAgent.name,
                    timestamp: new Date().toISOString(),
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
