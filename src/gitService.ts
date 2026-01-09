/**
 * Git Service for Lanes
 *
 * Provides the git executable path from VS Code's Git Extension when available,
 * with fallback to using 'git' directly from PATH.
 */

import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { GitExtension } from './types/git';

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
 * @throws Error if the command fails
 */
export function execGit(args: string[], cwd: string, options?: ExecGitOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        const spawnOptions: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd };

        // Merge custom env vars with existing process env
        if (options?.env) {
            spawnOptions.env = { ...process.env, ...options.env };
        }

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
            reject(new Error(`Failed to spawn git process: ${err.message}`));
        });

        childProcess.on('close', (code: number | null) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `Git command failed with code ${code}`));
            }
        });
    });
}
