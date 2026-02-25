/**
 * VS Code implementation of IStorageProvider.
 * Wraps vscode.ExtensionContext storage APIs.
 */

import * as vscode from 'vscode';
import type { IStorageProvider } from '../../core/interfaces';

export class VscodeStorageProvider implements IStorageProvider {
    private readonly context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    getGlobalStoragePath(): string {
        return this.context.globalStorageUri.fsPath;
    }

    getWorkspaceState<T>(key: string, defaultValue: T): T {
        return this.context.workspaceState.get<T>(key, defaultValue);
    }

    async setWorkspaceState<T>(key: string, value: T): Promise<void> {
        await this.context.workspaceState.update(key, value);
    }
}
