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
import { startDaemon, getDaemonErrorSummary } from '../../daemon/lifecycle';
import { getErrorMessage } from '../../core/utils';

export class DaemonService implements vscode.Disposable {
    private client: DaemonClient | undefined;
    private sseSubscription: SseSubscription | undefined;
    private enabled = false;
    private lastError: string | undefined;

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
     * 3. Confirms discovery works.
     * 4. Subscribes to SSE events that trigger onRefresh().
     *
     * Errors are logged but not re-thrown so the extension can fall back to
     * direct service calls when daemon mode is unavailable.
     */
    async initialize(): Promise<void> {
        try {
            const serverPath = await this.resolveBundledServerPath();
            await startDaemon({ workspaceRoot: this.workspaceRoot, serverPath });

            this.client = await DaemonClient.fromWorkspace(this.workspaceRoot);
            await this.client.discovery();
            this.enabled = true;
            this.lastError = undefined;

            this.subscribeToEvents();
        } catch (err) {
            this.lastError = getDaemonErrorSummary(err);
            console.error('Lanes: DaemonService initialization failed:', this.lastError);
            this.client = undefined;
            this.enabled = false;
            this.sseSubscription?.close();
            this.sseSubscription = undefined;
        }
    }

    getClient(): DaemonClient | undefined {
        return this.client;
    }

    isEnabled(): boolean {
        return this.enabled && this.client !== undefined;
    }

    getLastError(): string | undefined {
        return this.lastError;
    }

    dispose(): void {
        if (this.sseSubscription) {
            this.sseSubscription.close();
            this.sseSubscription = undefined;
        }
        this.client = undefined;
        this.enabled = false;
    }

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
