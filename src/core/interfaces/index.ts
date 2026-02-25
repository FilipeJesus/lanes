/**
 * Core interfaces - the abstraction boundary between core logic and platform adapters.
 */
export type { IDisposable } from './IDisposable';
export type { IConfigProvider } from './IConfigProvider';
export type { IUIProvider, QuickPickItem, QuickPickOptions, InputBoxOptions } from './IUIProvider';
export type { ITerminalBackend, ITerminalHandle, TerminalOptions } from './ITerminalBackend';
export type { IFileWatcher, IFileWatcherHandle } from './IFileWatcher';
export type { IStorageProvider } from './IStorageProvider';
export type { IGitPathResolver } from './IGitPathResolver';
