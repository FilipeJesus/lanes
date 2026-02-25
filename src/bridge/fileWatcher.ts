/**
 * File Watcher - Manages file system watches for the bridge
 *
 * Uses Node.js fs.watch to monitor file changes and emit notifications.
 */

import * as fs from 'fs';
import * as path from 'path';
import { NotificationEmitter } from './notifications';

/**
 * FileWatchManager manages file system watches.
 */
export class FileWatchManager {
    private watchers = new Map<string, fs.FSWatcher>();
    private nextWatchId = 1;

    constructor(private notificationEmitter: NotificationEmitter) {}

    /**
     * Create a new file system watch.
     * Returns a watch ID that can be used to unwatch later.
     */
    watch(basePath: string, pattern: string): string {
        const watchId = `watch-${this.nextWatchId++}`;

        // For simplicity, we'll watch the directory and filter by pattern
        // In a production implementation, you'd use a library like chokidar for glob support
        const fullPath = path.join(basePath, pattern);
        const watchPath = path.dirname(fullPath);

        try {
            const watcher = fs.watch(watchPath, { recursive: true }, (eventType, filename) => {
                if (!filename) {
                    return;
                }

                const filePath = path.join(watchPath, filename);

                // Map fs.watch event types to our protocol
                let ourEventType: 'created' | 'changed' | 'deleted';
                if (eventType === 'rename') {
                    // Check if file exists to determine created vs deleted
                    try {
                        fs.accessSync(filePath);
                        ourEventType = 'created';
                    } catch {
                        ourEventType = 'deleted';
                    }
                } else {
                    ourEventType = 'changed';
                }

                this.notificationEmitter.fileChanged(filePath, ourEventType);
            });

            this.watchers.set(watchId, watcher);
            return watchId;
        } catch (err) {
            throw new Error(`Failed to watch ${watchPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    /**
     * Remove a file system watch.
     */
    unwatch(watchId: string): boolean {
        const watcher = this.watchers.get(watchId);
        if (!watcher) {
            return false;
        }

        watcher.close();
        this.watchers.delete(watchId);
        return true;
    }

    /**
     * Close all watchers (cleanup on shutdown).
     */
    dispose(): void {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}
