/**
 * Git Service for Lanes - Platform-agnostic
 *
 * Provides git command execution using a configurable git executable path.
 * The path can be set via initializeGitPath() during platform initialization.
 */

import { spawn } from 'child_process';
import { GitError } from './errors';

// The git executable path - set during initialization
let gitPath: string = 'git';

/**
 * Initialize the git path with a resolved executable path.
 * Should be called during application initialization.
 *
 * @param resolvedPath - Absolute path to the git executable, or 'git' to use PATH
 */
export function initializeGitPath(resolvedPath: string): void {
    gitPath = resolvedPath;
    console.log(`Lanes: Git path initialized: ${gitPath}`);
}

/**
 * Get the current git executable path.
 */
export function getGitPath(): string {
    return gitPath;
}

/**
 * Options for execGit function
 */
export interface ExecGitOptions {
    /** Environment variables to set for the git process */
    env?: Record<string, string>;
}

/**
 * Execute a git command using spawn (no shell).
 * @param args The git command arguments
 * @param cwd The working directory
 * @param options Optional settings including environment variables
 * @returns The stdout output
 * @throws GitError if the command fails
 */
export function execGit(args: string[], cwd: string, options?: ExecGitOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        // Always build clean env to prevent git hook environment contamination.
        const cleanEnv = { ...process.env };
        delete cleanEnv.GIT_INDEX_FILE;
        delete cleanEnv.GIT_DIR;
        delete cleanEnv.GIT_WORK_TREE;
        delete cleanEnv.GIT_AUTHOR_DATE;
        delete cleanEnv.GIT_AUTHOR_EMAIL;
        delete cleanEnv.GIT_AUTHOR_NAME;
        delete cleanEnv.GIT_EDITOR;
        delete cleanEnv.GIT_PREFIX;

        if (options?.env) {
            Object.assign(cleanEnv, options.env);
        }

        const spawnOptions = { cwd, env: cleanEnv };

        const childProcess = spawn(gitPath, args, spawnOptions);
        let stdout = '';
        let stderr = '';

        childProcess.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        childProcess.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        childProcess.on('error', (err: Error) => {
            reject(new GitError(args, undefined, `Failed to spawn git process: ${err.message}`));
        });

        childProcess.on('close', (code: number | null) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new GitError(args, code ?? undefined, stderr || `Git command failed with code ${code}`));
            }
        });
    });
}
