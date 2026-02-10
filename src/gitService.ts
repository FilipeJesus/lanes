/**
 * Git Service for Lanes
 *
 * Provides the git executable path from VS Code's Git Extension when available,
 * with fallback to using 'git' directly from PATH.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { GitExtension } from './types/git';
import { GitError } from './errors';

// The git executable path - either from VS Code or 'git' as fallback
let gitPath: string = 'git';

/**
 * Initialize the git service by attempting to get the git path from VS Code's Git Extension.
 * Falls back to 'git' if the extension is not available.
 * Should be called during extension activation.
 */
export async function initializeGitPath(): Promise<void> {
    try {
        const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

        if (!gitExtension) {
            console.log('Lanes: VS Code Git extension not found, using default git path');
            return;
        }

        // Activate the extension if not already active
        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }

        const api = gitExtension.exports.getAPI(1);
        if (api?.git?.path) {
            gitPath = api.git.path;
            console.log(`Lanes: Using git from VS Code: ${gitPath}`);
        } else {
            console.log('Lanes: Could not get git path from VS Code, using default');
        }
    } catch (err) {
        console.warn('Lanes: Failed to get git path from VS Code, using default:', err);
    }
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
        // When the extension runs git commands during a pre-commit hook, inherited
        // vars like GIT_INDEX_FILE and GIT_DIR would cause commands to target the
        // wrong index/repo. Each execGit call should operate independently.
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
