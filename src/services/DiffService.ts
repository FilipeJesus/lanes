/**
 * DiffService - Git diff content generation and parsing
 *
 * This service provides functions for generating git diffs, parsing git status output,
 * detecting binary content, and synthesizing diffs for untracked files.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { execGit } from '../gitService';
import { getErrorMessage } from '../utils';

/**
 * Parse untracked files from git status --porcelain output.
 * Untracked files are indicated by '??' prefix.
 * @param statusOutput The raw output from git status --porcelain
 * @returns Array of file paths for untracked files
 */
export function parseUntrackedFiles(statusOutput: string): string[] {
    const files: string[] = [];
    const lines = statusOutput.split('\n');

    for (const line of lines) {
        // Untracked files start with '?? '
        if (line.startsWith('?? ')) {
            // Extract the file path (everything after '?? ')
            const filePath = line.substring(3).trim();
            // Handle quoted paths (git uses C-style escaping for paths with special characters)
            const unquotedPath = filePath.startsWith('"') && filePath.endsWith('"')
                ? filePath.slice(1, -1)
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\\\/g, '\\')  // Must be last to avoid double-unescaping
                : filePath;
            if (unquotedPath) {
                files.push(unquotedPath);
            }
        }
    }

    return files;
}

/**
 * Check if content appears to be binary (contains null bytes).
 * @param content The string content to check
 * @returns true if the content appears to be binary
 */
export function isBinaryContent(content: string): boolean {
    // Check for null bytes which indicate binary content
    return content.includes('\0');
}

/**
 * Synthesize a unified diff format entry for an untracked (new) file.
 * @param filePath The path to the file (relative to repo root)
 * @param content The file content
 * @returns A string in unified diff format representing a new file
 */
export function synthesizeUntrackedFileDiff(filePath: string, content: string): string {
    const lines = content.split('\n');

    // Handle empty files
    if (content === '' || (lines.length === 1 && lines[0] === '')) {
        return [
            `diff --git a/${filePath} b/${filePath}`,
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${filePath}`,
            ''
        ].join('\n');
    }

    // Handle files that don't end with a newline
    const hasTrailingNewline = content.endsWith('\n');
    const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
    const lineCount = contentLines.length;

    const diffLines = [
        `diff --git a/${filePath} b/${filePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${lineCount} @@`
    ];

    // Add each line with a '+' prefix
    for (const line of contentLines) {
        diffLines.push(`+${line}`);
    }

    // Add marker for missing newline at end of file
    if (!hasTrailingNewline) {
        diffLines.push('\\ No newline at end of file');
    }

    return diffLines.join('\n');
}

/**
 * Determines the base branch for comparing changes.
 * First checks the lanes.baseBranch setting.
 * If not set, checks in order: origin/main, origin/master, main, master.
 * @param cwd The working directory (git repo or worktree)
 * @returns The name of the base branch to use for comparisons
 */
export async function getBaseBranch(cwd: string): Promise<string> {
    // First check if user has configured a base branch
    const config = vscode.workspace.getConfiguration('lanes');
    const configuredBranch = config.get<string>('baseBranch', '');

    if (configuredBranch && configuredBranch.trim()) {
        return configuredBranch.trim();
    }

    // Fallback to auto-detection
    // Check for origin/main
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], cwd);
        return 'origin/main';
    } catch {
        // origin/main doesn't exist, try next
    }

    // Check for origin/master
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/master'], cwd);
        return 'origin/master';
    } catch {
        // origin/master doesn't exist, try local branches
    }

    // Check for local main
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/heads/main'], cwd);
        return 'main';
    } catch {
        // main doesn't exist, try master
    }

    // Check for local master
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/heads/master'], cwd);
        return 'master';
    } catch {
        // master doesn't exist either
    }

    // Default fallback - this will likely fail but gives a sensible error
    return 'main';
}

/**
 * Generate diff content for a worktree.
 * This function handles both committed and uncommitted changes.
 *
 * @param worktreePath Path to the worktree
 * @param baseBranch The base branch to compare against
 * @param warnedMergeBaseBranches Set of branches that have already shown warnings (for debouncing)
 * @returns The diff content
 */
export async function generateDiffContent(
    worktreePath: string,
    baseBranch: string,
    warnedMergeBaseBranches: Set<string>
): Promise<string> {
    // Check if we should include uncommitted changes
    const config = vscode.workspace.getConfiguration('lanes');
    const includeUncommitted = config.get<boolean>('includeUncommittedChanges', true);

    // Auto-fetch for remote branches before merge-base computation
    if (baseBranch.startsWith('origin/') || baseBranch.includes('/')) {
        try {
            const parts = baseBranch.split('/');
            const remote = parts[0];
            const branch = parts.slice(1).join('/');
            await execGit(['fetch', remote, branch], worktreePath);
        } catch (fetchErr) {
            console.warn(`Lanes: Failed to fetch ${baseBranch}:`, getErrorMessage(fetchErr));
            // Continue anyway - local ref may exist
        }
    }

    // Get the diff - either including working directory changes or only committed changes
    let diffArgs: string[];
    if (includeUncommitted) {
        // Use merge-base to compare against common ancestor
        try {
            const mergeBase = await execGit(['merge-base', baseBranch, 'HEAD'], worktreePath);
            diffArgs = ['diff', mergeBase.trim()];
        } catch (mergeBaseErr) {
            // If merge-base fails, use three-dot syntax which finds merge-base implicitly
            console.warn(`Lanes: Could not get merge-base for ${baseBranch}, using three-dot fallback:`, getErrorMessage(mergeBaseErr));

            // Show warning once per branch to avoid spam
            if (!warnedMergeBaseBranches.has(baseBranch)) {
                vscode.window.showWarningMessage(`Using fallback diff method - merge-base unavailable for '${baseBranch}'`);
                warnedMergeBaseBranches.add(baseBranch);
            }

            // Use three-dot syntax (A...B) which finds merge-base implicitly and shows committed changes
            diffArgs = ['diff', `${baseBranch}...HEAD`];
        }
    } else {
        diffArgs = ['diff', `${baseBranch}...HEAD`];  // Compare base branch to HEAD (committed only)
    }
    let diffContent = await execGit(diffArgs, worktreePath);

    // If including uncommitted changes, also get untracked files
    if (includeUncommitted) {
        try {
            // git status --porcelain respects .gitignore by default
            const statusOutput = await execGit(['status', '--porcelain'], worktreePath);
            const untrackedFiles = parseUntrackedFiles(statusOutput);

            // Process each untracked file
            const untrackedDiffs: string[] = [];
            for (const filePath of untrackedFiles) {
                try {
                    const fullPath = path.join(worktreePath, filePath);

                    // Skip directories (git status can list directories with trailing /)
                    if (filePath.endsWith('/')) {
                        continue;
                    }

                    // Check if it's a file (not a directory) and not too large
                    const stat = await fsPromises.stat(fullPath);
                    if (!stat.isFile()) {
                        continue;
                    }

                    // Skip very large files to avoid memory issues (5MB limit)
                    const MAX_FILE_SIZE = 5 * 1024 * 1024;
                    if (stat.size > MAX_FILE_SIZE) {
                        untrackedDiffs.push([
                            `diff --git a/${filePath} b/${filePath}`,
                            'new file mode 100644',
                            `File too large (${Math.round(stat.size / 1024 / 1024)}MB)`
                        ].join('\n'));
                        continue;
                    }

                    // Read file content
                    const content = await fsPromises.readFile(fullPath, 'utf-8');

                    // Skip binary files
                    if (isBinaryContent(content)) {
                        // Add a placeholder for binary files
                        untrackedDiffs.push([
                            `diff --git a/${filePath} b/${filePath}`,
                            'new file mode 100644',
                            'Binary file'
                        ].join('\n'));
                        continue;
                    }

                    // Synthesize diff for the untracked file
                    const synthesizedDiff = synthesizeUntrackedFileDiff(filePath, content);
                    untrackedDiffs.push(synthesizedDiff);
                } catch (fileErr) {
                    // Skip files that can't be read (permissions, etc.)
                    console.warn(`Lanes: Could not read untracked file ${filePath}:`, getErrorMessage(fileErr));
                }
            }

            // Append untracked file diffs to the main diff
            if (untrackedDiffs.length > 0) {
                if (diffContent && diffContent.trim() !== '') {
                    diffContent = diffContent + '\n' + untrackedDiffs.join('\n');
                } else {
                    diffContent = untrackedDiffs.join('\n');
                }
            }
        } catch (statusErr) {
            // If git status fails, continue with just the diff
            console.warn('Lanes: Could not get untracked files:', getErrorMessage(statusErr));
        }
    }

    return diffContent;
}
