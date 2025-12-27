/**
 * Git Service for Claude Lanes
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
            console.log('Claude Lanes: VS Code Git extension not found, using default git path');
            return;
        }

        // Activate the extension if not already active
        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }

        const api = gitExtension.exports.getAPI(1);
        if (api?.git?.path) {
            gitPath = api.git.path;
            console.log(`Claude Lanes: Using git from VS Code: ${gitPath}`);
        } else {
            console.log('Claude Lanes: Could not get git path from VS Code, using default');
        }
    } catch (err) {
        console.warn('Claude Lanes: Failed to get git path from VS Code, using default:', err);
    }
}

/**
 * Get the current git executable path.
 */
export function getGitPath(): string {
    return gitPath;
}

/**
 * Execute a git command using spawn (no shell).
 * @param args The git command arguments
 * @param cwd The working directory
 * @returns The stdout output
 * @throws Error if the command fails
 */
export function execGit(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const process = spawn(gitPath, args, { cwd });
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        process.on('error', (err: Error) => {
            reject(new Error(`Failed to spawn git process: ${err.message}`));
        });

        process.on('close', (code: number | null) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(stderr || `Git command failed with code ${code}`));
            }
        });
    });
}
