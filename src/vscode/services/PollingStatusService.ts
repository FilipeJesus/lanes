/**
 * PollingStatusService - fs.watch()-based status tracking for hookless agents
 *
 * Hookless agents (OpenCode, Codex) lack hook support for granular status updates.
 * This service watches their session log files for modifications using Node.js
 * fs.watch() (which works for any absolute path, unlike vscode.workspace.createFileSystemWatcher
 * which only reliably detects changes within the workspace).
 *
 * When the log file is being written to, the agent is 'working'.
 * When writes stop for a configurable period, the agent transitions to 'waiting_for_user'.
 *
 * State machine:
 *   Terminal opens → active (existing trackHooklessTerminal)
 *   Session ID captured → polling starts (fs.watch on session log)
 *   Session log modified → working
 *   No modification for quietThresholdMs → waiting_for_user
 *   More log modification → working
 *   Terminal closes → stopPolling + idle (existing close handler)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { ensureDir, writeJson } from '../../core/services/FileService';
import { getStatusFilePath } from '../providers/AgentSessionProvider';

/**
 * Tracks a single hookless agent's session log file for activity.
 * Writes granular status ('working' / 'waiting_for_user') to the agent's status file.
 */
class PollingStatusTracker {
    private watcher: fs.FSWatcher | undefined;
    private quietTimer: NodeJS.Timeout | undefined;
    private currentStatus: string = 'active';
    private getQuietThresholdMs: () => number;

    constructor(
        private sessionLogPath: string,
        private worktreePath: string,
        quietThresholdMs?: () => number
    ) {
        this.getQuietThresholdMs = quietThresholdMs ?? (() => 3000);
        this.startWatching();
    }

    private startWatching(): void {
        try {
            // fs.watch() works for any absolute path (not limited to workspace like VS Code's FileSystemWatcher)
            this.watcher = fs.watch(this.sessionLogPath, { persistent: false }, (eventType) => {
                if (eventType === 'change') {
                    this.onActivity();
                }
            });
            // Handle watcher errors (e.g., file deleted)
            this.watcher.on('error', () => {
                this.disposeWatcher();
            });
        } catch {
            // File may not exist yet — fall back to watching the directory for creation
            this.watchDirectory();
        }
    }

    /**
     * Watch the parent directory for the session log file to appear.
     * Once it appears, switch to watching the file itself.
     */
    private watchDirectory(): void {
        const dir = path.dirname(this.sessionLogPath);
        const basename = path.basename(this.sessionLogPath);
        try {
            this.watcher = fs.watch(dir, { persistent: false }, (_eventType, filename) => {
                if (filename === basename) {
                    // File appeared or was modified — switch to file-level watching
                    this.disposeWatcher();
                    this.startWatching();
                    this.onActivity();
                }
            });
            this.watcher.on('error', () => {
                this.disposeWatcher();
            });
        } catch {
            // Directory doesn't exist either — nothing to watch
            console.warn('Lanes: PollingStatusTracker - cannot watch directory:', dir);
        }
    }

    private onActivity(): void {
        // Transition to working
        if (this.currentStatus !== 'working') {
            this.currentStatus = 'working';
            this.writeStatus('working');
        }
        // Reset quiet timer
        if (this.quietTimer) { clearTimeout(this.quietTimer); }
        const threshold = this.getQuietThresholdMs();
        this.quietTimer = setTimeout(() => {
            this.currentStatus = 'waiting_for_user';
            this.writeStatus('waiting_for_user');
        }, threshold);
    }

    private async writeStatus(status: string): Promise<void> {
        try {
            const statusPath = getStatusFilePath(this.worktreePath);
            await ensureDir(path.dirname(statusPath));
            await writeJson(statusPath, {
                status,
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.warn('Lanes: PollingStatusTracker failed to write status:', err);
        }
    }

    private disposeWatcher(): void {
        if (this.watcher) {
            this.watcher.close();
            this.watcher = undefined;
        }
    }

    dispose(): void {
        if (this.quietTimer) { clearTimeout(this.quietTimer); }
        this.disposeWatcher();
    }
}

// Module-level API: maps terminals to their polling trackers
const activeTrackers = new Map<vscode.Terminal, PollingStatusTracker>();

/**
 * Start polling a session log file for activity.
 * Uses Node.js fs.watch() to detect file modifications and transitions status
 * between 'working' and 'waiting_for_user'.
 *
 * @param terminal The terminal associated with this agent session
 * @param logPath Path to the agent's session log file
 * @param worktreePath Path to the worktree (for status file location)
 */
export function startPolling(terminal: vscode.Terminal, logPath: string, worktreePath: string): void {
    stopPolling(terminal); // clean up any existing tracker
    activeTrackers.set(terminal, new PollingStatusTracker(logPath, worktreePath, () =>
        vscode.workspace.getConfiguration('lanes.polling').get<number>('quietThresholdMs', 3000)
    ));
}

/**
 * Stop polling for a specific terminal.
 * Closes the fs.watch() watcher and clears the quiet timer.
 *
 * @param terminal The terminal to stop polling for
 */
export function stopPolling(terminal: vscode.Terminal): void {
    const tracker = activeTrackers.get(terminal);
    if (tracker) {
        tracker.dispose();
        activeTrackers.delete(terminal);
    }
}

/**
 * Dispose all active polling trackers.
 * Should be called during extension deactivation.
 */
export function disposeAll(): void {
    for (const tracker of activeTrackers.values()) { tracker.dispose(); }
    activeTrackers.clear();
}
