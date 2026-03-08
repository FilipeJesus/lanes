/**
 * DaemonClient — Typed HTTP client for the Lanes daemon REST API + SSE events.
 *
 * Uses the Node.js built-in `http` module only — zero external dependencies.
 *
 * Authentication:
 *   All requests (except health) include `Authorization: Bearer <token>`.
 *
 * Error mapping:
 *   400 → ValidationError
 *   401 → DaemonHttpError (auth)
 *   404 → DaemonHttpError (not-found)
 *   5xx → DaemonHttpError (server error)
 */

import * as http from 'http';
import { ValidationError } from '../core/errors/ValidationError';
import { LanesError } from '../core/errors/LanesError';
import { getDaemonPort } from './lifecycle';
import { readTokenFile } from './auth';

// ---------------------------------------------------------------------------
// Concrete error class for non-validation HTTP errors
// ---------------------------------------------------------------------------

/**
 * Error thrown by DaemonClient when the daemon returns a non-400 HTTP error.
 */
export class DaemonHttpError extends LanesError {
    // Note: 'config' is used because LanesError's kind union does not yet include
    // an HTTP/network variant. This should be revisited when the union is extended.
    public readonly kind = 'config' as const;

    /** The HTTP status code that triggered this error. */
    public readonly statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message, `Request failed with status ${statusCode}`);
        this.name = 'DaemonHttpError';
        this.statusCode = statusCode;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, DaemonHttpError);
        }
    }
}

// ---------------------------------------------------------------------------
// SSE subscription types
// ---------------------------------------------------------------------------

export interface SseCallbacks {
    onSessionStatusChanged?: (data: { sessionName: string; status: unknown }) => void;
    onFileChanged?: (data: { path: string; eventType: 'created' | 'changed' | 'deleted' }) => void;
    onSessionCreated?: (data: { sessionName: string; worktreePath: string }) => void;
    onSessionDeleted?: (data: { sessionName: string }) => void;
    onError?: (err: Error) => void;
    onConnected?: () => void;
}

export interface SseSubscription {
    close(): void;
}

// ---------------------------------------------------------------------------
// Internal request options
// ---------------------------------------------------------------------------

interface RequestOpts {
    body?: unknown;
    /** Include Authorization header (default: true) */
    auth?: boolean;
}

// ---------------------------------------------------------------------------
// DaemonClient
// ---------------------------------------------------------------------------

export interface DaemonClientOptions {
    port?: number;
    baseUrl?: string;
    token: string;
}

export class DaemonClient {
    private readonly baseUrl: string;
    private readonly token: string;

    constructor(options: DaemonClientOptions) {
        if (options.baseUrl !== undefined) {
            this.baseUrl = options.baseUrl.replace(/\/$/, '');
        } else if (options.port !== undefined) {
            this.baseUrl = `http://127.0.0.1:${options.port}`;
        } else {
            throw new Error('DaemonClient requires either baseUrl or port');
        }
        this.token = options.token;
    }

    /**
     * Create a DaemonClient by reading port and token from workspace files.
     * Reads `.lanes/daemon.port` and `.lanes/daemon.token`.
     */
    static async fromWorkspace(workspaceRoot: string): Promise<DaemonClient> {
        const port = await getDaemonPort(workspaceRoot);
        if (port === undefined) {
            throw new Error('Daemon port file not found or invalid. Is the daemon running?');
        }
        const token = await readTokenFile(workspaceRoot);
        return new DaemonClient({ port, token });
    }

    // -------------------------------------------------------------------------
    // Internal HTTP helpers
    // -------------------------------------------------------------------------

    /**
     * Make an HTTP request and return the parsed JSON body.
     * Handles error status codes by throwing typed errors.
     */
    private request<T>(
        method: string,
        path: string,
        opts: RequestOpts = {}
    ): Promise<T> {
        const { body, auth = true } = opts;
        const url = new URL(this.baseUrl + path);

        const headers: Record<string, string> = {};
        if (auth) {
            headers['Authorization'] = `Bearer ${this.token}`;
        }

        const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;
        if (bodyStr !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
        }

        const reqOptions: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method,
            headers,
            timeout: 30_000,
        };

        return new Promise<T>((resolve, reject) => {
            const req = http.request(reqOptions, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf-8').trim();

                    let parsed: unknown;
                    try {
                        parsed = raw ? JSON.parse(raw) : {};
                    } catch {
                        parsed = {};
                    }

                    const statusCode = res.statusCode ?? 0;

                    if (statusCode >= 200 && statusCode < 300) {
                        resolve(parsed as T);
                        return;
                    }

                    const errorMessage =
                        parsed !== null &&
                        typeof parsed === 'object' &&
                        'error' in (parsed as Record<string, unknown>)
                            ? String((parsed as Record<string, unknown>).error)
                            : `HTTP ${statusCode}`;

                    if (statusCode === 400) {
                        reject(new ValidationError('request', '', errorMessage));
                        return;
                    }
                    if (statusCode === 401) {
                        reject(new DaemonHttpError(401, `Unauthorized: ${errorMessage}`));
                        return;
                    }
                    if (statusCode === 404) {
                        reject(new DaemonHttpError(404, `Not found: ${errorMessage}`));
                        return;
                    }
                    reject(new DaemonHttpError(statusCode, `Server error: ${errorMessage}`));
                });
                res.on('error', reject);
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy(new Error('Request timed out after 30s'));
            });

            if (bodyStr !== undefined) {
                req.write(bodyStr);
            }
            req.end();
        });
    }

    // -------------------------------------------------------------------------
    // Health & Discovery
    // -------------------------------------------------------------------------

    /** GET /api/v1/health — no authentication required */
    health(): Promise<{ status: string; version: string }> {
        return this.request('GET', '/api/v1/health', { auth: false });
    }

    /** GET /api/v1/discovery */
    discovery(): Promise<{
        projectName: string;
        gitRemote: string | null;
        sessionCount: number;
        uptime: number;
        workspaceRoot: string;
        port: number;
    }> {
        return this.request('GET', '/api/v1/discovery');
    }

    // -------------------------------------------------------------------------
    // Sessions
    // -------------------------------------------------------------------------

    /** GET /api/v1/sessions */
    listSessions(): Promise<unknown> {
        return this.request('GET', '/api/v1/sessions');
    }

    /** POST /api/v1/sessions */
    createSession(opts: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', '/api/v1/sessions', { body: opts });
    }

    /** DELETE /api/v1/sessions/:name */
    deleteSession(name: string): Promise<unknown> {
        return this.request('DELETE', `/api/v1/sessions/${encodeURIComponent(name)}`);
    }

    /** GET /api/v1/sessions/:name/status */
    getSessionStatus(name: string): Promise<unknown> {
        return this.request('GET', `/api/v1/sessions/${encodeURIComponent(name)}/status`);
    }

    /** POST /api/v1/sessions/:name/open */
    openSession(name: string, opts?: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', `/api/v1/sessions/${encodeURIComponent(name)}/open`, {
            body: opts ?? {},
        });
    }

    /** POST /api/v1/sessions/:name/clear */
    clearSession(name: string): Promise<unknown> {
        return this.request('POST', `/api/v1/sessions/${encodeURIComponent(name)}/clear`, {
            body: {},
        });
    }

    /** POST /api/v1/sessions/:name/pin */
    pinSession(name: string): Promise<unknown> {
        return this.request('POST', `/api/v1/sessions/${encodeURIComponent(name)}/pin`, {
            body: {},
        });
    }

    /** DELETE /api/v1/sessions/:name/pin */
    unpinSession(name: string): Promise<unknown> {
        return this.request('DELETE', `/api/v1/sessions/${encodeURIComponent(name)}/pin`);
    }

    // -------------------------------------------------------------------------
    // Insights
    // -------------------------------------------------------------------------

    /** GET /api/v1/sessions/:name/insights?includeAnalysis=true|false */
    getSessionInsights(name: string, opts?: { includeAnalysis?: boolean }): Promise<unknown> {
        const qs =
            opts?.includeAnalysis !== undefined
                ? `?includeAnalysis=${opts.includeAnalysis}`
                : '';
        return this.request('GET', `/api/v1/sessions/${encodeURIComponent(name)}/insights${qs}`);
    }

    // -------------------------------------------------------------------------
    // Git Operations
    // -------------------------------------------------------------------------

    /** GET /api/v1/git/branches?includeRemote=true|false */
    listBranches(opts?: { includeRemote?: boolean }): Promise<unknown> {
        const qs =
            opts?.includeRemote !== undefined ? `?includeRemote=${opts.includeRemote}` : '';
        return this.request('GET', `/api/v1/git/branches${qs}`);
    }

    /** POST /api/v1/git/repair */
    repairWorktrees(opts?: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', '/api/v1/git/repair', { body: opts ?? {} });
    }

    /** GET /api/v1/sessions/:name/diff?includeUncommitted=true|false */
    getSessionDiff(name: string, opts?: { includeUncommitted?: boolean }): Promise<unknown> {
        const qs =
            opts?.includeUncommitted !== undefined
                ? `?includeUncommitted=${opts.includeUncommitted}`
                : '';
        return this.request('GET', `/api/v1/sessions/${encodeURIComponent(name)}/diff${qs}`);
    }

    /** GET /api/v1/sessions/:name/diff/files?includeUncommitted=true|false */
    getSessionDiffFiles(name: string, opts?: { includeUncommitted?: boolean }): Promise<unknown> {
        const qs =
            opts?.includeUncommitted !== undefined
                ? `?includeUncommitted=${opts.includeUncommitted}`
                : '';
        return this.request(
            'GET',
            `/api/v1/sessions/${encodeURIComponent(name)}/diff/files${qs}`
        );
    }

    /** GET /api/v1/sessions/:name/worktree */
    getWorktreeInfo(name: string): Promise<unknown> {
        return this.request('GET', `/api/v1/sessions/${encodeURIComponent(name)}/worktree`);
    }

    // -------------------------------------------------------------------------
    // Workflows
    // -------------------------------------------------------------------------

    /** GET /api/v1/workflows?includeBuiltin=true&includeCustom=true */
    listWorkflows(opts?: { includeBuiltin?: boolean; includeCustom?: boolean }): Promise<unknown> {
        const params: string[] = [];
        if (opts?.includeBuiltin !== undefined) {
            params.push(`includeBuiltin=${opts.includeBuiltin}`);
        }
        if (opts?.includeCustom !== undefined) {
            params.push(`includeCustom=${opts.includeCustom}`);
        }
        const qs = params.length > 0 ? `?${params.join('&')}` : '';
        return this.request('GET', `/api/v1/workflows${qs}`);
    }

    /** POST /api/v1/workflows/validate */
    validateWorkflow(content: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', '/api/v1/workflows/validate', { body: content });
    }

    /** POST /api/v1/workflows */
    createWorkflow(name: string, content: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', '/api/v1/workflows', { body: { name, content } });
    }

    /** GET /api/v1/sessions/:name/workflow */
    getWorkflowState(name: string): Promise<unknown> {
        return this.request('GET', `/api/v1/sessions/${encodeURIComponent(name)}/workflow`);
    }

    // -------------------------------------------------------------------------
    // Agents
    // -------------------------------------------------------------------------

    /** GET /api/v1/agents */
    listAgents(): Promise<unknown> {
        return this.request('GET', '/api/v1/agents');
    }

    /** GET /api/v1/agents/:name */
    getAgentConfig(name: string): Promise<unknown> {
        return this.request('GET', `/api/v1/agents/${encodeURIComponent(name)}`);
    }

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------

    /** GET /api/v1/config */
    getAllConfig(): Promise<unknown> {
        return this.request('GET', '/api/v1/config');
    }

    /** GET /api/v1/config/:key */
    getConfig(key: string): Promise<unknown> {
        return this.request('GET', `/api/v1/config/${encodeURIComponent(key)}`);
    }

    /** PUT /api/v1/config/:key */
    setConfig(key: string, value: unknown): Promise<unknown> {
        return this.request('PUT', `/api/v1/config/${encodeURIComponent(key)}`, {
            body: { value },
        });
    }

    // -------------------------------------------------------------------------
    // Terminals
    // -------------------------------------------------------------------------

    /** GET /api/v1/terminals?sessionName=optional */
    listTerminals(opts?: { sessionName?: string }): Promise<unknown> {
        const qs = opts?.sessionName
            ? `?sessionName=${encodeURIComponent(opts.sessionName)}`
            : '';
        return this.request('GET', `/api/v1/terminals${qs}`);
    }

    /** POST /api/v1/terminals */
    createTerminal(opts: Record<string, unknown>): Promise<unknown> {
        return this.request('POST', '/api/v1/terminals', { body: opts });
    }

    /** POST /api/v1/terminals/:name/send */
    sendToTerminal(name: string, text: string): Promise<unknown> {
        return this.request('POST', `/api/v1/terminals/${encodeURIComponent(name)}/send`, {
            body: { command: text },
        });
    }

    // -------------------------------------------------------------------------
    // SSE Events
    // -------------------------------------------------------------------------

    /**
     * Subscribe to server-sent events from the daemon.
     * Auto-reconnects on connection loss with exponential backoff.
     * Returns an object with a `close()` method to stop listening.
     */
    subscribeEvents(callbacks: SseCallbacks): SseSubscription {
        let closed = false;
        let currentReq: http.ClientRequest | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const connect = (): void => {
            if (closed) {
                return;
            }

            const url = new URL(this.baseUrl + '/api/v1/events');
            const reqOptions: http.RequestOptions = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: 'text/event-stream',
                },
            };

            const req = http.request(reqOptions, (res) => {
                if (res.statusCode !== 200) {
                    // Not a valid SSE connection — consume body and schedule reconnect
                    res.resume();
                    callbacks.onError?.(new Error(`SSE connection failed with status ${res.statusCode}`));
                    scheduleReconnect();
                    return;
                }

                // Reset backoff on successful connection
                attempt = 0;
                callbacks.onConnected?.();

                let buffer = '';

                res.on('data', (chunk: Buffer) => {
                    buffer += chunk.toString('utf-8');

                    // SSE messages are separated by double newlines
                    const messages = buffer.split('\n\n');
                    // The last element may be an incomplete message
                    buffer = messages.pop() ?? '';

                    for (const message of messages) {
                        if (!message.trim()) {
                            continue;
                        }

                        let eventType = 'message';
                        let dataLine = '';

                        for (const line of message.split('\n')) {
                            if (line.startsWith('event:')) {
                                eventType = line.slice('event:'.length).trim();
                            } else if (line.startsWith('data:')) {
                                dataLine = line.slice('data:'.length).trim();
                            }
                        }

                        if (!dataLine) {
                            continue;
                        }

                        let parsedData: unknown;
                        try {
                            parsedData = JSON.parse(dataLine);
                        } catch {
                            continue;
                        }

                        switch (eventType) {
                            case 'sessionStatusChanged':
                                callbacks.onSessionStatusChanged?.(
                                    parsedData as { sessionName: string; status: unknown }
                                );
                                break;
                            case 'fileChanged':
                                callbacks.onFileChanged?.(
                                    parsedData as {
                                        path: string;
                                        eventType: 'created' | 'changed' | 'deleted';
                                    }
                                );
                                break;
                            case 'sessionCreated':
                                callbacks.onSessionCreated?.(
                                    parsedData as { sessionName: string; worktreePath: string }
                                );
                                break;
                            case 'sessionDeleted':
                                callbacks.onSessionDeleted?.(
                                    parsedData as { sessionName: string }
                                );
                                break;
                            default:
                                break;
                        }
                    }
                });

                res.on('error', (err) => {
                    if (!closed) {
                        callbacks.onError?.(err);
                        scheduleReconnect();
                    }
                });

                res.on('end', () => {
                    if (!closed) {
                        scheduleReconnect();
                    }
                });
            });

            req.on('error', (err) => {
                if (!closed) {
                    callbacks.onError?.(err);
                    scheduleReconnect();
                }
            });

            currentReq = req;
            req.end();
        };

        const scheduleReconnect = (): void => {
            if (closed) {
                return;
            }
            // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
            const delayMs = Math.min(1000 * Math.pow(2, attempt), 30_000);
            attempt++;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                connect();
            }, delayMs);
        };

        connect();

        return {
            close(): void {
                closed = true;
                if (reconnectTimer !== null) {
                    clearTimeout(reconnectTimer);
                    reconnectTimer = null;
                }
                if (currentReq !== null) {
                    currentReq.destroy();
                    currentReq = null;
                }
            },
        };
    }
}
