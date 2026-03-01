/**
 * File Watcher - Manages file system watches for the bridge
 *
 * Uses chokidar to monitor file changes and emit notifications.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as chokidar from 'chokidar';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picomatch = require('picomatch') as (pattern: string) => (input: string) => boolean;
import { NotificationEmitter } from './notifications';

/**
 * FileWatchManager manages file system watches.
 */
export interface FileWatchOptions {
    usePolling?: boolean;
}

export class FileWatchManager {
    private watchers = new Map<string, chokidar.FSWatcher>();
    private readyPromises = new Map<string, Promise<void>>();
    private nextWatchId = 1;
    private options: FileWatchOptions;

    constructor(private notificationEmitter: NotificationEmitter, options?: FileWatchOptions) {
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
                process.stderr.write(`[Bridge] File watcher error (${watchId}): ${message}\n`);
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
     */
    async unwatch(watchId: string): Promise<boolean> {
        const watcher = this.watchers.get(watchId);
        if (!watcher) {
            return false;
        }

        await watcher.close();
        this.watchers.delete(watchId);
        return true;
    }

    /**
     * Close all watchers (cleanup on shutdown).
     */
    dispose(): void {
        for (const watcher of this.watchers.values()) {
            void watcher.close();
        }
        this.watchers.clear();
    }
}
