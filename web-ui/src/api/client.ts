/**
 * DaemonApiClient
 *
 * Typed fetch wrapper for all Lanes daemon REST API endpoints.
 * The daemon runs on 127.0.0.1:<port> and requires Bearer token authentication.
 */

import type {
    HealthResponse,
    DiscoveryInfo,
    SessionListResponse,
    SessionInfo,
    CreateSessionRequest,
    CreateSessionResponse,
    SessionStatusResponse,
    InsightsResponse,
    DiffResult,
    DiffFilesResult,
    WorktreeInfo,
    WorkflowState,
    GitBranchesResponse,
    GitRepairResult,
    WorkflowInfo,
    WorkflowValidateResult,
    AgentInfo,
    ConfigGetAllResponse,
    ConfigEntry,
    TerminalListResponse,
    CreateTerminalRequest,
    CreateTerminalResponse,
    TerminalSendRequest,
    TerminalOutputData,
    TerminalResizeRequest,
    ImproveSessionPromptRequest,
    ImproveSessionPromptResponse,
    UploadSessionAttachmentsRequest,
    UploadSessionAttachmentsResponse,
} from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
    constructor(
        public readonly status: number,
        public readonly body: unknown,
        message?: string
    ) {
        super(message ?? `HTTP ${status}`);
        this.name = 'ApiClientError';
    }
}

// ---------------------------------------------------------------------------
// Client options
// ---------------------------------------------------------------------------

export interface DaemonApiClientOptions {
    /** Base URL of the daemon, e.g. "http://127.0.0.1:3942" */
    baseUrl: string;
    /** Bearer token for authentication */
    token: string;
    /** Project identifier served by the global daemon */
    projectId?: string;
}

// ---------------------------------------------------------------------------
// DaemonApiClient
// ---------------------------------------------------------------------------

export class DaemonApiClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly projectPath: string;

    constructor({ baseUrl, token, projectId }: DaemonApiClientOptions) {
        // Strip trailing slash
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.token = token;
        this.projectPath = projectId ? `/api/v1/projects/${encodeURIComponent(projectId)}` : '';
    }

    private projectUrl(path: string): string {
        return this.projectPath ? `${this.projectPath}${path}` : `/api/v1${path}`;
    }

    // -------------------------------------------------------------------------
    // Internal fetch helper
    // -------------------------------------------------------------------------

    private async request<T>(
        method: string,
        path: string,
        options: { body?: unknown; query?: Record<string, string | boolean | undefined> } = {}
    ): Promise<T> {
        let url = `${this.baseUrl}${path}`;

        if (options.query) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options.query)) {
                if (value !== undefined) {
                    params.set(key, String(value));
                }
            }
            const qs = params.toString();
            if (qs) {
                url += `?${qs}`;
            }
        }

        const headers: Record<string, string> = {
            Authorization: `Bearer ${this.token}`,
        };

        let body: string | undefined;
        if (options.body !== undefined) {
            body = JSON.stringify(options.body);
            headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(url, { method, headers, body });

        if (!res.ok) {
            const errorText = await res.text();
            let errorBody: unknown;
            try {
                errorBody = JSON.parse(errorText);
            } catch {
                errorBody = errorText;
            }
            throw new ApiClientError(res.status, errorBody);
        }

        // Some DELETE endpoints may return 204 with no body
        if (res.status === 204) {
            return undefined as unknown as T;
        }

        return (await res.json()) as T;
    }

    // -------------------------------------------------------------------------
    // Health & Discovery
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/health — no auth required.
     */
    async getHealth(): Promise<HealthResponse> {
        const url = `${this.baseUrl}/api/v1/health`;
        const res = await fetch(url);
        if (!res.ok) {
            throw new ApiClientError(res.status, await res.text());
        }
        return res.json() as Promise<HealthResponse>;
    }

    /**
     * GET /api/v1/discovery
     */
    async getDiscovery(): Promise<DiscoveryInfo> {
        return this.request<DiscoveryInfo>('GET', this.projectUrl('/discovery'));
    }

    // -------------------------------------------------------------------------
    // Sessions
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/sessions
     */
    async listSessions(): Promise<SessionListResponse> {
        return this.request<SessionListResponse>('GET', this.projectUrl('/sessions'));
    }

    /**
     * POST /api/v1/sessions
     */
    async createSession(params: CreateSessionRequest): Promise<CreateSessionResponse> {
        return this.request<CreateSessionResponse>('POST', this.projectUrl('/sessions'), { body: params });
    }

    /**
     * POST /api/v1/session-form/improve-prompt
     */
    async improveSessionPrompt(
        params: ImproveSessionPromptRequest
    ): Promise<ImproveSessionPromptResponse> {
        return this.request<ImproveSessionPromptResponse>(
            'POST',
            this.projectUrl('/session-form/improve-prompt'),
            { body: params }
        );
    }

    /**
     * POST /api/v1/session-form/attachments
     */
    async uploadSessionAttachments(
        params: UploadSessionAttachmentsRequest
    ): Promise<UploadSessionAttachmentsResponse> {
        return this.request<UploadSessionAttachmentsResponse>(
            'POST',
            this.projectUrl('/session-form/attachments'),
            { body: params }
        );
    }

    /**
     * DELETE /api/v1/sessions/:name
     */
    async deleteSession(name: string): Promise<void> {
        return this.request<void>('DELETE', this.projectUrl(`/sessions/${encodeURIComponent(name)}`));
    }

    /**
     * GET /api/v1/sessions/:name/status
     */
    async getSessionStatus(name: string): Promise<SessionStatusResponse> {
        return this.request<SessionStatusResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/status`)
        );
    }

    /**
     * POST /api/v1/sessions/:name/open
     */
    async openSession(name: string): Promise<unknown> {
        return this.request<unknown>('POST', this.projectUrl(`/sessions/${encodeURIComponent(name)}/open`));
    }

    /**
     * POST /api/v1/sessions/:name/clear
     */
    async clearSession(name: string): Promise<unknown> {
        return this.request<unknown>('POST', this.projectUrl(`/sessions/${encodeURIComponent(name)}/clear`));
    }

    /**
     * POST /api/v1/sessions/:name/pin
     */
    async pinSession(name: string): Promise<SessionInfo> {
        return this.request<SessionInfo>('POST', this.projectUrl(`/sessions/${encodeURIComponent(name)}/pin`));
    }

    /**
     * DELETE /api/v1/sessions/:name/pin
     */
    async unpinSession(name: string): Promise<SessionInfo> {
        return this.request<SessionInfo>('DELETE', this.projectUrl(`/sessions/${encodeURIComponent(name)}/pin`));
    }

    /**
     * POST /api/v1/sessions/:name/notifications
     */
    async enableSessionNotifications(name: string): Promise<SessionInfo> {
        return this.request<SessionInfo>(
            'POST',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/notifications`)
        );
    }

    /**
     * DELETE /api/v1/sessions/:name/notifications
     */
    async disableSessionNotifications(name: string): Promise<SessionInfo> {
        return this.request<SessionInfo>(
            'DELETE',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/notifications`)
        );
    }

    /**
     * GET /api/v1/sessions/:name/insights
     */
    async getSessionInsights(name: string, includeAnalysis?: boolean): Promise<InsightsResponse> {
        return this.request<InsightsResponse>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/insights`),
            { query: { includeAnalysis } }
        );
    }

    /**
     * GET /api/v1/sessions/:name/diff
     */
    async getSessionDiff(name: string, includeUncommitted?: boolean, baseBranch?: string): Promise<DiffResult> {
        return this.request<DiffResult>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/diff`),
            { query: { includeUncommitted, baseBranch } }
        );
    }

    /**
     * GET /api/v1/sessions/:name/diff/files
     */
    async getSessionDiffFiles(name: string, includeUncommitted?: boolean, baseBranch?: string): Promise<DiffFilesResult> {
        return this.request<DiffFilesResult>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/diff/files`),
            { query: { includeUncommitted, baseBranch } }
        );
    }

    /**
     * GET /api/v1/sessions/:name/worktree
     */
    async getSessionWorktree(name: string): Promise<WorktreeInfo> {
        return this.request<WorktreeInfo>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/worktree`)
        );
    }

    /**
     * GET /api/v1/sessions/:name/workflow
     */
    async getSessionWorkflow(name: string): Promise<WorkflowState> {
        return this.request<WorkflowState>(
            'GET',
            this.projectUrl(`/sessions/${encodeURIComponent(name)}/workflow`)
        );
    }

    // -------------------------------------------------------------------------
    // Git
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/git/branches
     */
    async getGitBranches(includeRemote?: boolean): Promise<GitBranchesResponse> {
        return this.request<GitBranchesResponse>('GET', this.projectUrl('/git/branches'), {
            query: { includeRemote },
        });
    }

    /**
     * POST /api/v1/git/repair
     */
    async repairGit(params?: Record<string, unknown>): Promise<GitRepairResult> {
        return this.request<GitRepairResult>('POST', this.projectUrl('/git/repair'), { body: params ?? {} });
    }

    // -------------------------------------------------------------------------
    // Workflows
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/workflows
     */
    async listWorkflows(options?: {
        includeBuiltin?: boolean;
        includeCustom?: boolean;
    }): Promise<{ workflows: WorkflowInfo[] }> {
        return this.request<{ workflows: WorkflowInfo[] }>('GET', this.projectUrl('/workflows'), {
            query: {
                includeBuiltin: options?.includeBuiltin,
                includeCustom: options?.includeCustom,
            },
        });
    }

    /**
     * POST /api/v1/workflows/validate
     */
    async validateWorkflow(body: Record<string, unknown>): Promise<WorkflowValidateResult> {
        return this.request<WorkflowValidateResult>('POST', this.projectUrl('/workflows/validate'), { body });
    }

    /**
     * POST /api/v1/workflows
     */
    async createWorkflow(body: Record<string, unknown>): Promise<WorkflowInfo> {
        return this.request<WorkflowInfo>('POST', this.projectUrl('/workflows'), { body });
    }

    // -------------------------------------------------------------------------
    // Agents
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/agents
     */
    async listAgents(): Promise<{ agents: AgentInfo[] }> {
        return this.request<{ agents: AgentInfo[] }>('GET', this.projectUrl('/agents'));
    }

    /**
     * GET /api/v1/agents/:name
     */
    async getAgent(name: string): Promise<AgentInfo> {
        return this.request<AgentInfo>('GET', this.projectUrl(`/agents/${encodeURIComponent(name)}`));
    }

    // -------------------------------------------------------------------------
    // Config
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/config
     */
    async getAllConfig(): Promise<ConfigGetAllResponse> {
        return this.request<ConfigGetAllResponse>('GET', this.projectUrl('/config'));
    }

    /**
     * GET /api/v1/config/:key
     */
    async getConfig(key: string): Promise<ConfigEntry> {
        return this.request<ConfigEntry>('GET', this.projectUrl(`/config/${encodeURIComponent(key)}`));
    }

    /**
     * PUT /api/v1/config/:key
     */
    async setConfig(key: string, value: unknown): Promise<ConfigEntry> {
        return this.request<ConfigEntry>('PUT', this.projectUrl(`/config/${encodeURIComponent(key)}`), {
            body: { value },
        });
    }

    // -------------------------------------------------------------------------
    // Terminals
    // -------------------------------------------------------------------------

    /**
     * GET /api/v1/terminals
     */
    async listTerminals(sessionName?: string): Promise<TerminalListResponse> {
        return this.request<TerminalListResponse>('GET', this.projectUrl('/terminals'), {
            query: sessionName ? { sessionName } : undefined,
        });
    }

    /**
     * POST /api/v1/terminals
     */
    async createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse> {
        return this.request<CreateTerminalResponse>('POST', this.projectUrl('/terminals'), { body: params });
    }

    /**
     * POST /api/v1/terminals/:name/send
     */
    async sendToTerminal(name: string, params: TerminalSendRequest): Promise<unknown> {
        return this.request<unknown>(
            'POST',
            this.projectUrl(`/terminals/${encodeURIComponent(name)}/send`),
            { body: params }
        );
    }

    /**
     * GET /api/v1/terminals/:name/output
     */
    async getTerminalOutput(name: string): Promise<TerminalOutputData> {
        return this.request<TerminalOutputData>(
            'GET',
            this.projectUrl(`/terminals/${encodeURIComponent(name)}/output`)
        );
    }

    /**
     * POST /api/v1/terminals/:name/resize
     */
    async resizeTerminal(name: string, params: TerminalResizeRequest): Promise<unknown> {
        return this.request<unknown>(
            'POST',
            this.projectUrl(`/terminals/${encodeURIComponent(name)}/resize`),
            { body: params }
        );
    }

    /**
     * GET /api/v1/terminals/:name/stream (SSE)
     *
     * Connects to the terminal output SSE stream using the Fetch API's ReadableStream.
     * Returns an object with a `close()` method to abort the stream.
     *
     * @param name Terminal name
     * @param onData Callback invoked with each TerminalOutputData event
     * @param onError Optional callback for stream errors
     */
    streamTerminalOutput(
        name: string,
        onData: (data: TerminalOutputData) => void,
        onError?: (error: Error) => void
    ): { close: () => void } {
        const controller = new AbortController();
        const url = `${this.baseUrl}${this.projectUrl(`/terminals/${encodeURIComponent(name)}/stream`)}`;

        const run = async (): Promise<void> => {
            try {
                const res = await fetch(url, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        Accept: 'text/event-stream',
                    },
                    signal: controller.signal,
                });

                if (!res.ok || !res.body) {
                    onError?.(new Error(`Terminal stream failed with status ${res.status}`));
                    return;
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });

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

                        try {
                            const parsed = JSON.parse(dataLine) as TerminalOutputData;
                            onData(parsed);
                        } catch {
                            // Skip unparseable events
                        }
                    }
                }
            } catch (err) {
                if (err instanceof Error && err.name !== 'AbortError') {
                    onError?.(err);
                }
            }
        };

        void run();

        return {
            close(): void {
                controller.abort();
            },
        };
    }
}
