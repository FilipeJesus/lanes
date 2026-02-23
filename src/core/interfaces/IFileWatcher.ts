/**
 * Platform-agnostic file watcher interface.
 * Abstracts file system change monitoring.
 */

import { IDisposable } from './IDisposable';

export interface IFileWatcherHandle extends IDisposable {
    onDidChange(callback: () => void): IDisposable;
    onDidCreate(callback: (path: string) => void): IDisposable;
    onDidDelete(callback: () => void): IDisposable;
}

export interface IFileWatcher {
    watch(basePath: string, pattern: string): IFileWatcherHandle;
}
