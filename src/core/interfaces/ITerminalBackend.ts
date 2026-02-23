/**
 * Platform-agnostic terminal backend interface.
 * Abstracts terminal creation and lifecycle management.
 */

import { IDisposable } from './IDisposable';

export interface TerminalOptions {
    name: string;
    cwd?: string;
    env?: Record<string, string | undefined>;
    shellPath?: string;
    shellArgs?: string[];
    iconPath?: { id: string; color?: string };
    message?: string;
    isTransient?: boolean;
}

export interface ITerminalHandle {
    readonly name: string;
    show(): void;
    sendText(text: string, addNewLine?: boolean): void;
    dispose(): void;
}

export interface ITerminalBackend {
    createTerminal(options: TerminalOptions): ITerminalHandle;
    findTerminalByName(name: string): ITerminalHandle | undefined;
    getAllTerminals(): ITerminalHandle[];
    onDidCloseTerminal(callback: (terminal: ITerminalHandle) => void): IDisposable;
}
