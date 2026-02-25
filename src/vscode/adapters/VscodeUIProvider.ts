/**
 * VS Code implementation of IUIProvider.
 * Wraps vscode.window.show* methods.
 */

import * as vscode from 'vscode';
import type { IUIProvider, QuickPickItem, QuickPickOptions, InputBoxOptions } from '../../core/interfaces';

export class VscodeUIProvider implements IUIProvider {
    async showInfo(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showInformationMessage(message, ...actions);
    }

    async showWarning(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showWarningMessage(message, ...actions);
    }

    async showError(message: string, ...actions: string[]): Promise<string | undefined> {
        return vscode.window.showErrorMessage(message, ...actions);
    }

    async showQuickPick<T extends QuickPickItem>(items: T[], options?: QuickPickOptions): Promise<T | undefined> {
        return vscode.window.showQuickPick(items, options);
    }

    async showInputBox(options?: InputBoxOptions): Promise<string | undefined> {
        return vscode.window.showInputBox(options);
    }
}
