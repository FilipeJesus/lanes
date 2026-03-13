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
import { startDaemon, isDaemonRunning, getDaemonPort } from '../../daemon/lifecycle';
import { getErrorMessage } from '../../core/utils';

/** Maximum number of attempts to poll for the daemon port file after starting. */
const PORT_POLL_ATTEMPTS = 10;
/** Delay in milliseconds between each port-file poll attempt. */
const PORT_POLL_DELAY_MS = 300;

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
     * Errors are logged but not re-thrown — a failure leaves the service
     * disabled so the extension can fall back to direct service calls.
     */
    async initialize(): Promise<void> {
        try {
            const running = await isDaemonRunning();

            if (!running) {
                const serverPath = path.join(this.extensionPath, 'out', 'daemon.js');
                await startDaemon({ workspaceRoot: this.workspaceRoot, serverPath });

                // Poll until the daemon writes its port file (it may need a moment)
                await this.waitForPortFile();
            }

            this.client = await DaemonClient.fromWorkspace(this.workspaceRoot);
            this.enabled = true;

            this.subscribeToEvents();
        } catch (err) {
            console.error('Lanes: DaemonService initialization failed:', getErrorMessage(err));
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
     * Poll for the daemon port file up to PORT_POLL_ATTEMPTS times.
     * Resolves when a valid port is found; rejects if the timeout is exceeded.
     */
    private async waitForPortFile(): Promise<void> {
        for (let attempt = 0; attempt < PORT_POLL_ATTEMPTS; attempt++) {
            const port = await getDaemonPort();
            if (port !== undefined && port > 0) {
                return;
            }
            await delay(PORT_POLL_DELAY_MS);
        }
        throw new Error(
            `Daemon port file not available after ${PORT_POLL_ATTEMPTS * PORT_POLL_DELAY_MS}ms. ` +
            'The daemon may have failed to start.'
        );
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

/** Simple promise-based delay. */
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
