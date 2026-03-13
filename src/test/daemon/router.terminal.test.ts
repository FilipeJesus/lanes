/**
 * Tests for daemon HTTP router — terminal I/O endpoints.
 *
 * Covers:
 *  - GET /api/v1/terminals/:name/output — returns 200 with { content, rows, cols } with valid auth
 *  - GET /api/v1/terminals/:name/output — returns 401 without auth
 *  - POST /api/v1/terminals/:name/resize — returns 200 with { success: true } with valid auth
 *  - POST /api/v1/terminals/:name/resize — returns 401 without auth
 *  - GET /api/v1/terminals/:name/stream — returns Content-Type: text/event-stream with valid auth
 *  - GET /api/v1/terminals/:name/stream — returns 401 without auth
 */

import * as assert from 'assert';
import * as http from 'http';
import sinon from 'sinon';
import { createRouter } from '../../daemon/router';

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
        handleSessionOpen: sinon.stub().resolves({
            success: true,
            worktreePath: '/test/workspace/.worktrees/new-session',
            command: 'lanes open new-session',
            terminalMode: 'vscode',
        }),
        handleSessionClear: sinon.stub().resolves({ success: true }),
        handleSessionPin: sinon.stub().resolves({ success: true }),
        handleSessionUnpin: sinon.stub().resolves({ success: true }),
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
        handleTerminalOutput: sinon.stub().resolves({ content: 'hello\n', rows: 24, cols: 80 }),
        handleTerminalResize: sinon.stub().resolves({ success: true }),
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
            path.startsWith('/api/v1/') && path !== '/api/v1/health'
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
// Helper: make a request that aborts immediately (for SSE endpoints)
// ---------------------------------------------------------------------------

function makeRequestAndAbort(
    server: http.Server,
    options: RequestOptions = {}
): Promise<TestResponse> {
    return new Promise((resolve, reject) => {
        const address = server.address() as { port: number };
        const { method = 'GET', path = '/', headers = {} } = options;
        const requestPath =
            path.startsWith('/api/v1/') && path !== '/api/v1/health'
                ? `/api/v1/projects/${PROJECT_ID}${path.slice('/api/v1'.length)}`
                : path;

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: address.port,
                method,
                path: requestPath,
                headers,
            },
            (res) => {
                // Collect just the headers and first chunk, then abort
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    // Destroy after getting the first chunk
                    req.destroy();
                });
                res.on('close', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body: rawBody,
                        rawBody,
                    });
                });
                res.on('error', () => {
                    const rawBody = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body: rawBody,
                        rawBody,
                    });
                });
            }
        );

        req.on('error', (err) => {
            // Socket was deliberately destroyed — that's expected
            if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
                resolve({ status: 0, headers: {}, body: '', rawBody: '' });
            } else {
                reject(err);
            }
        });

        req.end();
    });
}

// ---------------------------------------------------------------------------
// Suite constants
// ---------------------------------------------------------------------------

const AUTH_TOKEN = 'test-secret-token-terminal-xyz';
const BEARER = `Bearer ${AUTH_TOKEN}`;
const PROJECT_ID = 'project-test-terminal';

// ---------------------------------------------------------------------------
// Suite: router - GET /api/v1/terminals/:name/output
// ---------------------------------------------------------------------------

suite('router - GET /api/v1/terminals/:name/output', () => {
    let handlerService: ReturnType<typeof makeHandlerService>;
    let notificationEmitter: ReturnType<typeof makeNotificationEmitter>;
    let server: http.Server;

    setup((done) => {
        handlerService = makeHandlerService();
        notificationEmitter = makeNotificationEmitter();

        const handler = createRouter(
            {
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
            } as never,
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

    test('Given a valid terminal name and auth, when GET /api/v1/terminals/:name/output is called, then it returns 200 with { content, rows, cols }', async () => {
        // Arrange
        handlerService.handleTerminalOutput.resolves({ content: 'hello world\n', rows: 24, cols: 80 });

        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/terminals/my-terminal/output',
            headers: { Authorization: BEARER },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalOutput.calledOnce, 'handleTerminalOutput should be called once');

        const body = res.body as { content: string; rows: number; cols: number };
        assert.strictEqual(body.content, 'hello world\n');
        assert.strictEqual(body.rows, 24);
        assert.strictEqual(body.cols, 80);

        // Verify the name was extracted from the URL
        const calledWith = handlerService.handleTerminalOutput.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.name, 'my-terminal');
    });

    test('Given no auth, when GET /api/v1/terminals/:name/output is called, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/terminals/my-terminal/output',
        });

        // Assert
        assert.strictEqual(res.status, 401);
        assert.ok(
            handlerService.handleTerminalOutput.notCalled,
            'handleTerminalOutput should NOT be called when auth is missing'
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: router - POST /api/v1/terminals/:name/resize
// ---------------------------------------------------------------------------

suite('router - POST /api/v1/terminals/:name/resize', () => {
    let handlerService: ReturnType<typeof makeHandlerService>;
    let notificationEmitter: ReturnType<typeof makeNotificationEmitter>;
    let server: http.Server;

    setup((done) => {
        handlerService = makeHandlerService();
        notificationEmitter = makeNotificationEmitter();

        const handler = createRouter(
            {
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
            } as never,
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

    test('Given a valid terminal name, cols, rows, and auth, when POST /api/v1/terminals/:name/resize is called, then it returns 200 with { success: true }', async () => {
        // Arrange
        handlerService.handleTerminalResize.resolves({ success: true });

        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/terminals/my-terminal/resize',
            headers: { Authorization: BEARER },
            body: { cols: 120, rows: 40 },
        });

        // Assert
        assert.strictEqual(res.status, 200);
        assert.ok(handlerService.handleTerminalResize.calledOnce, 'handleTerminalResize should be called once');

        const body = res.body as { success: boolean };
        assert.strictEqual(body.success, true);

        // Verify the name, cols, and rows were passed correctly
        const calledWith = handlerService.handleTerminalResize.firstCall.args[0] as Record<string, unknown>;
        assert.strictEqual(calledWith.name, 'my-terminal');
        assert.strictEqual(calledWith.cols, 120);
        assert.strictEqual(calledWith.rows, 40);
    });

    test('Given no auth, when POST /api/v1/terminals/:name/resize is called, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            method: 'POST',
            path: '/api/v1/terminals/my-terminal/resize',
            body: { cols: 80, rows: 24 },
        });

        // Assert
        assert.strictEqual(res.status, 401);
        assert.ok(
            handlerService.handleTerminalResize.notCalled,
            'handleTerminalResize should NOT be called when auth is missing'
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: router - GET /api/v1/terminals/:name/stream
// ---------------------------------------------------------------------------

suite('router - GET /api/v1/terminals/:name/stream', () => {
    let handlerService: ReturnType<typeof makeHandlerService>;
    let notificationEmitter: ReturnType<typeof makeNotificationEmitter>;
    let server: http.Server;

    setup((done) => {
        handlerService = makeHandlerService();
        notificationEmitter = makeNotificationEmitter();

        // Make handleTerminalOutput resolve so the SSE poll doesn't error
        handlerService.handleTerminalOutput.resolves({ content: 'stream content\n', rows: 24, cols: 80 });

        const handler = createRouter(
            {
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
            } as never,
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

    test('Given a valid terminal name and auth, when GET /api/v1/terminals/:name/stream is called, then it returns Content-Type: text/event-stream', (done) => {
        const address = server.address() as { port: number };

        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: address.port,
                method: 'GET',
                path: `/api/v1/projects/${PROJECT_ID}/terminals/my-terminal/stream`,
                headers: { Authorization: BEARER },
            },
            (res) => {
                // Assert response headers immediately
                assert.strictEqual(res.statusCode, 200);
                const contentType = res.headers['content-type'];
                assert.ok(
                    contentType !== undefined && contentType.includes('text/event-stream'),
                    `Expected Content-Type: text/event-stream, got: ${contentType}`
                );

                // Destroy the connection to avoid hanging
                req.destroy();
                done();
            }
        );

        req.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ECONNRESET') {
                // Expected: we destroyed the socket
                done();
            } else {
                done(err);
            }
        });

        req.end();
    });

    test('Given no auth, when GET /api/v1/terminals/:name/stream is called, then it returns 401', async () => {
        // Act
        const res = await makeRequest(server, {
            path: '/api/v1/terminals/my-terminal/stream',
        });

        // Assert
        assert.strictEqual(res.status, 401);
    });
});
