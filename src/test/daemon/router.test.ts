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
 */

import * as assert from 'assert';
import * as http from 'http';
import sinon from 'sinon';
import { createRouter } from '../../daemon/router';
import { JsonRpcHandlerError } from '../../core/services/SessionHandlerService';

// ---------------------------------------------------------------------------
// Helper: minimal fake SessionHandlerService
// ---------------------------------------------------------------------------

function makeHandlerService() {
    return {
        handleSessionList: sinon.stub().resolves({ sessions: [] }),
        handleSessionCreate: sinon.stub().resolves({ sessionName: 'new-session' }),
        handleSessionDelete: sinon.stub().resolves({ success: true }),
        handleSessionGetStatus: sinon.stub().resolves({ status: 'idle' }),
        handleSessionOpen: sinon.stub().resolves({ success: true }),
        handleSessionClear: sinon.stub().resolves({ success: true }),
        handleSessionPin: sinon.stub().resolves({ success: true }),
        handleSessionUnpin: sinon.stub().resolves({ success: true }),
        handleAgentList: sinon.stub().resolves({ agents: [] }),
        handleAgentGetConfig: sinon.stub().resolves({ config: null }),
        handleConfigGet: sinon.stub().resolves({ value: 'claude' }),
        handleConfigSet: sinon.stub().resolves({ success: true }),
        handleConfigGetAll: sinon.stub().resolves({ config: {} }),
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
                path,
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

suite('daemon router', () => {
    let handlerService: ReturnType<typeof makeHandlerService>;
    let notificationEmitter: ReturnType<typeof makeNotificationEmitter>;
    let server: http.Server;

    setup((done) => {
        handlerService = makeHandlerService();
        notificationEmitter = makeNotificationEmitter();

        const handler = createRouter(
            handlerService as never,
            notificationEmitter as never,
            AUTH_TOKEN
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

    test('Given GET /api/v1/config/lanes.defaultAgent with valid auth, when called, then it delegates to handleConfigGet with { key: "lanes.defaultAgent" }', async () => {
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
                path: '/api/v1/events',
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
                    path: '/api/v1/sessions',
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
});
