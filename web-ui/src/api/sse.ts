/**
 * SSE Client with auto-reconnection
 *
 * Uses fetch() + ReadableStream instead of browser EventSource to support
 * custom headers (Authorization: Bearer <token>).
 */

import type { AgentSessionStatus } from './types';

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface SseSessionStatusChangedPayload {
    sessionName: string;
    status: AgentSessionStatus;
}

export interface SseFileChangedPayload {
    path: string;
    eventType: 'created' | 'changed' | 'deleted';
}

export interface SseSessionCreatedPayload {
    sessionName: string;
    worktreePath: string;
}

export interface SseSessionDeletedPayload {
    sessionName: string;
}

// ---------------------------------------------------------------------------
// Callback interface
// ---------------------------------------------------------------------------

export interface SseCallbacks {
    onSessionStatusChanged?: (data: SseSessionStatusChangedPayload) => void;
    onFileChanged?: (data: SseFileChangedPayload) => void;
    onSessionCreated?: (data: SseSessionCreatedPayload) => void;
    onSessionDeleted?: (data: SseSessionDeletedPayload) => void;
    onError?: (err: Error) => void;
    onConnected?: () => void;
}

// ---------------------------------------------------------------------------
// SSE client options
// ---------------------------------------------------------------------------

export interface SseClientOptions {
    /** Base URL of the daemon, e.g. "http://127.0.0.1:3942" */
    baseUrl: string;
    /** Bearer token for authentication */
    token: string;
    projectId?: string;
    /** Reconnection delay in milliseconds. Defaults to 3000. */
    reconnectDelayMs?: number;
    /** Maximum reconnection attempts. 0 = unlimited. Defaults to 0. */
    maxReconnectAttempts?: number;
}

// ---------------------------------------------------------------------------
// DaemonSseClient
// ---------------------------------------------------------------------------

/**
 * SSE client for the daemon's project-scoped events endpoint.
 * Uses fetch() + ReadableStream so that the Authorization header can be set.
 * Automatically reconnects on disconnect.
 */
export class DaemonSseClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly reconnectDelayMs: number;
    private readonly maxReconnectAttempts: number;
    private readonly projectPath: string;

    private callbacks: SseCallbacks;
    private subscribers = new Set<SseCallbacks>();
    private abortController: AbortController | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts = 0;
    private stopped = false;

    constructor(options: SseClientOptions, callbacks: SseCallbacks = {}) {
        this.baseUrl = options.baseUrl.replace(/\/$/, '');
        this.token = options.token;
        this.reconnectDelayMs = options.reconnectDelayMs ?? 3000;
        this.maxReconnectAttempts = options.maxReconnectAttempts ?? 0;
        this.projectPath = options.projectId
            ? `/api/v1/projects/${encodeURIComponent(options.projectId)}`
            : '';
        this.callbacks = callbacks;
        if (Object.keys(callbacks).length > 0) {
            this.subscribers.add(callbacks);
        }
    }

    /**
     * Update the SSE callbacks at any time.
     * This replaces all current subscribers and keeps backward compatibility.
     */
    setCallbacks(callbacks: SseCallbacks): void {
        this.callbacks = callbacks;
        this.subscribers.clear();
        if (Object.keys(callbacks).length > 0) {
            this.subscribers.add(callbacks);
        }
    }

    /**
     * Add a callback subscriber without replacing existing ones.
     * Returns an unsubscribe function.
     */
    subscribe(callbacks: SseCallbacks): () => void {
        this.subscribers.add(callbacks);
        return () => {
            this.subscribers.delete(callbacks);
        };
    }

    /**
     * Connect to the SSE stream. Non-blocking — connection runs in the background.
     */
    connect(): void {
        this.stopped = false;
        void this.connectOnce();
    }

    /**
     * Disconnect from the SSE stream and stop all reconnection attempts.
     */
    disconnect(): void {
        this.stopped = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.abortController !== null) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    private async connectOnce(): Promise<void> {
        if (this.stopped) {return;}

        this.abortController = new AbortController();

        try {
            const url = `${this.baseUrl}${this.projectPath}/events`;
            const res = await fetch(url, {
                signal: this.abortController.signal,
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'text/event-stream',
                    'Cache-Control': 'no-cache',
                },
            });

            if (!res.ok) {
                throw new Error(`SSE connection failed: HTTP ${res.status}`);
            }

            if (!res.body) {
                throw new Error('SSE response has no body');
            }

            // Connection established
            this.reconnectAttempts = 0;
            this.emit((callbacks) => callbacks.onConnected?.());

            // Read the SSE stream line by line
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (!this.stopped) {
                const { done, value } = await reader.read();
                if (done) {break;}

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                // Keep incomplete last line in buffer
                buffer = lines.pop() ?? '';

                for (const line of lines) {
                    this.processLine(line);
                }
            }

            reader.releaseLock();
        } catch (err) {
            if (this.stopped) {return;}
            const error = err instanceof Error ? err : new Error(String(err));
            // Don't report AbortError as an error — it's intentional
            if (error.name !== 'AbortError') {
                this.emit((callbacks) => callbacks.onError?.(error));
            }
        }

        // Reconnect unless stopped or max attempts reached
        if (!this.stopped) {
            if (this.maxReconnectAttempts > 0 && this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.emit((callbacks) => callbacks.onError?.(new Error('SSE max reconnect attempts reached')));
                return;
            }
            this.reconnectAttempts++;
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                void this.connectOnce();
            }, this.reconnectDelayMs);
        }
    }

    // -------------------------------------------------------------------------
    // SSE parsing
    // -------------------------------------------------------------------------

    private currentEvent: { event?: string; data?: string } = {};

    private processLine(line: string): void {
        if (line.startsWith(':')) {
            // SSE comment — ignore (used for keep-alive)
            return;
        }

        if (line === '') {
            // Empty line = end of event block
            this.dispatchEvent();
            this.currentEvent = {};
            return;
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) {
            // Field name with no value — only accept known SSE fields
            if (line === 'event' || line === 'data') {
                this.currentEvent[line] = '';
            }
            return;
        }

        const field = line.slice(0, colonIdx);
        // Value may have a leading space after ':'
        const value = line.slice(colonIdx + 1).replace(/^ /, '');

        if (field === 'event') {
            this.currentEvent.event = value;
        } else if (field === 'data') {
            this.currentEvent.data = this.currentEvent.data !== undefined
                ? `${this.currentEvent.data}\n${value}`
                : value;
        }
    }

    private dispatchEvent(): void {
        const { event, data } = this.currentEvent;
        if (!event || !data) {return;}

        let parsed: unknown;
        try {
            parsed = JSON.parse(data);
        } catch {
            return;
        }

        switch (event) {
            case 'session_status_changed':
                this.emit((callbacks) =>
                    callbacks.onSessionStatusChanged?.(parsed as SseSessionStatusChangedPayload)
                );
                break;
            case 'file_changed':
                this.emit((callbacks) =>
                    callbacks.onFileChanged?.(parsed as SseFileChangedPayload)
                );
                break;
            case 'session_created':
                this.emit((callbacks) =>
                    callbacks.onSessionCreated?.(parsed as SseSessionCreatedPayload)
                );
                break;
            case 'session_deleted':
                this.emit((callbacks) =>
                    callbacks.onSessionDeleted?.(parsed as SseSessionDeletedPayload)
                );
                break;
            default:
                break;
        }
    }

    private emit(invoke: (callbacks: SseCallbacks) => void): void {
        if (this.subscribers.size > 0) {
            for (const subscriber of this.subscribers) {
                invoke(subscriber);
            }
            return;
        }
        invoke(this.callbacks);
    }
}
