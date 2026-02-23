/**
 * VS Code implementation of IConfigProvider.
 * Wraps vscode.workspace.getConfiguration for reading extension settings.
 */

import * as vscode from 'vscode';
import type { IConfigProvider } from '../../core/interfaces/IConfigProvider';
import type { IDisposable } from '../../core/interfaces/IDisposable';

export class VscodeConfigProvider implements IConfigProvider {
    get<T>(section: string, key: string, defaultValue: T): T {
        return vscode.workspace.getConfiguration(section).get<T>(key, defaultValue);
    }

    onDidChange(section: string, callback: () => void): IDisposable {
        const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(section)) {
                callback();
            }
        });
        return { dispose: () => disposable.dispose() };
    }
}
