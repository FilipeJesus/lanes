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
import { DaemonClient, type SseSubscription } from '../../daemon/client';
import { startDaemon, getDaemonErrorSummary } from '../../daemon/lifecycle';
import { getErrorMessage } from '../../core/utils';

export class DaemonService implements vscode.Disposable {
    private client: DaemonClient | undefined;
    private sseSubscription: SseSubscription | undefined;
    private enabled = false;
    private lastError: string | undefined;

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
     * 1. Routes lifecycle through startDaemon(), which either reuses a running
     *    daemon or starts a new one and waits for readiness.
     * 2. Creates a DaemonClient from workspace files.
     * 3. Subscribes to SSE events that trigger onRefresh().
     *
     * Errors are logged but not re-thrown — a failure leaves the service
     * disabled so the extension can fall back to direct service calls.
     */
    async initialize(): Promise<void> {
        try {
            const serverPath = path.join(this.extensionPath, 'out', 'daemon', 'server.js');
            await startDaemon({ workspaceRoot: this.workspaceRoot, serverPath });

            this.client = await DaemonClient.fromWorkspace(this.workspaceRoot);
            this.enabled = true;
            this.lastError = undefined;

            this.subscribeToEvents();
        } catch (err) {
            this.lastError = getDaemonErrorSummary(err);
            console.error('Lanes: DaemonService initialization failed:', this.lastError);
            this.client = undefined;
            this.enabled = false;
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

    getLastError(): string | undefined {
        return this.lastError;
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

}
