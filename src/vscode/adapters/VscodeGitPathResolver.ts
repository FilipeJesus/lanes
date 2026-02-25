/**
 * VS Code implementation of IGitPathResolver.
 * Resolves the git executable path from VS Code's Git extension.
 */

import * as vscode from 'vscode';
import type { GitExtension } from '../../types/git';
import type { IGitPathResolver } from '../../core/interfaces/IGitPathResolver';

export class VscodeGitPathResolver implements IGitPathResolver {
    async resolveGitPath(): Promise<string> {
        try {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');

            if (!gitExtension) {
                console.log('Lanes: VS Code Git extension not found, using default git path');
                return 'git';
            }

            if (!gitExtension.isActive) {
                await gitExtension.activate();
            }

            const api = gitExtension.exports.getAPI(1);
            if (api?.git?.path) {
                console.log(`Lanes: Using git from VS Code: ${api.git.path}`);
                return api.git.path;
            } else {
                console.log('Lanes: Could not get git path from VS Code, using default');
                return 'git';
            }
        } catch (err) {
            console.warn('Lanes: Failed to get git path from VS Code, using default:', err);
            return 'git';
        }
    }
}
