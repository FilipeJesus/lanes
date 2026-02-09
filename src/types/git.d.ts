/**
 * Minimal type definitions for the VS Code Git Extension API.
 * Only includes what Lanes needs to get the git executable path.
 */

import { Event } from 'vscode';

/**
 * The main Git extension export.
 * Use vscode.extensions.getExtension<GitExtension>('vscode.git') to get this.
 */
export interface GitExtension {
    readonly enabled: boolean;
    readonly onDidChangeEnablement: Event<boolean>;
    getAPI(version: 1): API;
}

/**
 * The Git API interface (version 1).
 */
export interface API {
    readonly git: Git;
}

/**
 * Git executable information.
 */
export interface Git {
    readonly path: string;
    readonly version: string;
}
