/**
 * VS Code implementation of IFileWatcher.
 * Wraps vscode.workspace.createFileSystemWatcher.
 */

import * as vscode from 'vscode';
import type { IFileWatcher, IFileWatcherHandle } from '../../core/interfaces';
import type { IDisposable } from '../../core/interfaces';

export class VscodeFileWatcher implements IFileWatcher {
    watch(basePath: string, pattern: string): IFileWatcherHandle {
        const globPattern = new vscode.RelativePattern(basePath, pattern);
        const watcher = vscode.workspace.createFileSystemWatcher(globPattern);

        return {
            onDidChange(callback: () => void): IDisposable {
                return watcher.onDidChange(() => callback());
            },
            onDidCreate(callback: (path: string) => void): IDisposable {
                return watcher.onDidCreate((uri) => callback(uri.fsPath));
            },
            onDidDelete(callback: () => void): IDisposable {
                return watcher.onDidDelete(() => callback());
            },
            dispose() {
                watcher.dispose();
            },
        };
    }
}
