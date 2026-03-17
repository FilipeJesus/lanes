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
import { getDaemonPort, getDaemonLogPath } from './lifecycle';
import { readTokenFile } from './auth';
import { getRegisteredProjectByWorkspace, registerProject } from './registry';
import type {
    DaemonAgentConfigResponse,
    DaemonAgentListResponse,
    DaemonBranchListResponse,
    DaemonConfigGetAllResponse,
    DaemonConfigGetResponse,
    DaemonConfigSetResponse,
    DaemonDiffFilesResponse,
    DaemonDiffResponse,
    DaemonDiscoveryResponse,
    DaemonHealthResponse,
    DaemonProjectListResponse,
    DaemonRepairWorktreesResponse,
    DaemonSessionCreateResponse,
    DaemonSessionInsightsResponse,
    DaemonSessionListResponse,
    DaemonSessionOpenResponse,
    DaemonSessionStatusResponse,
    DaemonSuccessResponse,
    DaemonTerminalCreateResponse,
    DaemonTerminalListResponse,
    DaemonTerminalResizeResponse,
    DaemonTerminalSendResponse,
    DaemonWorkflowCreateResponse,
    DaemonWorkflowListResponse,
    DaemonWorkflowStateResponse,
    DaemonWorkflowValidateResponse,
    DaemonWorktreeInfoResponse,
    TerminalOutputData,
} from './contracts';

// ---------------------------------------------------------------------------
// Concrete error class for non-validation HTTP errors
// ---------------------------------------------------------------------------

/**
 * Error thrown by DaemonClient when the daemon returns a non-400 HTTP error.
 */
export class DaemonHttpError extends LanesError {
    public readonly kind = 'http' as const;

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
    query?: Record<string, string | boolean | undefined>;
}

async function ensureProjectRegistered(workspaceRoot: string) {
    const existing = await getRegisteredProjectByWorkspace(workspaceRoot);
    if (existing) {
        return existing;
    }

    await registerProject({
        projectId: '',
        workspaceRoot,
        projectName: workspaceRoot.split(/[\\/]/).pop() || workspaceRoot,
        registeredAt: new Date().toISOString(),
    });

    const registered = await getRegisteredProjectByWorkspace(workspaceRoot);
    if (!registered) {
        throw new Error(`Failed to register project for workspace ${workspaceRoot}`);
    }
    return registered;
}

// ---------------------------------------------------------------------------
// DaemonClient
// ---------------------------------------------------------------------------

export interface DaemonClientOptions {
    port?: number;
    baseUrl?: string;
    token: string;
    projectId?: string;
    timeoutMs?: number;
}

export class DaemonClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly projectPath: string;
    private readonly timeoutMs: number;

    constructor(options: DaemonClientOptions) {
        if (options.baseUrl !== undefined) {
            this.baseUrl = options.baseUrl.replace(/\/$/, '');
        } else if (options.port !== undefined) {
            this.baseUrl = `http://127.0.0.1:${options.port}`;
        } else {
            throw new Error('DaemonClient requires either baseUrl or port');
        }
        this.token = options.token;
        this.timeoutMs = options.timeoutMs ?? 30_000;
        this.projectPath = options.projectId
            ? `/api/v1/projects/${encodeURIComponent(options.projectId)}`
            : '';
    }

    /**
     * Create a DaemonClient by reading the machine-wide daemon port and token.
     * Reads `~/.lanes/daemon.port` and `~/.lanes/daemon.token`.
     */
    static async fromWorkspace(workspaceRoot: string): Promise<DaemonClient> {
        const resolved = await ensureProjectRegistered(workspaceRoot);
        const port = await getDaemonPort();
        if (port === undefined) {
            throw new Error(
                `Daemon port file not found or invalid. Is the daemon running? Log: ${getDaemonLogPath()}`
            );
        }
        const token = await readTokenFile();
        return new DaemonClient({ port, token, projectId: resolved.projectId });
    }

    private projectUrl(path: string): string {
        return this.projectPath ? `${this.projectPath}${path}` : `/api/v1${path}`;
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
        const { body, auth = true, query } = opts;
        const url = new URL(this.baseUrl + path);
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                if (value !== undefined) {
                    url.searchParams.set(key, String(value));
                }
            }
        }

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
            timeout: this.timeoutMs,
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
    health(): Promise<DaemonHealthResponse> {
        return this.request('GET', '/api/v1/health', { auth: false });
    }

    /** GET /api/v1/discovery */
    discovery(): Promise<DaemonDiscoveryResponse> {
        return this.request('GET', this.projectUrl('/discovery'));
    }

    /** GET /api/v1/projects */
    listProjects(): Promise<DaemonProjectListResponse> {
        return this.request<DaemonProjectListResponse>('GET', '/api/v1/projects');
    }

    // -------------------------------------------------------------------------
    // Sessions
    // -------------------------------------------------------------------------

    /** GET /sessions (project-scoped when projectId is set) */
    listSessions(): Promise<DaemonSessionListResponse> {
        return this.request<DaemonSessionListResponse>('GET', this.projectUrl('/sessions'));
    }

    /** POST /sessions (project-scoped when projectId is set) */
    createSession(opts: Record<string, unknown>): Promise<DaemonSessionCreateResponse> {
        return this.request<DaemonSessionCreateResponse>('POST', this.projectUrl('/sessions'), { body: opts });
    }

    /** DELETE /sessions/:name (project-scoped when projectId is set) */
    deleteSession(name: string): Promise<DaemonSuccessResponse> {
        return this.request<DaemonSuccessResponse>(
            'DELETE',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}`)
        );
    }

    /** GET /sessions/:name/status (project-scoped when projectId is set) */
    getSessionStatus(name: string): Promise<DaemonSessionStatusResponse> {
        return this.request<DaemonSessionStatusResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/status`)
        );
    }

    /** POST /sessions/:name/open (project-scoped when projectId is set) */
    openSession(name: string, opts?: Record<string, unknown>): Promise<DaemonSessionOpenResponse> {
        return this.request<DaemonSessionOpenResponse>(
            'POST',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/open`),
            {
                body: opts ?? {},
            }
        );
    }

    /** POST /sessions/:name/clear (project-scoped when projectId is set) */
    clearSession(name: string): Promise<DaemonSuccessResponse> {
        return this.request<DaemonSuccessResponse>(
            'POST',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/clear`),
            {
                body: {},
            }
        );
    }

    /** POST /sessions/:name/pin (project-scoped when projectId is set) */
    pinSession(name: string): Promise<DaemonSuccessResponse> {
        return this.request<DaemonSuccessResponse>(
            'POST',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/pin`),
            {
                body: {},
            }
        );
    }

    /** DELETE /sessions/:name/pin (project-scoped when projectId is set) */
    unpinSession(name: string): Promise<DaemonSuccessResponse> {
        return this.request<DaemonSuccessResponse>(
            'DELETE',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/pin`)
        );
    }

    // -------------------------------------------------------------------------
    // Insights
    // -------------------------------------------------------------------------

    /** GET /sessions/:name/insights?includeAnalysis=true|false (project-scoped when projectId is set) */
    getSessionInsights(
        name: string,
        opts?: { includeAnalysis?: boolean }
    ): Promise<DaemonSessionInsightsResponse> {
        const qs =
            opts?.includeAnalysis !== undefined
                ? `?includeAnalysis=${opts.includeAnalysis}`
                : '';
        return this.request<DaemonSessionInsightsResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/insights${qs}`)
        );
    }

    // -------------------------------------------------------------------------
    // Git Operations
    // -------------------------------------------------------------------------

    /** GET /api/v1/git/branches?includeRemote=true|false */
    listBranches(opts?: { includeRemote?: boolean }): Promise<DaemonBranchListResponse> {
        const qs =
            opts?.includeRemote !== undefined ? `?includeRemote=${opts.includeRemote}` : '';
        return this.request<DaemonBranchListResponse>('GET', this.projectUrl(`/git/branches${qs}`));
    }

    /** POST /api/v1/git/repair */
    repairWorktrees(opts?: Record<string, unknown>): Promise<DaemonRepairWorktreesResponse> {
        return this.request<DaemonRepairWorktreesResponse>('POST', this.projectUrl('/git/repair'), {
            body: opts ?? {},
        });
    }

    /** GET /sessions/:name/diff?includeUncommitted=true|false&baseBranch=... (project-scoped when projectId is set) */
    getSessionDiff(
        name: string,
        opts?: { includeUncommitted?: boolean; baseBranch?: string }
    ): Promise<DaemonDiffResponse> {
        const qp = new URLSearchParams();
        if (opts?.includeUncommitted !== undefined) {
            qp.set('includeUncommitted', String(opts.includeUncommitted));
        }
        if (opts?.baseBranch !== undefined) {
            qp.set('baseBranch', opts.baseBranch);
        }
        const qs = qp.toString() ? `?${qp.toString()}` : '';
        return this.request<DaemonDiffResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/diff${qs}`)
        );
    }

    /** GET /sessions/:name/diff/files?includeUncommitted=true|false&baseBranch=... (project-scoped when projectId is set) */
    getSessionDiffFiles(
        name: string,
        opts?: { includeUncommitted?: boolean; baseBranch?: string }
    ): Promise<DaemonDiffFilesResponse> {
        const qp = new URLSearchParams();
        if (opts?.includeUncommitted !== undefined) {
            qp.set('includeUncommitted', String(opts.includeUncommitted));
        }
        if (opts?.baseBranch !== undefined) {
            qp.set('baseBranch', opts.baseBranch);
        }
        const qs = qp.toString() ? `?${qp.toString()}` : '';
        return this.request<DaemonDiffFilesResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/diff/files${qs}`)
        );
    }

    /** GET /sessions/:name/worktree (project-scoped when projectId is set) */
    getWorktreeInfo(name: string): Promise<DaemonWorktreeInfoResponse> {
        return this.request<DaemonWorktreeInfoResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/worktree`)
        );
    }

    // -------------------------------------------------------------------------
    // Workflows
    // -------------------------------------------------------------------------

    /** GET /api/v1/workflows?includeBuiltin=true&includeCustom=true */
    listWorkflows(
        opts?: { includeBuiltin?: boolean; includeCustom?: boolean }
    ): Promise<DaemonWorkflowListResponse> {
        const params: string[] = [];
        if (opts?.includeBuiltin !== undefined) {
            params.push(`includeBuiltin=${opts.includeBuiltin}`);
        }
        if (opts?.includeCustom !== undefined) {
            params.push(`includeCustom=${opts.includeCustom}`);
        }
        const qs = params.length > 0 ? `?${params.join('&')}` : '';
        return this.request<DaemonWorkflowListResponse>('GET', this.projectUrl(`/workflows${qs}`));
    }

    /** POST /api/v1/workflows/validate */
    validateWorkflow(content: Record<string, unknown>): Promise<DaemonWorkflowValidateResponse> {
        return this.request<DaemonWorkflowValidateResponse>(
            'POST',
            this.projectUrl('/workflows/validate'),
            { body: content }
        );
    }

    /** POST /api/v1/workflows */
    createWorkflow(name: string, content: Record<string, unknown>): Promise<DaemonWorkflowCreateResponse> {
        return this.request<DaemonWorkflowCreateResponse>('POST', this.projectUrl('/workflows'), {
            body: { name, content },
        });
    }

    /** GET /sessions/:name/workflow (project-scoped when projectId is set) */
    getWorkflowState(name: string): Promise<DaemonWorkflowStateResponse> {
        return this.request<DaemonWorkflowStateResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/workflow`)
        );
    }

    // -------------------------------------------------------------------------
    // Agents
    // -------------------------------------------------------------------------

    /** GET /api/v1/agents */
    listAgents(): Promise<DaemonAgentListResponse> {
        return this.request<DaemonAgentListResponse>('GET', this.projectUrl('/agents'));
    }

    /** GET /api/v1/agents/:name */
    getAgentConfig(name: string): Promise<DaemonAgentConfigResponse> {
        return this.request<DaemonAgentConfigResponse>(
            'GET',
            this.projectUrl(`/agents/${encodeURIComponent(name)}`)
        );
    }

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------

    /** GET /api/v1/config */
    getAllConfig(scope?: 'effective' | 'global' | 'local'): Promise<DaemonConfigGetAllResponse> {
        return this.request<DaemonConfigGetAllResponse>('GET', this.projectUrl('/config'), {
            query: { scope },
        });
    }

    /** GET /api/v1/config/:key */
    getConfig(key: string, scope?: 'effective' | 'global' | 'local'): Promise<DaemonConfigGetResponse> {
        return this.request<DaemonConfigGetResponse>(
            'GET',
            this.projectUrl(`/config/${encodeURIComponent(key)}`),
            {
                query: { scope },
            }
        );
    }

    /** PUT /api/v1/config/:key */
    setConfig(
        key: string,
        value: unknown,
        scope?: 'global' | 'local'
    ): Promise<DaemonConfigSetResponse> {
        return this.request<DaemonConfigSetResponse>(
            'PUT',
            this.projectUrl(`/config/${encodeURIComponent(key)}`),
            {
                body: { value, scope },
            }
        );
    }

    // -------------------------------------------------------------------------
    // Terminals
    // -------------------------------------------------------------------------

    /** GET /api/v1/terminals?sessionName=optional */
    listTerminals(opts?: { sessionName?: string }): Promise<DaemonTerminalListResponse> {
        const qs = opts?.sessionName
            ? `?sessionName=${encodeURIComponent(opts.sessionName)}`
            : '';
        return this.request<DaemonTerminalListResponse>('GET', this.projectUrl(`/terminals${qs}`));
    }

    /** POST /api/v1/terminals */
    createTerminal(opts: Record<string, unknown>): Promise<DaemonTerminalCreateResponse> {
        return this.request<DaemonTerminalCreateResponse>('POST', this.projectUrl('/terminals'), {
            body: opts,
        });
    }

    /** POST /api/v1/terminals/:name/send */
    sendToTerminal(name: string, text: string): Promise<DaemonTerminalSendResponse> {
        return this.request<DaemonTerminalSendResponse>(
            'POST',
            this.projectUrl(`/terminals/${encodeURIComponent(name)}/send`),
            {
                body: { text },
            }
        );
    }

    /** GET /api/v1/terminals/:name/output */
    getTerminalOutput(name: string): Promise<TerminalOutputData> {
        return this.request<TerminalOutputData>(
            'GET',
            this.projectUrl(`/terminals/${encodeURIComponent(name)}/output`)
        );
    }

    /** POST /api/v1/terminals/:name/resize */
    resizeTerminal(name: string, cols: number, rows: number): Promise<DaemonTerminalResizeResponse> {
        return this.request<DaemonTerminalResizeResponse>(
            'POST',
            this.projectUrl(`/terminals/${encodeURIComponent(name)}/resize`),
            { body: { cols, rows } }
        );
    }

    /**
     * Subscribe to terminal output via SSE stream.
     * Polls terminal content at the server side (every 200ms) and sends diffs.
     * Returns an object with a `close()` method to stop the stream.
     */
    streamTerminalOutput(
        name: string,
        callbacks: {
            onData: (data: TerminalOutputData) => void;
            onError?: (error: Error) => void;
        }
    ): { close: () => void } {
        let closed = false;
        let currentReq: http.ClientRequest | null = null;

        const url = new URL(
            this.baseUrl + this.projectUrl(`/terminals/${encodeURIComponent(name)}/stream`)
        );
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
                res.resume();
                callbacks.onError?.(
                    new Error(`Terminal stream failed with status ${res.statusCode}`)
                );
                return;
            }

            let buffer = '';

            res.on('data', (chunk: Buffer) => {
                buffer += chunk.toString('utf-8');

                const messages = buffer.split('\n\n');
                buffer = messages.pop() ?? '';

                for (const message of messages) {
                    if (!message.trim()) {
                        continue;
                    }

                    let dataLine = '';

                    for (const line of message.split('\n')) {
                        if (line.startsWith('data:')) {
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

                    callbacks.onData(parsedData as TerminalOutputData);
                }
            });

            res.on('error', (err) => {
                if (!closed) {
                    callbacks.onError?.(err);
                }
            });
        });

        req.on('error', (err) => {
            if (!closed) {
                callbacks.onError?.(err);
            }
        });

        currentReq = req;
        req.end();

        return {
            close(): void {
                closed = true;
                if (currentReq !== null) {
                    currentReq.destroy();
                    currentReq = null;
                }
            },
        };
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

            const url = new URL(this.baseUrl + this.projectUrl('/events'));
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
