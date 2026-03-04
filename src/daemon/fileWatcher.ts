/**
 * DaemonFileWatchManager - File system watches for the HTTP daemon
 *
 * Uses chokidar to monitor file changes and emit notifications to SSE clients.
 * Implements IFileWatchManager for use with SessionHandlerService.
 *
 * Note: The `ignored` callback passed to chokidar receives an `fs.Stats` object
 * as part of its signature. This is a chokidar API requirement — we import `fs`
 * (not `fs/promises`) only for the Stats type annotation. No synchronous fs
 * methods are called in this file.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
import picomatch from 'picomatch';
import { IFileWatchManager, INotificationEmitter } from '../core/interfaces/IHandlerContext';

/**
 * Options for the file watch manager.
 */
export interface FileWatchOptions {
    usePolling?: boolean;
}

/**
 * DaemonFileWatchManager manages file system watches.
 * Implements IFileWatchManager for use with SessionHandlerService.
 */
export class DaemonFileWatchManager implements IFileWatchManager {
    private watchers = new Map<string, chokidar.FSWatcher>();
    private readyPromises = new Map<string, Promise<void>>();
    private nextWatchId = 1;
    private options: FileWatchOptions;

    constructor(private notificationEmitter: INotificationEmitter, options?: FileWatchOptions) {
        this.options = options ?? {};
    }

    /**
     * Create a new file system watch.
     * Returns a watch ID that can be used to unwatch later.
     */
    watch(basePath: string, pattern: string): string {
        const watchId = `watch-${this.nextWatchId++}`;
        const resolvedBasePath = path.resolve(basePath);
        const isMatch = picomatch(pattern);

        try {
            // Watch the directory and filter events by pattern.
            // Chokidar v4 doesn't detect newly created files when given a glob with cwd.
            const watcherOptions: chokidar.ChokidarOptions = {
                ignoreInitial: true,
                persistent: true,
                ignored: (filePath: string, stats?: fs.Stats) => {
                    // Don't ignore directories (need to traverse into them)
                    if (!stats || stats.isDirectory()) { return false; }
                    const relativePath = path.relative(resolvedBasePath, filePath);
                    return !isMatch(relativePath);
                },
            };
            if (this.options.usePolling) {
                watcherOptions.usePolling = true;
                watcherOptions.interval = 100;
            }
            const watcher = chokidar.watch(resolvedBasePath, watcherOptions);

            watcher.on('add', filePath => {
                this.notificationEmitter.fileChanged(filePath, 'created');
            });
            watcher.on('change', filePath => {
                this.notificationEmitter.fileChanged(filePath, 'changed');
            });
            watcher.on('unlink', filePath => {
                this.notificationEmitter.fileChanged(filePath, 'deleted');
            });
            watcher.on('error', err => {
                const message = err instanceof Error ? err.message : String(err);
                process.stderr.write(`[Daemon] File watcher error (${watchId}): ${message}\n`);
            });

            this.watchers.set(watchId, watcher);
            this.readyPromises.set(watchId, new Promise<void>(resolve => {
                watcher.on('ready', resolve);
            }));
            return watchId;
        } catch (err) {
            throw new Error(`Failed to watch ${resolvedBasePath} (${pattern}): ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Wait for a watcher to finish its initial scan.
     */
    async waitForReady(watchId: string): Promise<void> {
        await this.readyPromises.get(watchId);
    }

    /**
     * Remove a file system watch.
     * Returns true if the watch existed and was removed, false otherwise.
     */
    async unwatch(watchId: string): Promise<boolean> {
        const watcher = this.watchers.get(watchId);
        if (!watcher) {
            return false;
        }

        await watcher.close();
        this.watchers.delete(watchId);
        this.readyPromises.delete(watchId);
        return true;
    }

    /**
     * Set up automatic file watching for standard Lanes session paths.
     *
     * Watches:
     *   - `.lanes/current-sessions/**\/*` — session data and status files for all agents
     *   - `<worktreesFolder>/**\/workflow-state.json` — workflow state changes in worktrees
     *
     * Returns the watch IDs so the caller can unwatch them individually if needed.
     * The caller may also simply call `dispose()` on shutdown, which closes all watchers.
     *
     * @param worktreesFolder The worktrees folder name (e.g. `.worktrees`), resolved from config.
     */
    setupAutoWatching(workspaceRoot: string, worktreesFolder: string = '.worktrees'): string[] {
        const watchIds: string[] = [];

        // Watch session data directory for status/session file changes (all agent types)
        const sessionsPath = path.join(workspaceRoot, '.lanes', 'current-sessions');
        watchIds.push(this.watch(sessionsPath, '**/*'));

        // Watch worktrees directory for workflow-state.json changes
        const worktreesPath = path.join(workspaceRoot, worktreesFolder);
        watchIds.push(this.watch(worktreesPath, '**/workflow-state.json'));

        return watchIds;
    }

    /**
     * Close all watchers (cleanup on shutdown).
     */
    dispose(): void {
        for (const watcher of this.watchers.values()) {
            void watcher.close();
        }
        this.watchers.clear();
        this.readyPromises.clear();
    }
}
