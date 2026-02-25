/**
 * VS Code implementation of ITerminalBackend.
 * Wraps vscode.window terminal APIs.
 */

import * as vscode from 'vscode';
import type { ITerminalBackend, ITerminalHandle, TerminalOptions } from '../../core/interfaces';
import type { IDisposable } from '../../core/interfaces';

export class VscodeTerminalBackend implements ITerminalBackend {
    createTerminal(options: TerminalOptions): ITerminalHandle {
        const terminalOptions: vscode.TerminalOptions = {
            name: options.name,
            cwd: options.cwd,
            env: options.env,
            shellPath: options.shellPath,
            shellArgs: options.shellArgs,
            message: options.message,
            isTransient: options.isTransient,
        };

        if (options.iconPath) {
            terminalOptions.iconPath = new vscode.ThemeIcon(
                options.iconPath.id,
                options.iconPath.color ? new vscode.ThemeColor(options.iconPath.color) : undefined
            );
        }

        const terminal = vscode.window.createTerminal(terminalOptions);
        return this.wrapTerminal(terminal);
    }

    findTerminalByName(name: string): ITerminalHandle | undefined {
        const terminal = vscode.window.terminals.find(t => t.name === name);
        return terminal ? this.wrapTerminal(terminal) : undefined;
    }

    getAllTerminals(): ITerminalHandle[] {
        return vscode.window.terminals.map(t => this.wrapTerminal(t));
    }

    onDidCloseTerminal(callback: (terminal: ITerminalHandle) => void): IDisposable {
        return vscode.window.onDidCloseTerminal(t => callback(this.wrapTerminal(t)));
    }

    private wrapTerminal(terminal: vscode.Terminal): ITerminalHandle {
        return {
            get name() { return terminal.name; },
            show() { terminal.show(); },
            sendText(text: string, addNewLine?: boolean) { terminal.sendText(text, addNewLine); },
            dispose() { terminal.dispose(); },
        };
    }
}
