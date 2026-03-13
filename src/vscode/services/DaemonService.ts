/**
 * DaemonService - Manages the lifecycle of the Lanes daemon within VS Code.
 *
 * Responsibilities:
 * - Checks if the daemon is running and auto-starts it if needed
 * - Creates and holds a DaemonClient instance
 * - Subscribes to SSE events to trigger tree view refreshes
 * - Cleans up SSE connections on deactivation (implements vscode.Disposable)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { DaemonClient, type SseSubscription } from '../../daemon/client';
import {
    startDaemon,
    isDaemonRunning,
    waitForDaemonReady,
    getDaemonLogPath,
} from '../../daemon/lifecycle';
import { getErrorMessage } from '../../core/utils';

export class DaemonService implements vscode.Disposable {
    private client: DaemonClient | undefined;
    private sseSubscription: SseSubscription | undefined;
    private enabled = false;

    /**
     * @param workspaceRoot - Absolute path to the repository root.
     * @param extensionPath - Absolute path to the extension installation directory.
     * @param onRefresh    - Callback invoked when the session tree view should refresh.
     */
    constructor(
        private readonly workspaceRoot: string,
        private readonly extensionPath: string,
        private readonly onRefresh: () => void
    ) {}

    /**
     * Initialize the daemon service:
     * 1. Checks if the daemon is already running.
     * 2. If not, starts it using the bundled server script.
     * 3. Waits for the port file to be written (polls a few times).
     * 4. Creates a DaemonClient from workspace files.
     * 5. Subscribes to SSE events that trigger onRefresh().
     *
     */
    async initialize(): Promise<void> {
        try {
            const running = await isDaemonRunning(this.workspaceRoot);

            if (!running) {
                const serverPath = await this.resolveBundledServerPath();
                await startDaemon({ workspaceRoot: this.workspaceRoot, serverPath });
                await waitForDaemonReady();
            }

            this.client = await DaemonClient.fromWorkspace(this.workspaceRoot);
            await this.client.discovery();
            this.enabled = true;

            this.subscribeToEvents();
        } catch (err) {
            this.client = undefined;
            this.enabled = false;
            this.sseSubscription?.close();
            this.sseSubscription = undefined;
            throw new Error(
                `Daemon initialization failed: ${getErrorMessage(err)}. ` +
                `Check ${getDaemonLogPath()} for details.`
            );
        }
    }

    /**
     * Return the active DaemonClient, or undefined if not initialized / initialization failed.
     */
    getClient(): DaemonClient | undefined {
        return this.client;
    }

    /**
     * Returns true if the daemon service initialized successfully and a client is available.
     */
    isEnabled(): boolean {
        return this.enabled && this.client !== undefined;
    }

    /**
     * Clean up: close the SSE subscription.
     * The daemon process itself is left running so other windows can use it.
     */
    dispose(): void {
        if (this.sseSubscription) {
            this.sseSubscription.close();
            this.sseSubscription = undefined;
        }
        this.client = undefined;
        this.enabled = false;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * Subscribe to SSE events from the daemon.
     * Fires onRefresh() for session lifecycle events (created, deleted, status changed).
     */
    private subscribeToEvents(): void {
        if (!this.client) {
            return;
        }

        this.sseSubscription = this.client.subscribeEvents({
            onSessionCreated: () => {
                this.onRefresh();
            },
            onSessionDeleted: () => {
                this.onRefresh();
            },
            onSessionStatusChanged: () => {
                this.onRefresh();
            },
            onConnected: () => {
                console.log('Lanes: Connected to daemon SSE stream');
            },
            onError: (err) => {
                console.error('Lanes: Daemon SSE error:', getErrorMessage(err));
            },
        });
    }

    private async resolveBundledServerPath(): Promise<string> {
        const candidatePaths = [
            path.join(this.extensionPath, 'out', 'daemon.js'),
            path.join(this.extensionPath, 'out', 'daemon', 'server.js'),
        ];

        for (const candidate of candidatePaths) {
            try {
                await fs.access(candidate);
                return candidate;
            } catch {
                // Try the next known bundle location.
            }
        }

        throw new Error(
            `Bundled daemon entrypoint not found. Tried: ${candidatePaths.join(', ')}`
        );
    }
}
