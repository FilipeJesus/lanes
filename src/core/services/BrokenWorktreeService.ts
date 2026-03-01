/**
 * BrokenWorktreeService - Detection and repair of broken git worktrees
 *
 * This service handles the detection and repair of broken worktrees that can occur
 * after container rebuilds or other disruptions. A worktree is considered "broken"
 * when its .git file references a metadata directory that no longer exists.
 *
 * The repair process preserves user files while recreating the git worktree structure.
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { execGit } from '../gitService';
import { getErrorMessage } from '../utils';

/**
 * Represents a broken worktree that needs repair.
 */
export interface BrokenWorktree {
    /** Full path to the worktree directory */
    path: string;
    /** Session name (folder name, which equals the branch name) */
    sessionName: string;
    /** Expected branch name (same as session name in Lanes) */
    expectedBranch: string;
}

/**
 * Detects broken worktrees in the .worktrees directory.
 * A worktree is broken when:
 * 1. It has a .git file (not directory) - indicating it's a worktree
 * 2. The .git file contains a gitdir reference to a metadata directory
 * 3. That metadata directory does not exist (e.g., after container rebuild)
 *
 * @param baseRepoPath The path to the base repository
 * @param worktreesFolder The relative path to the worktrees folder (e.g., '.worktrees')
 * @returns Array of broken worktrees that need repair
 */
export async function detectBrokenWorktrees(baseRepoPath: string, worktreesFolder: string): Promise<BrokenWorktree[]> {
    const worktreesDir = path.join(baseRepoPath, worktreesFolder);
    const brokenWorktrees: BrokenWorktree[] = [];

    // Check if .worktrees directory exists
    try {
        await fsPromises.access(worktreesDir);
    } catch {
        // Directory doesn't exist, no worktrees to check
        return brokenWorktrees;
    }

    // Read all entries in the worktrees directory
    let entries: string[];
    try {
        entries = await fsPromises.readdir(worktreesDir);
    } catch (err) {
        console.warn('Lanes: Failed to read worktrees directory:', getErrorMessage(err));
        return brokenWorktrees;
    }

    // Check each entry
    for (const entry of entries) {
        // Validate entry name to prevent path traversal
        if (!entry || entry.includes('..') || entry.includes('/') || entry.includes('\\')) {
            continue;
        }

        const worktreePath = path.join(worktreesDir, entry);

        // Check if it's a directory
        try {
            const stat = await fsPromises.stat(worktreePath);
            if (!stat.isDirectory()) {
                continue;
            }
        } catch {
            continue;
        }

        // Check for .git file (not directory)
        const gitPath = path.join(worktreePath, '.git');
        try {
            const gitStat = await fsPromises.stat(gitPath);

            // Skip if .git is a directory (not a worktree reference)
            if (gitStat.isDirectory()) {
                continue;
            }

            // .git is a file - read its content
            const gitContent = await fsPromises.readFile(gitPath, 'utf-8');

            // Parse the gitdir reference
            // Format: "gitdir: /path/to/.git/worktrees/<name>"
            const gitdirMatch = gitContent.match(/^gitdir:\s*(.+)$/m);
            if (!gitdirMatch) {
                continue;
            }

            const metadataPath = gitdirMatch[1].trim();

            // Check if the metadata directory exists
            try {
                await fsPromises.access(metadataPath);
                // Metadata exists - worktree is healthy
            } catch {
                // Metadata doesn't exist - worktree is broken
                brokenWorktrees.push({
                    path: worktreePath,
                    sessionName: entry,
                    expectedBranch: entry // In Lanes, folder name = branch name
                });
            }
        } catch {
            // No .git file or can't read it - not a worktree or already broken differently
            continue;
        }
    }

    return brokenWorktrees;
}

/**
 * Get a set of branch names that are currently checked out in worktrees.
 * Parses the output of `git worktree list --porcelain`.
 * @param cwd The working directory (git repo root)
 * @returns A Set of branch names currently in use by worktrees
 */
export async function getBranchesInWorktrees(cwd: string): Promise<Set<string>> {
    const branches = new Set<string>();
    try {
        const output = await execGit(['worktree', 'list', '--porcelain'], cwd);
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.startsWith('branch refs/heads/')) {
                const branchName = line.replace('branch refs/heads/', '').trim();
                if (branchName) {
                    branches.add(branchName);
                }
            }
        }
    } catch {
        // Return empty set for graceful degradation
    }
    return branches;
}

/**
 * Check if a branch exists in the git repository.
 * @param cwd The working directory (git repo root)
 * @param branchName The name of the branch to check
 * @returns true if the branch exists, false otherwise
 * @note Returns false for invalid branch names or on any git command failure
 */
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
    // Validate branch name to prevent issues
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
    if (!branchNameRegex.test(branchName)) {
        return false;
    }
    try {
        await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], cwd);
        return true;
    } catch {
        return false;
    }
}

/**
 * Repairs a broken worktree by recreating it while preserving existing files.
 *
 * Strategy:
 * 1. Verify the branch exists
 * 2. Rename the broken worktree directory temporarily
 * 3. Create a fresh worktree at the original path
 * 4. Copy non-.git files from the temp directory to the new worktree
 * 5. Remove the temp directory
 *
 * @param baseRepoPath The path to the base repository
 * @param brokenWorktree The broken worktree to repair
 * @returns Object with success status and optional error message
 */
export async function repairWorktree(
    baseRepoPath: string,
    brokenWorktree: BrokenWorktree
): Promise<{ success: boolean; error?: string }> {
    const { path: worktreePath, expectedBranch } = brokenWorktree;

    // Step 1: Verify the branch exists
    const branchExistsResult = await branchExists(baseRepoPath, expectedBranch);
    if (!branchExistsResult) {
        return {
            success: false,
            error: `Branch '${expectedBranch}' does not exist in the repository`
        };
    }

    // Step 2: Create a temp directory name for the backup
    const tempPath = `${worktreePath}.repair-backup-${Date.now()}`;

    // Step 3: Rename the broken worktree directory
    try {
        await fsPromises.rename(worktreePath, tempPath);
    } catch (err) {
        return {
            success: false,
            error: `Failed to rename worktree for repair: ${getErrorMessage(err)}`
        };
    }

    // Step 4: Create a fresh worktree
    try {
        await execGit(
            ['worktree', 'add', worktreePath, expectedBranch],
            baseRepoPath
        );
    } catch (err) {
        // Try to restore the original directory on failure
        try {
            await fsPromises.rename(tempPath, worktreePath);
        } catch (restoreErr) {
            // Restore failed - include backup location in error message
            return {
                success: false,
                error: `Failed to create worktree: ${getErrorMessage(err)}. ` +
                       `WARNING: Original files backed up at ${tempPath} could not be restored.`
            };
        }
        return {
            success: false,
            error: `Failed to create worktree: ${getErrorMessage(err)}`
        };
    }

    // Step 5: Copy all non-.git files from temp to new worktree
    // We always prefer the user's version to preserve any modifications
    try {
        await copyDirectoryContents(tempPath, worktreePath);
    } catch (err) {
        // Log but don't fail - the worktree is fixed, just some files might not be copied
        console.warn(`Lanes: Failed to copy some files during repair: ${getErrorMessage(err)}`);
    }

    // Step 6: Remove the temp directory
    try {
        await fsPromises.rm(tempPath, { recursive: true, force: true });
    } catch (err) {
        // Log but don't fail - the repair was successful
        console.warn(`Lanes: Failed to clean up temp directory: ${getErrorMessage(err)}`);
    }

    return { success: true };
}

/**
 * Copy contents from source directory to destination, overwriting existing files.
 * Skips the .git file/directory in the source. Used to restore user's files after worktree repair.
 */
async function copyDirectoryContents(src: string, dest: string): Promise<void> {
    const entries = await fsPromises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        // Skip .git file (it was stale anyway)
        if (entry.name === '.git') {
            continue;
        }

        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isSymbolicLink()) {
            // Remove existing and recreate symlink
            try {
                await fsPromises.rm(destPath, { recursive: true, force: true });
            } catch {
                // Destination doesn't exist, that's fine
            }
            const linkTarget = await fsPromises.readlink(srcPath);
            await fsPromises.symlink(linkTarget, destPath);
        } else if (entry.isDirectory()) {
            // Recursively copy directory contents
            await fsPromises.mkdir(destPath, { recursive: true });
            await copyDirectoryContents(srcPath, destPath);
        } else {
            // Copy file, overwriting if exists (preserves user's modifications)
            await fsPromises.copyFile(srcPath, destPath);
            // Preserve file permissions
            const srcStat = await fsPromises.stat(srcPath);
            await fsPromises.chmod(destPath, srcStat.mode);
        }
    }
}

/**
 * Recursively copy a directory, preserving symlinks and file permissions.
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
    await fsPromises.mkdir(dest, { recursive: true });
    const entries = await fsPromises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isSymbolicLink()) {
            // Preserve symbolic links
            const linkTarget = await fsPromises.readlink(srcPath);
            await fsPromises.symlink(linkTarget, destPath);
        } else if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fsPromises.copyFile(srcPath, destPath);
            // Preserve file permissions
            const srcStat = await fsPromises.stat(srcPath);
            await fsPromises.chmod(destPath, srcStat.mode);
        }
    }
}

/**
 * Result of repairing multiple broken worktrees.
 */
export interface RepairResult {
    successCount: number;
    failures: { sessionName: string; error: string }[];
}

/**
 * Repairs multiple broken worktrees.
 *
 * @param baseRepoPath The path to the base repository
 * @param brokenWorktrees Array of broken worktrees to repair
 * @returns Result with success count and failures
 */
export async function repairBrokenWorktrees(
    baseRepoPath: string,
    brokenWorktrees: BrokenWorktree[]
): Promise<RepairResult> {
    let successCount = 0;
    const failures: { sessionName: string; error: string }[] = [];

    for (const brokenWorktree of brokenWorktrees) {
        const result = await repairWorktree(baseRepoPath, brokenWorktree);
        if (result.success) {
            successCount++;
        } else {
            failures.push({
                sessionName: brokenWorktree.sessionName,
                error: result.error || 'Unknown error'
            });
        }
    }

    return { successCount, failures };
}
