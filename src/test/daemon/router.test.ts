/**
 * Tests for the daemon HTTP router (createRouter).
 *
 * Uses a real Node.js HTTP server so the router is exercised end-to-end,
 * including JSON body parsing, auth middleware, CORS headers, and error mapping.
 *
 * Covers:
 *  - Health endpoint returns 200 without auth
 *  - Auth middleware rejects requests with missing/invalid tokens
 *  - Auth middleware passes valid Bearer tokens
 *  - Session list, create, delete, and status endpoints delegate correctly
 *  - Error mapping: -32602 → 400, -32601 → 404, generic Error → 500
 *  - Unknown routes return 404
 *  - CORS headers are present on all responses
 *  - Config get/set endpoints delegate correctly
 *  - SSE /api/v1/events sets correct headers and calls addClient
 *  - Git branches, repair, diff, diff/files, worktree, workflow, insights endpoints
 *  - Workflow list, validate, create endpoints
 *  - Terminal create, send, list endpoints
 *  - parseQueryString helper (tested indirectly via route tests)
 *  - Discovery endpoint: returns expected shape with auth, 401 without auth, null gitRemote on error
 */

import * as assert from 'assert';
import * as http from 'http';
import * as path from 'path';
import sinon from 'sinon';
import { createRouter } from '../../daemon/router';
import { JsonRpcHandlerError } from '../../core/services/SessionHandlerService';
import * as gitService from '../../core/gitService';

// ---------------------------------------------------------------------------
// Helper: minimal fake SessionHandlerService
// ---------------------------------------------------------------------------

function makeHandlerService() {
    return {
        handleSessionList: sinon.stub().resolves({ sessions: [] }),
        handleSessionCreate: sinon.stub().resolves({
            sessionName: 'new-session',
            sessionId: 'session-123',
            worktreePath: '/test/workspace/.worktrees/new-session',
            command: 'lanes open new-session',
            terminalMode: 'vscode',
        }),
        handleSessionDelete: sinon.stub().resolves({ success: true }),
        handleSessionGetStatus: sinon.stub().resolves({ status: 'idle', workflowStatus: null }),
        handleSessionSetupHooks: sinon.stub().resolves({
            settingsPath: '/test/workspace/.lanes/current-sessions/new-session/claude-settings.json',
        }),
        handleSessionOpen: sinon.stub().resolves({
            success: true,
            worktreePath: '/test/workspace/.worktrees/new-session',
            command: 'lanes open new-session',
            terminalMode: 'vscode',
        }),
        handleSessionClear: sinon.stub().resolves({ success: true }),
        handleSessionPin: sinon.stub().resolves({ success: true }),
        handleSessionUnpin: sinon.stub().resolves({ success: true }),
        handleSessionEnableNotifications: sinon.stub().resolves({ success: true }),
        handleSessionDisableNotifications: sinon.stub().resolves({ success: true }),
        handleSessionFormPromptImprove: sinon.stub().resolves({ improvedPrompt: 'Better prompt' }),
        handleSessionFormAttachmentUpload: sinon.stub().resolves({ files: [] }),
        handleAgentList: sinon.stub().resolves({ agents: [] }),
        handleAgentGetConfig: sinon.stub().resolves({ config: null }),
        handleConfigGet: sinon.stub().resolves({ value: 'claude' }),
        handleConfigSet: sinon.stub().resolves({ success: true }),
        handleConfigGetAll: sinon.stub().resolves({ config: {} }),
        handleGitListBranches: sinon.stub().resolves({ branches: [] }),
        handleGitRepairWorktrees: sinon.stub().resolves({ broken: [], repairResult: null }),
        handleGitGetDiff: sinon.stub().resolves({ diff: '', baseBranch: 'main' }),
        handleGitGetDiffFiles: sinon.stub().resolves({ files: [], baseBranch: 'main' }),
        handleGitGetWorktreeInfo: sinon.stub().resolves({ worktree: null }),
        handleWorkflowGetState: sinon.stub().resolves({ state: null }),
        handleSessionInsights: sinon.stub().resolves({ insights: '', analysis: null, sessionName: 'new-session' }),
        handleWorkflowList: sinon.stub().resolves({ workflows: [] }),
        handleWorkflowValidate: sinon.stub().resolves({ isValid: true, errors: [] }),
        handleWorkflowCreate: sinon.stub().resolves({ path: '/test/workspace/.lanes/workflows/new-workflow.yaml' }),
        handleTerminalCreate: sinon.stub().resolves({
            terminalName: 'term-1',
            attachCommand: 'tmux attach-session -t "term-1"',
        }),
        handleTerminalSend: sinon.stub().resolves({ success: true }),
        handleTerminalList: sinon.stub().resolves({ terminals: [] }),
    };
}

// ---------------------------------------------------------------------------
// Helper: minimal fake DaemonNotificationEmitter
// ---------------------------------------------------------------------------

function makeNotificationEmitter() {
    return {
        addClient: sinon.stub(),
        removeClient: sinon.stub(),
        getClientCount: sinon.stub().returns(0),
        sessionCreated: sinon.stub(),
        sessionDeleted: sinon.stub(),
        sessionStatusChanged: sinon.stub(),
        fileChanged: sinon.stub(),
    };
}

// ---------------------------------------------------------------------------
// Helper: make an HTTP request to a test server and collect the response
// ---------------------------------------------------------------------------

interface RequestOptions {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: unknown;
}

interface TestResponse {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: unknown;
    rawBody: string;
}

function makeRequest(
    server: http.Server,
    options: RequestOptions = {}
): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
        const address = server.address() as { port: number };
        const { method = 'GET', path = '/', headers = {}, body } = options;
        const requestPath =
            path.startsWith('/api/v1/')
            && path !== '/api/v1/health'
            && path !== '/api/v1/projects'
            && !path.startsWith('/api/v1/projects/')
                ? `/api/v1/projects/${PROJECT_ID}${path.slice('/api/v1'.length)}`
                : path;

        const payload = body !== undefined ? JSON.stringify(body) : undefined;
        const reqHeaders: Record<string, string> = { ...headers };
        if (payload !== undefined) {
            reqHeaders['Content-Type'] = 'application/json';
            reqHeaders['Content-Length'] = String(Buffer.byteLength(payload));
        }

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: address.port,
                method,
                path: requestPath,
                headers: reqHeaders,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf-8');
                    let parsedBody: unknown = rawBody;
                    try {
                        parsedBody = JSON.parse(rawBody);
                    } catch {
                        // leave as string
                    }
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body: parsedBody,
                        rawBody,
                    });
                });
                res.on('error', reject);
            }
        );

        req.on('error', reject);
        if (payload !== undefined) {
            req.write(payload);
        }
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

const AUTH_TOKEN = 'test-secret-token-abc123';
const BEARER = `Bearer ${AUTH_TOKEN}`;
const PROJECT_ID = 'project-test-1';

suite('daemon router', () => {
    let handlerService: ReturnType<typeof makeHandlerService>;
    let notificationEmitter: ReturnType<typeof makeNotificationEmitter>;
    let projectManager: {
        listProjects: sinon.SinonStub;
        getRuntime: sinon.SinonStub;
    };
    let server: http.Server;

    setup((done) => {
        handlerService = makeHandlerService();
        notificationEmitter = makeNotificationEmitter();
        projectManager = {
            listProjects: sinon.stub().resolves([]),
            getRuntime: sinon.stub().resolves({
                project: {
                    projectId: PROJECT_ID,
                    workspaceRoot: '/test/workspace',
                    projectName: 'workspace',
                    registeredAt: new Date().toISOString(),
                },
                startedAt: new Date().toISOString(),
                handlerService,
                notificationEmitter,
            }),
        };

        const handler = createRouter(
            projectManager as never,
            AUTH_TOKEN,
            { port: 0 }
        );
        server = http.createServer(handler);
        server.listen(0, '127.0.0.1', done);
    });

    teardown((done) => {
        sinon.restore();
        server.close(done);
    });

    // -------------------------------------------------------------------------
    // router-health-no-auth
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/health, when called without auth, then it returns 200 with { status: "ok" }', async () => {
        // Act
        const res = await makeRequest(server, { path: '/api/v1/health' });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual((res.body as { status: string }).status, 'ok');
    });

    // -------------------------------------------------------------------------
    // router-auth-missing-token
    // -------------------------------------------------------------------------

    test('Given a request with no Authorization header, when accessing a protected route, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, { path: '/api/v1/sessions' });

        // Assert
        assert.strictEqual(res.status, 401);
        assert.strictEqual((res.body as { error: string }).error, 'Unauthorized');
    });

    // -------------------------------------------------------------------------
    // router-auth-invalid-token
    // -------------------------------------------------------------------------

    test('Given a request with a wrong Bearer token, when accessing a protected route, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions',
            headers: { Authorization: 'Bearer wrong-token' },
        });

        // Assert
        assert.strictEqual(res.status, 401);
    });

    // -------------------------------------------------------------------------
    // router-auth-valid-token
    // -------------------------------------------------------------------------

    test('Given a request with a valid Bearer token, when accessing a protected route, then it succeeds with 200', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
    });

    test('Given GET /api/v1/projects with valid auth, when called, then it returns the registered project list without requiring a project-scoped route', async () => {
        const project = {
            projectId: PROJECT_ID,
            workspaceRoot: '/test/workspace',
            projectName: 'workspace',
            registeredAt: new Date().toISOString(),
        };
        projectManager.listProjects.resolves([project]);

        const res = await makeRequest(server, {
            path: '/api/v1/projects',
            headers: { Authorization: BEARER },
        });

        assert.strictEqual(res.status, 200);
        assert.ok(projectManager.listProjects.calledOnce, 'listProjects should be called once');
        assert.deepStrictEqual(res.body, {
            projects: [project],
        });
    });

    // -------------------------------------------------------------------------
    // router-session-list
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions with valid auth, when called, then it delegates to handleSessionList with empty params', async () => {
        // Arrange
        handlerService.handleSessionList.resolves({ sessions: [{ name: 'my-session' }] });

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionList.calledOnce, 'handleSessionList should be called once');
        assert.deepStrictEqual(handlerService.handleSessionList.firstCall.args[0], {});
    });

    // -------------------------------------------------------------------------
    // router-session-create
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/sessions with a JSON body, when called, then it delegates to handleSessionCreate with the parsed body', async () => {
        // Arrange
        const requestBody = { name: 'test-session', agent: 'claude' };

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/sessions',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionCreate.calledOnce, 'handleSessionCreate should be called once');
        const calledWith = handlerService.handleSessionCreate.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.name, 'test-session');
        assert.strictEqual(calledWith.agent, 'claude');
    });

    test('Given POST /api/v1/session-form/improve-prompt, when called, then it delegates to handleSessionFormPromptImprove with the parsed body', async () => {
        const requestBody = { prompt: 'improve me', agent: 'claude' };

        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/session-form/improve-prompt',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionFormPromptImprove.calledOnce);
        assert.deepStrictEqual(
            handlerService.handleSessionFormPromptImprove.firstCall.args[0],
            requestBody
        );
    });

    test('Given POST /api/v1/session-form/attachments, when called, then it delegates to handleSessionFormAttachmentUpload with the parsed body', async () => {
        const requestBody = { files: [{ name: 'notes.md', data: 'aGVsbG8=' }] };

        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/session-form/attachments',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionFormAttachmentUpload.calledOnce);
        assert.deepStrictEqual(
            handlerService.handleSessionFormAttachmentUpload.firstCall.args[0],
            requestBody
        );
    });

    test('Given POST /api/v1/session-form/attachments with a payload larger than the standard JSON cap, when called, then it still reaches the attachment handler', async () => {
        const largePayload = {
            files: [{ name: 'large.log', data: 'A'.repeat(2 * 1024 * 1024) }],
        };

        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/session-form/attachments',
            headers: { Authorization: BEARER },
            body: largePayload,
        });

        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionFormAttachmentUpload.calledOnce);
    });

    // -------------------------------------------------------------------------
    // router-session-delete
    // -------------------------------------------------------------------------

    test('Given DELETE /api/v1/sessions/test-session with valid auth, when called, then it delegates to handleSessionDelete with { sessionName: "test-session" }', async () => {
        // Act
        const res = await makeRequest(server, {
            method: 'DELETE',
            path: '/api/v1/sessions/test-session',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionDelete.calledOnce, 'handleSessionDelete should be called once');
        assert.deepStrictEqual(handlerService.handleSessionDelete.firstCall.args[0], {
            sessionName: 'test-session',
        });
    });

    // -------------------------------------------------------------------------
    // router-session-status
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions/test-session/status with valid auth, when called, then it delegates to handleSessionGetStatus with { sessionName: "test-session" }', async () => {
        // Arrange
        handlerService.handleSessionGetStatus.resolves({ status: 'working', workflowStatus: null });

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/test-session/status',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionGetStatus.calledOnce, 'handleSessionGetStatus should be called once');
        assert.deepStrictEqual(handlerService.handleSessionGetStatus.firstCall.args[0], {
            sessionName: 'test-session',
        });
    });

    test('Given POST /api/v1/sessions/test-session/hooks with valid auth, when called, then it delegates to handleSessionSetupHooks with { sessionName: "test-session" }', async () => {
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/sessions/test-session/hooks',
            headers: { Authorization: BEARER },
        });

        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionSetupHooks.calledOnce, 'handleSessionSetupHooks should be called once');
        assert.deepStrictEqual(handlerService.handleSessionSetupHooks.firstCall.args[0], {
            sessionName: 'test-session',
        });
    });

    test('Given POST /api/v1/sessions/test-session/notifications with valid auth, when called, then it delegates to handleSessionEnableNotifications with { sessionName: "test-session" }', async () => {
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/sessions/test-session/notifications',
            headers: { Authorization: BEARER },
        });

        assert.strictEqual(res.status, 200);
        assert.ok(
            handlerService.handleSessionEnableNotifications.calledOnce,
            'handleSessionEnableNotifications should be called once'
        );
        assert.deepStrictEqual(
            handlerService.handleSessionEnableNotifications.firstCall.args[0],
            { sessionName: 'test-session' }
        );
    });

    test('Given DELETE /api/v1/sessions/test-session/notifications with valid auth, when called, then it delegates to handleSessionDisableNotifications with { sessionName: "test-session" }', async () => {
        const res = await makeRequest(server, {
            method: 'DELETE',
            path: '/api/v1/sessions/test-session/notifications',
            headers: { Authorization: BEARER },
        });

        assert.strictEqual(res.status, 200);
        assert.ok(
            handlerService.handleSessionDisableNotifications.calledOnce,
            'handleSessionDisableNotifications should be called once'
        );
        assert.deepStrictEqual(
            handlerService.handleSessionDisableNotifications.firstCall.args[0],
            { sessionName: 'test-session' }
        );
    });

    // -------------------------------------------------------------------------
    // router-error-mapping-400
    // -------------------------------------------------------------------------

    test('Given a handler that throws JsonRpcHandlerError(-32602), when called, then the router returns 400', async () => {
        // Arrange
        handlerService.handleSessionList.rejects(
            new JsonRpcHandlerError(-32602, 'Invalid params')
        );

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 400);
        assert.strictEqual((res.body as { error: string }).error, 'Invalid params');
    });

    // -------------------------------------------------------------------------
    // router-error-mapping-404
    // -------------------------------------------------------------------------

    test('Given a handler that throws JsonRpcHandlerError(-32601), when called, then the router returns 404', async () => {
        // Arrange
        handlerService.handleSessionList.rejects(
            new JsonRpcHandlerError(-32601, 'Method not found')
        );

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 404);
        assert.strictEqual((res.body as { error: string }).error, 'Method not found');
    });

    // -------------------------------------------------------------------------
    // router-error-mapping-500
    // -------------------------------------------------------------------------

    test('Given a handler that throws a generic Error, when called, then the router returns 500', async () => {
        // Arrange
        handlerService.handleSessionList.rejects(new Error('Something went wrong'));

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 500);
        assert.strictEqual((res.body as { error: string }).error, 'Something went wrong');
    });

    // -------------------------------------------------------------------------
    // router-unknown-route
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/unknown with valid auth, when called, then the router returns 404', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/unknown',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 404);
        assert.strictEqual((res.body as { error: string }).error, 'Not Found');
    });

    // -------------------------------------------------------------------------
    // router-cors-headers
    // -------------------------------------------------------------------------

    test('Given any request, when the router responds, then Access-Control-Allow-Origin header is present', async () => {
        // Act: health check (no auth needed) is simplest
        const res = await makeRequest(server, { path: '/api/v1/health' });

        // Assert
        assert.ok(
            res.headers['access-control-allow-origin'],
            'Access-Control-Allow-Origin header should be present'
        );
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
    });

    // -------------------------------------------------------------------------
    // router-config-get
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/config/lanes.defaultAgent with valid auth, when called, then it delegates to handleConfigGet with key and scope', async () => {
        // Arrange
        handlerService.handleConfigGet.resolves({ value: 'claude' });

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/config/lanes.defaultAgent',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleConfigGet.calledOnce, 'handleConfigGet should be called once');
        assert.deepStrictEqual(handlerService.handleConfigGet.firstCall.args[0], {
            key: 'lanes.defaultAgent',
            scope: undefined,
        });
    });

    test('Given GET /api/v1/config/lanes.defaultAgent?scope=global with valid auth, when called, then it forwards the scope', async () => {
        handlerService.handleConfigGet.resolves({ value: 'claude', scope: 'global' });

        const res = await makeRequest(server, {
            path: '/api/v1/config/lanes.defaultAgent?scope=global',
            headers: { Authorization: BEARER },
        });

        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(handlerService.handleConfigGet.firstCall.args[0], {
            key: 'lanes.defaultAgent',
            scope: 'global',
        });
    });

    // -------------------------------------------------------------------------
    // router-config-set
    // -------------------------------------------------------------------------

    test('Given PUT /api/v1/config/lanes.defaultAgent with a body, when called, then it delegates to handleConfigSet with key and value', async () => {
        // Act
        const res = await makeRequest(server, {
            method: 'PUT',
            path: '/api/v1/config/lanes.defaultAgent',
            headers: { Authorization: BEARER },
            body: { value: 'codex' },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleConfigSet.calledOnce, 'handleConfigSet should be called once');
        const calledWith = handlerService.handleConfigSet.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.key, 'lanes.defaultAgent');
        assert.strictEqual(calledWith.value, 'codex');
        assert.strictEqual(calledWith.scope, undefined);
    });

    // -------------------------------------------------------------------------
    // router-sse-events
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/events with valid auth, when called, then the response has text/event-stream Content-Type and addClient is called', (done) => {
        // Arrange
        const address = server.address() as { port: number };

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: address.port,
                method: 'GET',
                path: `/api/v1/projects/${PROJECT_ID}/events`,
                headers: { Authorization: BEARER },
            },
            (res) => {
                // Assert headers
                assert.ok(
                    res.headers['content-type']?.includes('text/event-stream'),
                    `Content-Type should be text/event-stream, got: ${res.headers['content-type']}`
                );
                assert.ok(
                    notificationEmitter.addClient.calledOnce,
                    'addClient should be called once when SSE client connects'
                );
                req.destroy();
                done();
            }
        );
        req.on('error', () => {
            // Ignore connection errors from destroy()
        });
        req.end();
    });

    // -------------------------------------------------------------------------
    // router-malformed-json-body
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/sessions with malformed JSON body, when called, then the router returns 500 with error message', async () => {
        // Arrange — send raw invalid JSON via a manual request
        const address = server.address() as { port: number };
        const res = await new Promise<TestResponse>((resolve, reject) => {
            const payload = '{not valid json';
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: address.port,
                method: 'POST',
                path: `/api/v1/projects/${PROJECT_ID}/sessions`,
                headers: {
                    Authorization: BEARER,
                    'Content-Type': 'application/json',
                        'Content-Length': String(Buffer.byteLength(payload)),
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () => {
                        const rawBody = Buffer.concat(chunks).toString('utf-8');
                        let parsedBody: unknown = rawBody;
                        try { parsedBody = JSON.parse(rawBody); } catch { /* leave as string */ }
                        resolve({
                            status: res.statusCode ?? 0,
                            headers: res.headers,
                            body: parsedBody,
                            rawBody,
                        });
                    });
                    res.on('error', reject);
                }
            );
            req.on('error', reject);
            req.write(payload);
            req.end();
        });

        // Assert
        assert.strictEqual(res.status, 500);
        assert.strictEqual((res.body as { error: string }).error, 'Invalid JSON in request body');
    });

    // -------------------------------------------------------------------------
    // router-url-encoded-session-name
    // -------------------------------------------------------------------------

    test('Given DELETE /api/v1/sessions/my%20session with valid auth, when called, then it decodes the session name to "my session"', async () => {
        // Act
        const res = await makeRequest(server, {
            method: 'DELETE',
            path: '/api/v1/sessions/my%20session',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionDelete.calledOnce, 'handleSessionDelete should be called once');
        assert.deepStrictEqual(handlerService.handleSessionDelete.firstCall.args[0], {
            sessionName: 'my session',
        });
    });

    // -------------------------------------------------------------------------
    // router-options-preflight
    // -------------------------------------------------------------------------

    test('Given OPTIONS request, when sent without auth, then it returns 204 with CORS headers', async () => {
        // Arrange
        const address = server.address() as { port: number };
        const res = await new Promise<TestResponse>((resolve, reject) => {
            const req = http.request(
                {
                    hostname: '127.0.0.1',
                    port: address.port,
                    method: 'OPTIONS',
                    path: '/api/v1/sessions',
                },
                (httpRes) => {
                    const chunks: Buffer[] = [];
                    httpRes.on('data', (chunk: Buffer) => chunks.push(chunk));
                    httpRes.on('end', () => {
                        resolve({
                            status: httpRes.statusCode ?? 0,
                            headers: httpRes.headers,
                            body: null,
                            rawBody: Buffer.concat(chunks).toString('utf-8'),
                        });
                    });
                    httpRes.on('error', reject);
                }
            );
            req.on('error', reject);
            req.end();
        });

        // Assert
        assert.strictEqual(res.status, 204);
        assert.strictEqual(res.headers['access-control-allow-origin'], '*');
        assert.ok(
            res.headers['access-control-allow-methods']?.includes('POST'),
            'Should include POST in allowed methods'
        );
    });

    // -------------------------------------------------------------------------
    // router-get-git-branches
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/git/branches without query params, when called with valid auth, then it calls handleGitListBranches with { includeRemote: false }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/git/branches',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitListBranches.calledOnce, 'handleGitListBranches should be called once');
        assert.deepStrictEqual(handlerService.handleGitListBranches.firstCall.args[0], {
            includeRemote: false,
        });
    });

    test('Given GET /api/v1/git/branches?includeRemote=true, when called with valid auth, then it calls handleGitListBranches with { includeRemote: true }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/git/branches?includeRemote=true',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitListBranches.calledOnce, 'handleGitListBranches should be called once');
        assert.deepStrictEqual(handlerService.handleGitListBranches.firstCall.args[0], {
            includeRemote: true,
        });
    });

    test('Given GET /api/v1/git/branches with no auth, when called, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/git/branches',
        });

        // Assert
        assert.strictEqual(res.status, 401);
    });

    // -------------------------------------------------------------------------
    // router-post-git-repair
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/git/repair with empty body, when called with valid auth, then it calls handleGitRepairWorktrees with {}', async () => {
        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/git/repair',
            headers: { Authorization: BEARER },
            body: {},
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitRepairWorktrees.calledOnce, 'handleGitRepairWorktrees should be called once');
        assert.deepStrictEqual(handlerService.handleGitRepairWorktrees.firstCall.args[0], {});
    });

    test('Given POST /api/v1/git/repair with body { detectOnly: true }, when called with valid auth, then it calls handleGitRepairWorktrees with { detectOnly: true }', async () => {
        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/git/repair',
            headers: { Authorization: BEARER },
            body: { detectOnly: true },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitRepairWorktrees.calledOnce, 'handleGitRepairWorktrees should be called once');
        const calledWith = handlerService.handleGitRepairWorktrees.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.detectOnly, true);
    });

    // -------------------------------------------------------------------------
    // router-get-session-diff
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions/my-session/diff without query params, when called with valid auth, then it calls handleGitGetDiff with { sessionName: "my-session" } (no includeUncommitted so handler defaults apply)', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/diff',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitGetDiff.calledOnce, 'handleGitGetDiff should be called once');
        assert.deepStrictEqual(handlerService.handleGitGetDiff.firstCall.args[0], {
            sessionName: 'my-session',
        });
    });

    test('Given GET /api/v1/sessions/my-session/diff?includeUncommitted=true, when called with valid auth, then it calls handleGitGetDiff with { sessionName: "my-session", includeUncommitted: true }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/diff?includeUncommitted=true',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitGetDiff.calledOnce, 'handleGitGetDiff should be called once');
        assert.deepStrictEqual(handlerService.handleGitGetDiff.firstCall.args[0], {
            sessionName: 'my-session',
            includeUncommitted: true,
        });
    });

    // -------------------------------------------------------------------------
    // router-get-session-diff-files
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions/my-session/diff/files without query params, when called with valid auth, then it calls handleGitGetDiffFiles with { sessionName: "my-session" } (no includeUncommitted so handler defaults apply)', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/diff/files',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitGetDiffFiles.calledOnce, 'handleGitGetDiffFiles should be called once');
        assert.deepStrictEqual(handlerService.handleGitGetDiffFiles.firstCall.args[0], {
            sessionName: 'my-session',
        });
    });

    test('Given GET /api/v1/sessions/my-session/diff/files?includeUncommitted=true, when called with valid auth, then it calls handleGitGetDiffFiles with { sessionName: "my-session", includeUncommitted: true }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/diff/files?includeUncommitted=true',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitGetDiffFiles.calledOnce, 'handleGitGetDiffFiles should be called once');
        assert.deepStrictEqual(handlerService.handleGitGetDiffFiles.firstCall.args[0], {
            sessionName: 'my-session',
            includeUncommitted: true,
        });
    });

    // -------------------------------------------------------------------------
    // router-get-session-worktree
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions/my-session/worktree, when called with valid auth, then it calls handleGitGetWorktreeInfo with { sessionName: "my-session" }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/worktree',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitGetWorktreeInfo.calledOnce, 'handleGitGetWorktreeInfo should be called once');
        assert.deepStrictEqual(handlerService.handleGitGetWorktreeInfo.firstCall.args[0], {
            sessionName: 'my-session',
        });
    });

    // -------------------------------------------------------------------------
    // router-get-session-workflow
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions/my-session/workflow, when called with valid auth, then it calls handleWorkflowGetState with { sessionName: "my-session" }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/workflow',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleWorkflowGetState.calledOnce, 'handleWorkflowGetState should be called once');
        assert.deepStrictEqual(handlerService.handleWorkflowGetState.firstCall.args[0], {
            sessionName: 'my-session',
        });
    });

    // -------------------------------------------------------------------------
    // router-get-session-insights
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/sessions/my-session/insights without query params, when called with valid auth, then it calls handleSessionInsights with { sessionName: "my-session", includeAnalysis: true }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/insights',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionInsights.calledOnce, 'handleSessionInsights should be called once');
        assert.deepStrictEqual(handlerService.handleSessionInsights.firstCall.args[0], {
            sessionName: 'my-session',
            includeAnalysis: true,
        });
    });

    test('Given GET /api/v1/sessions/my-session/insights?includeAnalysis=false, when called with valid auth, then it calls handleSessionInsights with { sessionName: "my-session", includeAnalysis: false }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/sessions/my-session/insights?includeAnalysis=false',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleSessionInsights.calledOnce, 'handleSessionInsights should be called once');
        assert.deepStrictEqual(handlerService.handleSessionInsights.firstCall.args[0], {
            sessionName: 'my-session',
            includeAnalysis: false,
        });
    });

    // -------------------------------------------------------------------------
    // router-get-workflows
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/workflows without query params, when called with valid auth, then it calls handleWorkflowList with {} (no params so handler defaults apply)', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/workflows',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleWorkflowList.calledOnce, 'handleWorkflowList should be called once');
        assert.deepStrictEqual(handlerService.handleWorkflowList.firstCall.args[0], {});
    });

    test('Given GET /api/v1/workflows?includeBuiltin=true&includeCustom=true, when called with valid auth, then it calls handleWorkflowList with { includeBuiltin: true, includeCustom: true }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/workflows?includeBuiltin=true&includeCustom=true',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleWorkflowList.calledOnce, 'handleWorkflowList should be called once');
        assert.deepStrictEqual(handlerService.handleWorkflowList.firstCall.args[0], {
            includeBuiltin: true,
            includeCustom: true,
        });
    });

    // -------------------------------------------------------------------------
    // router-post-workflows-validate
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/workflows/validate with body { workflowPath: "/some/path.yaml" }, when called with valid auth, then it calls handleWorkflowValidate with the body', async () => {
        // Arrange
        const requestBody = { workflowPath: '/some/path.yaml' };

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/workflows/validate',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleWorkflowValidate.calledOnce, 'handleWorkflowValidate should be called once');
        const calledWith = handlerService.handleWorkflowValidate.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.workflowPath, '/some/path.yaml');
    });

    // -------------------------------------------------------------------------
    // router-post-workflows-create
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/workflows with body { name: "my-workflow", content: "steps: []" }, when called with valid auth, then it calls handleWorkflowCreate with the body', async () => {
        // Arrange
        const requestBody = { name: 'my-workflow', content: 'steps: []' };

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/workflows',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleWorkflowCreate.calledOnce, 'handleWorkflowCreate should be called once');
        const calledWith = handlerService.handleWorkflowCreate.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.name, 'my-workflow');
        assert.strictEqual(calledWith.content, 'steps: []');
    });

    // -------------------------------------------------------------------------
    // router-post-terminals-create
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/terminals with body { sessionName: "my-session" }, when called with valid auth, then it calls handleTerminalCreate with the body', async () => {
        // Arrange
        const requestBody = { sessionName: 'my-session' };

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/terminals',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalCreate.calledOnce, 'handleTerminalCreate should be called once');
        const calledWith = handlerService.handleTerminalCreate.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.sessionName, 'my-session');
    });

    test('Given POST /api/v1/terminals with body { sessionName: "my-session", command: "ls" }, when called with valid auth, then it calls handleTerminalCreate with sessionName and command', async () => {
        // Arrange
        const requestBody = { sessionName: 'my-session', command: 'ls' };

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/terminals',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalCreate.calledOnce, 'handleTerminalCreate should be called once');
        const calledWith = handlerService.handleTerminalCreate.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.sessionName, 'my-session');
        assert.strictEqual(calledWith.command, 'ls');
    });

    // -------------------------------------------------------------------------
    // router-post-terminals-send
    // -------------------------------------------------------------------------

    test('Given POST /api/v1/terminals/my-terminal/send with body { text: "hello" }, when called with valid auth, then it calls handleTerminalSend with { terminalName: "my-terminal", text: "hello" }', async () => {
        // Arrange
        const requestBody = { text: 'hello' };

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/terminals/my-terminal/send',
            headers: { Authorization: BEARER },
            body: requestBody,
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalSend.calledOnce, 'handleTerminalSend should be called once');
        const calledWith = handlerService.handleTerminalSend.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.terminalName, 'my-terminal');
        assert.strictEqual(calledWith.text, 'hello');
    });

    // -------------------------------------------------------------------------
    // router-get-terminals-list
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/terminals without query params, when called with valid auth, then it calls handleTerminalList with {}', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/terminals',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalList.calledOnce, 'handleTerminalList should be called once');
        assert.deepStrictEqual(handlerService.handleTerminalList.firstCall.args[0], {});
    });

    test('Given GET /api/v1/terminals?sessionName=my-session, when called with valid auth, then it calls handleTerminalList with { sessionName: "my-session" }', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/terminals?sessionName=my-session',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalList.calledOnce, 'handleTerminalList should be called once');
        assert.deepStrictEqual(handlerService.handleTerminalList.firstCall.args[0], {
            sessionName: 'my-session',
        });
    });

    // -------------------------------------------------------------------------
    // router-parse-query-string (tested indirectly via route tests)
    // -------------------------------------------------------------------------

    test('Given a URL with ?key=value query string, when the route handler is invoked, then the handler receives the parsed value', async () => {
        // Arrange: use the branches endpoint to exercise parseQueryString indirectly
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/git/branches?includeRemote=1',
            headers: { Authorization: BEARER },
        });

        // Assert: "1" should be treated as true by parseBooleanParam
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitListBranches.calledOnce);
        const calledWith = handlerService.handleGitListBranches.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.includeRemote, true);
    });

    test('Given a URL with no query string, when the route handler is invoked, then boolean params default to false', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/git/branches',
            headers: { Authorization: BEARER },
        });

        // Assert: absent query param should be treated as false
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleGitListBranches.calledOnce);
        const calledWith = handlerService.handleGitListBranches.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.includeRemote, false);
    });

    // -------------------------------------------------------------------------
    // router-discovery-endpoint
    // -------------------------------------------------------------------------

    test('Given GET /api/v1/discovery with valid auth and a known git remote, when called, then it returns the expected discovery shape', async () => {
        // Arrange
        const gitRemoteUrlWithCreds = 'https://alice:secret-token@github.com/example/test-workspace.git';
        const expectedSanitizedRemote = 'https://github.com/example/test-workspace.git';
        const execGitStub = sinon.stub(gitService, 'execGit').resolves(gitRemoteUrlWithCreds + '\n');
        handlerService.handleSessionList.resolves({ sessions: [{ name: 'session-a' }, { name: 'session-b' }] });

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/discovery',
            headers: { Authorization: BEARER },
        });

        // Assert
        execGitStub.restore();
        assert.strictEqual(res.status, 200);
        const body = res.body as Record<string, unknown>;
        assert.strictEqual(body.projectName, path.basename('/test/workspace'), 'projectName should be the workspace directory name');
        assert.strictEqual(body.gitRemote, expectedSanitizedRemote, 'gitRemote should be sanitized to remove embedded credentials');
        assert.strictEqual(body.sessionCount, 2, 'sessionCount should reflect the number of sessions');
        assert.strictEqual(typeof body.uptime, 'number', 'uptime should be a number');
        assert.ok((body.uptime as number) >= 0, 'uptime should be non-negative');
        assert.strictEqual(body.workspaceRoot, '/test/workspace', 'workspaceRoot should match the context workspaceRoot');
        assert.ok(typeof body.port === 'number', 'port should be a number');
        assert.strictEqual(body.apiVersion, '1', 'apiVersion should match the daemon API version');
    });

    test('Given GET /api/v1/discovery without an Authorization header, when called, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/discovery',
        });

        // Assert
        assert.strictEqual(res.status, 401);
        assert.strictEqual((res.body as { error: string }).error, 'Unauthorized');
    });

    test('Given GET /api/v1/discovery with a wrong Bearer token, when called, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/discovery',
            headers: { Authorization: 'Bearer wrong-token' },
        });

        // Assert
        assert.strictEqual(res.status, 401);
    });

    test('Given GET /api/v1/discovery when git remote is unavailable, when called, then gitRemote is null in the response', async () => {
        // Arrange: make execGit throw to simulate missing git remote
        const execGitStub = sinon.stub(gitService, 'execGit').rejects(new Error('fatal: No such remote: origin'));
        handlerService.handleSessionList.resolves({ sessions: [] });

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/discovery',
            headers: { Authorization: BEARER },
        });

        // Assert
        execGitStub.restore();
        assert.strictEqual(res.status, 200);
        const body = res.body as Record<string, unknown>;
        assert.strictEqual(body.gitRemote, null, 'gitRemote should be null when git remote lookup fails');
        assert.strictEqual(body.sessionCount, 0, 'sessionCount should be 0 when there are no sessions');
    });
});
