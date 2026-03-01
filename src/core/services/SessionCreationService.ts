/**
 * SessionCreationService - Shared worktree creation logic for all adapters.
 *
 * Encapsulates the common workflow: ensure directory, check branch existence,
 * handle conflicts, parse source branch, fetch remote, create worktree,
 * propagate local settings, and seed the session file.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { execGit } from '../gitService';
import { ensureDir, writeJson } from './FileService';
import { branchExists, getBranchesInWorktrees } from './BrokenWorktreeService';
import { validateBranchName, getErrorMessage } from '../utils';
import { propagateLocalSettings, LocalSettingsPropagationMode } from '../localSettings';
import { getSessionFilePath } from '../session/SessionDataService';
import { CodeAgent } from '../codeAgents';
import { isTmuxMode } from './TmuxService';

export interface SessionCreationOptions {
    repoRoot: string;
    /** Sanitized and validated session name (callers must validate before calling). */
    sessionName: string;
    /** Source branch (e.g. "origin/main" or "main"). Empty string means use HEAD. */
    sourceBranch?: string;
    worktreesFolder: string;
    codeAgent?: CodeAgent;
    localSettingsPropagation: LocalSettingsPropagationMode;
    /** Terminal mode string, used when seeding session file for hookless agents. */
    terminalMode?: string;
    /**
     * Called when the session branch already exists but is not checked out.
     * Return 'use-existing' to reuse the branch, or 'cancel' to abort.
     * Defaults to 'use-existing' if not provided.
     */
    onBranchConflict?: (branchName: string) => Promise<'use-existing' | 'cancel'>;
    /** Called for non-fatal warnings (e.g. failed fetch). */
    onWarning?: (message: string) => void;
}

export interface SessionCreationResult {
    worktreePath: string;
}

export async function createSessionWorktree(
    options: SessionCreationOptions
): Promise<SessionCreationResult> {
    const {
        repoRoot,
        sessionName,
        sourceBranch = '',
        worktreesFolder,
        codeAgent,
        localSettingsPropagation,
        terminalMode,
        onBranchConflict,
        onWarning,
    } = options;

    const worktreePath = path.join(repoRoot, worktreesFolder, sessionName);

    // 1. Ensure worktrees directory exists
    await fsPromises.mkdir(path.join(repoRoot, worktreesFolder), { recursive: true });

    // 2. Check if branch already exists
    const branchAlreadyExists = await branchExists(repoRoot, sessionName);

    if (branchAlreadyExists) {
        // 3. Check if the branch is already in use by another worktree
        const branchesInUse = await getBranchesInWorktrees(repoRoot);

        if (branchesInUse.has(sessionName)) {
            throw new Error(
                `Branch '${sessionName}' is already checked out in another worktree. ` +
                `Git does not allow the same branch to be checked out in multiple worktrees.`
            );
        }

        // 4. Branch exists but not in use — ask caller what to do
        const resolution = onBranchConflict
            ? await onBranchConflict(sessionName)
            : 'use-existing';

        if (resolution === 'cancel') {
            throw new Error('Session creation cancelled.');
        }

        // Use existing branch
        await execGit(['worktree', 'add', worktreePath, sessionName], repoRoot);
    } else {
        // 5. Branch doesn't exist — create new branch
        const trimmedSource = sourceBranch.trim();

        if (trimmedSource) {
            // Validate source branch name
            const sourceValidation = validateBranchName(trimmedSource);
            if (!sourceValidation.valid) {
                throw new Error(sourceValidation.error || 'Source branch name contains invalid characters.');
            }

            // Parse remote and branch from source
            let remote = 'origin';
            let branchName = trimmedSource;
            if (trimmedSource.includes('/')) {
                const parts = trimmedSource.split('/');
                remote = parts[0];
                branchName = parts.slice(1).join('/');
            }

            // Fetch from remote
            try {
                await execGit(['fetch', remote, branchName], repoRoot);
            } catch (fetchErr) {
                onWarning?.(
                    `Could not fetch latest version of '${trimmedSource}'. ` +
                    `Proceeding with local data if available. (${getErrorMessage(fetchErr)})`
                );
            }

            // Verify source branch exists (local or remote)
            const sourceExists = await branchExists(repoRoot, trimmedSource);
            let remoteExists = false;
            if (!sourceExists) {
                try {
                    await execGit(
                        ['show-ref', '--verify', '--quiet', `refs/remotes/${trimmedSource}`],
                        repoRoot
                    );
                    remoteExists = true;
                } catch {
                    // Not found
                }
            }

            if (!sourceExists && !remoteExists) {
                throw new Error(`Source branch '${trimmedSource}' does not exist.`);
            }

            await execGit(
                ['worktree', 'add', worktreePath, '-b', sessionName, trimmedSource],
                repoRoot
            );
        } else {
            // No source branch — create from HEAD
            await execGit(
                ['worktree', 'add', worktreePath, '-b', sessionName],
                repoRoot
            );
        }
    }

    // 6. Propagate local settings
    try {
        await propagateLocalSettings(repoRoot, worktreePath, localSettingsPropagation, codeAgent);
    } catch (err) {
        onWarning?.(`Failed to propagate local settings: ${getErrorMessage(err)}`);
    }

    // 7. Seed session file
    if (codeAgent) {
        const sessionFilePath = getSessionFilePath(worktreePath);
        await ensureDir(path.dirname(sessionFilePath));
        const sessionSeed: Record<string, string> = {
            agentName: codeAgent.name,
            timestamp: new Date().toISOString(),
        };
        if (!codeAgent.supportsHooks() && terminalMode) {
            sessionSeed.terminal = isTmuxMode(terminalMode) ? 'tmux' : 'code';
        }
        await writeJson(sessionFilePath, sessionSeed);
    }

    return { worktreePath };
}
