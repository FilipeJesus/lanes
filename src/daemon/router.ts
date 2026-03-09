/**
 * Daemon REST API Router
 *
 * Maps HTTP routes to SessionHandlerService methods.
 * Uses Node.js built-in `http` module only — zero external dependencies.
 *
 * Auth: validates `Authorization: Bearer <token>` on all routes except /api/v1/health.
 * Error mapping:
 *   JsonRpcHandlerError code -32602 → 400 Bad Request
 *   JsonRpcHandlerError code -32601 → 404 Not Found
 *   Other errors → 500 Internal Server Error
 */

import * as http from 'http';
import * as path from 'path';
import { SessionHandlerService, JsonRpcHandlerError } from '../core/services/SessionHandlerService';
import { DaemonNotificationEmitter } from './notifications';
import { validateAuthHeader } from './auth';
import { execGit } from '../core/gitService';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum allowed request body size (1 MiB). Prevents DoS via oversized payloads. */
const MAX_BODY_SIZE = 1024 * 1024;

/** API version reported by the health endpoint. */
const DAEMON_API_VERSION = '1';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Set CORS headers on a response to allow local development clients.
 */
function setCorsHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}

/**
 * Send a JSON response with the given status code and body.
 */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

/**
 * Send an error JSON response, mapping error types to appropriate HTTP status codes.
 */
function sendError(res: http.ServerResponse, err: unknown): void {
    if (err instanceof JsonRpcHandlerError) {
        if (err.code === -32602) {
            sendJson(res, 400, { error: err.message });
            return;
        }
        if (err.code === -32601) {
            sendJson(res, 404, { error: err.message });
            return;
        }
    }
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: message });
}

/**
 * Read and parse a JSON request body. Returns an empty object on empty body.
 * Rejects with an error if the body is not valid JSON.
 */
async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let totalLength = 0;
        req.on('data', (chunk: Buffer) => {
            totalLength += chunk.length;
            if (totalLength > MAX_BODY_SIZE) {
                req.destroy();
                reject(new Error('Request body too large'));
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8').trim();
            if (!raw) {
                resolve({});
                return;
            }
            try {
                const parsed: unknown = JSON.parse(raw);
                if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                    resolve(parsed as Record<string, unknown>);
                } else {
                    reject(new Error('Request body must be a JSON object'));
                }
            } catch {
                reject(new Error('Invalid JSON in request body'));
            }
        });
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Query string helpers
// ---------------------------------------------------------------------------

/**
 * Parse the query string portion of a raw URL into a key-value map.
 * Returns an empty object when there is no query string.
 */
function parseQueryString(rawUrl: string): Record<string, string> {
    const qIndex = rawUrl.indexOf('?');
    if (qIndex === -1 || qIndex === rawUrl.length - 1) {
        return {};
    }
    const query = rawUrl.slice(qIndex + 1);
    const result: Record<string, string> = {};
    for (const part of query.split('&')) {
        if (!part) {
            continue;
        }
        const eqIndex = part.indexOf('=');
        if (eqIndex === -1) {
            result[decodeURIComponent(part)] = '';
        } else {
            const key = decodeURIComponent(part.slice(0, eqIndex));
            const value = decodeURIComponent(part.slice(eqIndex + 1));
            result[key] = value;
        }
    }
    return result;
}

/**
 * Convert a query string value to a boolean.
 * Treats `"true"` and `"1"` as `true`; everything else (including absence) as `false`.
 */
function parseBooleanParam(value: string | undefined): boolean {
    return value === 'true' || value === '1';
}

// ---------------------------------------------------------------------------
// Route matching helpers
// ---------------------------------------------------------------------------

interface RouteMatch {
    params: Record<string, string>;
}

/**
 * Match a URL pathname against a route pattern.
 * Supports `:param` segments.
 * Returns null if the pattern does not match.
 */
function matchRoute(pattern: string, pathname: string): RouteMatch | null {
    const patternParts = pattern.split('/');
    const pathParts = pathname.split('/');

    if (patternParts.length !== pathParts.length) {
        return null;
    }

    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
        const pp = patternParts[i];
        const vp = pathParts[i];
        if (pp.startsWith(':')) {
            params[pp.slice(1)] = decodeURIComponent(vp);
        } else if (pp !== vp) {
            return null;
        }
    }

    return { params };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Create the HTTP request handler (router) for the daemon.
 *
 * @param handlerService  The protocol-agnostic session handler service.
 * @param notificationEmitter  The SSE notification emitter.
 * @param authToken  The Bearer token clients must supply for authentication.
 * @param context  Additional server context used by the discovery endpoint.
 * @returns An HTTP request handler function suitable for `http.createServer()`.
 */
export function createRouter(
    handlerService: SessionHandlerService,
    notificationEmitter: DaemonNotificationEmitter,
    authToken: string,
    context: { workspaceRoot: string; startedAt: string; port: number }
): (req: http.IncomingMessage, res: http.ServerResponse) => void {
    return async function router(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): Promise<void> {
        const method = req.method ?? 'GET';
        const rawUrl = req.url ?? '/';
        // Strip query string for routing
        const pathname = rawUrl.split('?')[0];
        const queryParams = parseQueryString(rawUrl);

        // Always set CORS headers
        setCorsHeaders(res);

        // Handle CORS pre-flight
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Health check — no auth required
        if (method === 'GET' && pathname === '/api/v1/health') {
            sendJson(res, 200, { status: 'ok', version: DAEMON_API_VERSION });
            return;
        }

        // Auth middleware for all other routes
        const authHeader = req.headers['authorization'];
        if (!validateAuthHeader(authHeader, authToken)) {
            sendJson(res, 401, { error: 'Unauthorized' });
            return;
        }

        try {
            // ---------------------------------------------------------------
            // Discovery
            // ---------------------------------------------------------------

            // GET /api/v1/discovery
            if (method === 'GET' && pathname === '/api/v1/discovery') {
                let gitRemote: string | null = null;
                try {
                    gitRemote = (await execGit(['remote', 'get-url', 'origin'], context.workspaceRoot)).trim();
                } catch {
                    gitRemote = null;
                }

                const sessionsResult = await handlerService.handleSessionList({}) as { sessions?: unknown[] };
                const sessionCount = Array.isArray(sessionsResult.sessions) ? sessionsResult.sessions.length : 0;

                const uptime = Math.floor((Date.now() - new Date(context.startedAt).getTime()) / 1000);

                sendJson(res, 200, {
                    projectName: path.basename(context.workspaceRoot),
                    gitRemote,
                    sessionCount,
                    uptime,
                    workspaceRoot: context.workspaceRoot,
                    port: context.port,
                });
                return;
            }

            // ---------------------------------------------------------------
            // SSE events stream
            // ---------------------------------------------------------------
            if (method === 'GET' && pathname === '/api/v1/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });
                // Send an initial comment to establish the stream
                res.write(': connected\n\n');
                notificationEmitter.addClient(res);
                return;
            }

            // ---------------------------------------------------------------
            // Sessions
            // ---------------------------------------------------------------

            // GET /api/v1/sessions
            if (method === 'GET' && pathname === '/api/v1/sessions') {
                const result = await handlerService.handleSessionList({});
                sendJson(res, 200, result);
                return;
            }

            // POST /api/v1/sessions
            if (method === 'POST' && pathname === '/api/v1/sessions') {
                const body = await readJsonBody(req);
                const result = await handlerService.handleSessionCreate(body);
                sendJson(res, 200, result);
                return;
            }

            // DELETE /api/v1/sessions/:name
            {
                const match = matchRoute('/api/v1/sessions/:name', pathname);
                if (method === 'DELETE' && match) {
                    const result = await handlerService.handleSessionDelete({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // GET /api/v1/sessions/:name/status
            {
                const match = matchRoute('/api/v1/sessions/:name/status', pathname);
                if (method === 'GET' && match) {
                    const result = await handlerService.handleSessionGetStatus({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // POST /api/v1/sessions/:name/open
            {
                const match = matchRoute('/api/v1/sessions/:name/open', pathname);
                if (method === 'POST' && match) {
                    const body = await readJsonBody(req);
                    const result = await handlerService.handleSessionOpen({
                        sessionName: match.params.name,
                        ...body,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // POST /api/v1/sessions/:name/clear
            {
                const match = matchRoute('/api/v1/sessions/:name/clear', pathname);
                if (method === 'POST' && match) {
                    const result = await handlerService.handleSessionClear({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // POST /api/v1/sessions/:name/pin
            {
                const match = matchRoute('/api/v1/sessions/:name/pin', pathname);
                if (method === 'POST' && match) {
                    const result = await handlerService.handleSessionPin({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // DELETE /api/v1/sessions/:name/pin
            {
                const match = matchRoute('/api/v1/sessions/:name/pin', pathname);
                if (method === 'DELETE' && match) {
                    const result = await handlerService.handleSessionUnpin({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // GET /api/v1/sessions/:name/diff/files
            {
                const match = matchRoute('/api/v1/sessions/:name/diff/files', pathname);
                if (method === 'GET' && match) {
                    const params: Record<string, unknown> = { sessionName: match.params.name };
                    if (queryParams['includeUncommitted'] !== undefined) {
                        params.includeUncommitted = parseBooleanParam(queryParams['includeUncommitted']);
                    }
                    if (queryParams['baseBranch'] !== undefined) {
                        params.baseBranch = queryParams['baseBranch'];
                    }
                    const result = await handlerService.handleGitGetDiffFiles(params);
                    sendJson(res, 200, result);
                    return;
                }
            }

            // GET /api/v1/sessions/:name/diff
            {
                const match = matchRoute('/api/v1/sessions/:name/diff', pathname);
                if (method === 'GET' && match) {
                    const params: Record<string, unknown> = { sessionName: match.params.name };
                    if (queryParams['includeUncommitted'] !== undefined) {
                        params.includeUncommitted = parseBooleanParam(queryParams['includeUncommitted']);
                    }
                    if (queryParams['baseBranch'] !== undefined) {
                        params.baseBranch = queryParams['baseBranch'];
                    }
                    const result = await handlerService.handleGitGetDiff(params);
                    sendJson(res, 200, result);
                    return;
                }
            }

            // GET /api/v1/sessions/:name/worktree
            {
                const match = matchRoute('/api/v1/sessions/:name/worktree', pathname);
                if (method === 'GET' && match) {
                    const result = await handlerService.handleGitGetWorktreeInfo({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // GET /api/v1/sessions/:name/workflow
            {
                const match = matchRoute('/api/v1/sessions/:name/workflow', pathname);
                if (method === 'GET' && match) {
                    const result = await handlerService.handleWorkflowGetState({
                        sessionName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // GET /api/v1/sessions/:name/insights
            {
                const match = matchRoute('/api/v1/sessions/:name/insights', pathname);
                if (method === 'GET' && match) {
                    const includeAnalysis = queryParams['includeAnalysis'] !== undefined
                        ? parseBooleanParam(queryParams['includeAnalysis'])
                        : true;
                    const result = await handlerService.handleSessionInsights({
                        sessionName: match.params.name,
                        includeAnalysis,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // ---------------------------------------------------------------
            // Agents
            // ---------------------------------------------------------------

            // GET /api/v1/agents
            if (method === 'GET' && pathname === '/api/v1/agents') {
                const result = await handlerService.handleAgentList({});
                sendJson(res, 200, result);
                return;
            }

            // GET /api/v1/agents/:name
            {
                const match = matchRoute('/api/v1/agents/:name', pathname);
                if (method === 'GET' && match) {
                    const result = await handlerService.handleAgentGetConfig({
                        agentName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // ---------------------------------------------------------------
            // Config
            // ---------------------------------------------------------------

            // GET /api/v1/config
            if (method === 'GET' && pathname === '/api/v1/config') {
                const result = await handlerService.handleConfigGetAll({});
                sendJson(res, 200, result);
                return;
            }

            // GET /api/v1/config/:key
            {
                const match = matchRoute('/api/v1/config/:key', pathname);
                if (method === 'GET' && match) {
                    const result = await handlerService.handleConfigGet({
                        key: match.params.key,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // PUT /api/v1/config/:key
            {
                const match = matchRoute('/api/v1/config/:key', pathname);
                if (method === 'PUT' && match) {
                    const body = await readJsonBody(req);
                    const result = await handlerService.handleConfigSet({
                        key: match.params.key,
                        value: body.value,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // ---------------------------------------------------------------
            // Git
            // ---------------------------------------------------------------

            // GET /api/v1/git/branches
            if (method === 'GET' && pathname === '/api/v1/git/branches') {
                const result = await handlerService.handleGitListBranches({
                    includeRemote: parseBooleanParam(queryParams['includeRemote']),
                });
                sendJson(res, 200, result);
                return;
            }

            // POST /api/v1/git/repair
            if (method === 'POST' && pathname === '/api/v1/git/repair') {
                const body = await readJsonBody(req);
                const result = await handlerService.handleGitRepairWorktrees(body);
                sendJson(res, 200, result);
                return;
            }

            // ---------------------------------------------------------------
            // Workflows
            // ---------------------------------------------------------------

            // POST /api/v1/workflows/validate  (must be checked before /workflows POST)
            if (method === 'POST' && pathname === '/api/v1/workflows/validate') {
                const body = await readJsonBody(req);
                const result = await handlerService.handleWorkflowValidate(body);
                sendJson(res, 200, result);
                return;
            }

            // GET /api/v1/workflows
            if (method === 'GET' && pathname === '/api/v1/workflows') {
                const params: Record<string, unknown> = {};
                if (queryParams['includeBuiltin'] !== undefined) {
                    params.includeBuiltin = parseBooleanParam(queryParams['includeBuiltin']);
                }
                if (queryParams['includeCustom'] !== undefined) {
                    params.includeCustom = parseBooleanParam(queryParams['includeCustom']);
                }
                const result = await handlerService.handleWorkflowList(params);
                sendJson(res, 200, result);
                return;
            }

            // POST /api/v1/workflows
            if (method === 'POST' && pathname === '/api/v1/workflows') {
                const body = await readJsonBody(req);
                const result = await handlerService.handleWorkflowCreate(body);
                sendJson(res, 200, result);
                return;
            }

            // ---------------------------------------------------------------
            // Terminals
            // ---------------------------------------------------------------

            // GET /api/v1/terminals
            if (method === 'GET' && pathname === '/api/v1/terminals') {
                const params: Record<string, unknown> = {};
                if (queryParams['sessionName']) {
                    params['sessionName'] = queryParams['sessionName'];
                }
                const result = await handlerService.handleTerminalList(params);
                sendJson(res, 200, result);
                return;
            }

            // POST /api/v1/terminals
            if (method === 'POST' && pathname === '/api/v1/terminals') {
                const body = await readJsonBody(req);
                const result = await handlerService.handleTerminalCreate(body);
                sendJson(res, 200, result);
                return;
            }

            // POST /api/v1/terminals/:name/send
            {
                const match = matchRoute('/api/v1/terminals/:name/send', pathname);
                if (method === 'POST' && match) {
                    const body = await readJsonBody(req);
                    const result = await handlerService.handleTerminalSend({
                        ...body,
                        terminalName: match.params.name,
                    });
                    sendJson(res, 200, result);
                    return;
                }
            }

            // ---------------------------------------------------------------
            // No route matched
            // ---------------------------------------------------------------
            sendJson(res, 404, { error: 'Not Found' });
        } catch (err) {
            sendError(res, err);
        }
    };
}
