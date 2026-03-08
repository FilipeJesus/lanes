/**
 * Tests for DaemonClient — the typed HTTP client for the Lanes daemon REST API.
 *
 * Covers:
 *  - Constructor with port option
 *  - Constructor with baseUrl option (trailing slash stripped)
 *  - Constructor throws when neither port nor baseUrl is given
 *  - fromWorkspace() static factory reads daemon.port and daemon.token files
 *  - fromWorkspace() throws when port file is absent
 *  - health() sends GET /api/v1/health without Authorization header
 *  - All other methods include Authorization: Bearer <token>
 *  - listSessions() GET /api/v1/sessions
 *  - createSession() POST /api/v1/sessions with body
 *  - deleteSession() DELETE /api/v1/sessions/:name with URI encoding
 *  - getSessionStatus() GET /api/v1/sessions/:name/status
 *  - openSession() POST /api/v1/sessions/:name/open
 *  - clearSession() POST /api/v1/sessions/:name/clear
 *  - pinSession() POST /api/v1/sessions/:name/pin
 *  - unpinSession() DELETE /api/v1/sessions/:name/pin
 *  - getSessionInsights() with and without includeAnalysis query param
 *  - listBranches() with includeRemote query param
 *  - repairWorktrees() POST /api/v1/git/repair
 *  - getSessionDiff() with query param
 *  - getSessionDiffFiles() with query param
 *  - getWorktreeInfo()
 *  - listWorkflows() with query params
 *  - validateWorkflow()
 *  - createWorkflow()
 *  - getWorkflowState()
 *  - listAgents()
 *  - getAgentConfig() with URI encoding
 *  - getAllConfig()
 *  - getConfig() with URI encoding
 *  - setConfig() PUT with body
 *  - listTerminals() with optional sessionName query param
 *  - createTerminal()
 *  - sendToTerminal() with body
 *  - HTTP 400 → ValidationError
 *  - HTTP 401 → DaemonHttpError (statusCode 401)
 *  - HTTP 404 → DaemonHttpError (statusCode 404)
 *  - HTTP 500 → DaemonHttpError (statusCode 500)
 *  - HTTP error message extracted from JSON body { error: '...' }
 *  - HTTP error falls back to 'HTTP <statusCode>' when no error field
 *  - subscribeEvents() connects to /api/v1/events, fires onConnected
 *  - subscribeEvents() parses SSE events and calls the right callback
 *  - subscribeEvents() close() destroys the connection
 */

import * as assert from 'assert';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DaemonClient, DaemonHttpError } from '../../daemon/client';
import { ValidationError } from '../../core/errors/ValidationError';

// ---------------------------------------------------------------------------
// Helper: create a minimal HTTP server that records requests and returns a
// pre-configured response.
// ---------------------------------------------------------------------------

interface CapturedRequest {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
}

interface ServerResponse {
    status: number;
    body: unknown;
    /** Optional raw body (overrides body when set) */
    rawBody?: string;
    /** Extra headers to include */
    headers?: Record<string, string>;
}

function createTestServer(responseFactory: (req: CapturedRequest) => ServerResponse): {
    server: http.Server;
    captured: CapturedRequest[];
    close: () => Promise<void>;
    port: () => number;
} {
    const captured: CapturedRequest[] = [];

    const server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            const capturedReq: CapturedRequest = {
                method: req.method ?? 'GET',
                url: req.url ?? '/',
                headers: req.headers,
                body: Buffer.concat(chunks).toString('utf-8'),
            };
            captured.push(capturedReq);

            const response = responseFactory(capturedReq);

            const extraHeaders = response.headers ?? {};
            res.writeHead(response.status, {
                'Content-Type': 'application/json',
                ...extraHeaders,
            });

            if (response.rawBody !== undefined) {
                res.end(response.rawBody);
            } else {
                res.end(JSON.stringify(response.body));
            }
        });
    });

    return {
        server,
        captured,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve()))
            ),
        port: () => (server.address() as { port: number }).port,
    };
}

/** Start the server on a random port and return the helper. */
async function startTestServer(
    responseFactory: (req: CapturedRequest) => ServerResponse
): Promise<ReturnType<typeof createTestServer>> {
    const helper = createTestServer(responseFactory);
    await new Promise<void>((resolve) => helper.server.listen(0, '127.0.0.1', resolve));
    return helper;
}

// ---------------------------------------------------------------------------
// Helper: make a client pointing at the test server
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'test-bearer-token-xyz';

function makeClient(port: number): DaemonClient {
    return new DaemonClient({ port, token: TEST_TOKEN });
}

// ---------------------------------------------------------------------------
// Helper: decode a `?a=1&b=2` query string into an object
// ---------------------------------------------------------------------------

function parseQs(url: string): Record<string, string> {
    const idx = url.indexOf('?');
    if (idx === -1) {
        return {};
    }
    const qs = url.slice(idx + 1);
    const result: Record<string, string> = {};
    for (const part of qs.split('&')) {
        const [k, v] = part.split('=');
        result[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
    }
    return result;
}

// ---------------------------------------------------------------------------
// Suite: DaemonClient constructor
// ---------------------------------------------------------------------------

suite('DaemonClient', () => {
    // -------------------------------------------------------------------------
    // daemon-client-constructor-port
    // -------------------------------------------------------------------------

    test('Given port=3000 and token, when constructing DaemonClient, then the client makes requests to http://127.0.0.1:3000', async () => {
        // We verify this indirectly by connecting to a server on port 3000 range.
        const helper = await startTestServer(() => ({ status: 200, body: { status: 'ok', version: '1' } }));
        try {
            const client = new DaemonClient({ port: helper.port(), token: TEST_TOKEN });
            await client.health();
            assert.strictEqual(helper.captured.length, 1, 'One request should be made');
        } finally {
            await helper.close();
        }
    });

    // -------------------------------------------------------------------------
    // daemon-client-constructor-baseurl
    // -------------------------------------------------------------------------

    test('Given baseUrl with trailing slash, when constructing DaemonClient, then trailing slash is stripped from requests', async () => {
        const helper = await startTestServer(() => ({ status: 200, body: { status: 'ok', version: '1' } }));
        try {
            // The baseUrl points at our test server
            const client = new DaemonClient({
                baseUrl: `http://127.0.0.1:${helper.port()}/`,
                token: TEST_TOKEN,
            });
            await client.health();
            // URL should be /api/v1/health, not //api/v1/health
            assert.ok(
                helper.captured[0].url === '/api/v1/health',
                `Expected /api/v1/health but got ${helper.captured[0].url}`
            );
        } finally {
            await helper.close();
        }
    });

    test('Given neither port nor baseUrl, when constructing DaemonClient, then it throws', () => {
        assert.throws(
            () => new DaemonClient({ token: TEST_TOKEN } as never),
            /requires either baseUrl or port/i
        );
    });

    // -------------------------------------------------------------------------
    // daemon-client-from-workspace
    // -------------------------------------------------------------------------

    suite('fromWorkspace()', () => {
        let tempDir: string;

        setup(() => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-client-test-'));
        });

        teardown(() => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });

        test('Given daemon.port and daemon.token in .lanes/, when fromWorkspace is called, then DaemonClient is constructed', async () => {
            // Arrange
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(path.join(lanesDir, 'daemon.port'), '9876', 'utf-8');
            fs.writeFileSync(path.join(lanesDir, 'daemon.token'), 'workspace-token-abc', 'utf-8');

            // Act
            const client = await DaemonClient.fromWorkspace(tempDir);

            // Assert — client should be a DaemonClient instance
            assert.ok(client instanceof DaemonClient, 'fromWorkspace should return a DaemonClient');
        });

        test('Given no daemon.port file, when fromWorkspace is called, then it throws', async () => {
            // Arrange: only create the token file (no port file)
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(path.join(lanesDir, 'daemon.token'), 'some-token', 'utf-8');

            // Act & Assert
            let thrown: unknown;
            try {
                await DaemonClient.fromWorkspace(tempDir);
            } catch (err) {
                thrown = err;
            }
            assert.ok(thrown instanceof Error, 'fromWorkspace should throw when port file is absent');
            assert.ok(
                (thrown as Error).message.includes('Daemon port file not found'),
                'Error message should mention the port file'
            );
        });
    });

    // -------------------------------------------------------------------------
    // daemon-client-health
    // -------------------------------------------------------------------------

    suite('health()', () => {
        test('Given a mock server, when health() is called, then a GET request is sent to /api/v1/health', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: { status: 'ok', version: '1.0.0' },
            }));
            try {
                const client = makeClient(helper.port());
                await client.health();

                assert.strictEqual(helper.captured.length, 1);
                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/health');
            } finally {
                await helper.close();
            }
        });

        test('Given health() is called, then no Authorization header is included', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: { status: 'ok', version: '1.0.0' },
            }));
            try {
                const client = makeClient(helper.port());
                await client.health();

                assert.strictEqual(helper.captured[0].headers['authorization'], undefined);
            } finally {
                await helper.close();
            }
        });

        test('Given a 200 response, when health() resolves, then the result matches the response body', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: { status: 'ok', version: '2.1.0' },
            }));
            try {
                const client = makeClient(helper.port());
                const result = await client.health();

                assert.deepStrictEqual(result, { status: 'ok', version: '2.1.0' });
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // daemon-client-auth-header
    // -------------------------------------------------------------------------

    suite('Authorization header', () => {
        test('Given token="mytoken", when listSessions() is called, then Authorization: Bearer mytoken header is included', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { sessions: [] } }));
            try {
                const client = new DaemonClient({ port: helper.port(), token: 'mytoken' });
                await client.listSessions();

                assert.strictEqual(
                    helper.captured[0].headers['authorization'],
                    'Bearer mytoken'
                );
            } finally {
                await helper.close();
            }
        });

        test('Given a token, when discovery() is called, then Authorization header is present', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: {
                    projectName: 'test',
                    gitRemote: null,
                    sessionCount: 0,
                    uptime: 100,
                    workspaceRoot: '/tmp',
                    port: 1234,
                },
            }));
            try {
                const client = makeClient(helper.port());
                await client.discovery();

                assert.ok(
                    helper.captured[0].headers['authorization']?.startsWith('Bearer '),
                    'Authorization header should start with Bearer'
                );
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // daemon-client-list-sessions
    // -------------------------------------------------------------------------

    suite('listSessions()', () => {
        test('Given a mock server, when listSessions() is called, then GET /api/v1/sessions is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { sessions: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listSessions();

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions');
            } finally {
                await helper.close();
            }
        });

        test('Given a 200 response with session list, when listSessions() resolves, then the result matches the response body', async () => {
            const responseBody = { sessions: [{ name: 'feat-a' }, { name: 'feat-b' }] };
            const helper = await startTestServer(() => ({ status: 200, body: responseBody }));
            try {
                const client = makeClient(helper.port());
                const result = await client.listSessions();

                assert.deepStrictEqual(result, responseBody);
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // daemon-client-create-session
    // -------------------------------------------------------------------------

    suite('createSession()', () => {
        test('Given opts, when createSession() is called, then POST /api/v1/sessions is made with that body', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: { sessionName: 'test' },
            }));
            try {
                const client = makeClient(helper.port());
                const opts = { sessionName: 'test', agentName: 'claude' };
                await client.createSession(opts);

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions');
                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), opts);
            } finally {
                await helper.close();
            }
        });

        test('Given a 200 response, when createSession() resolves, then the result matches the response body', async () => {
            const responseBody = { sessionName: 'test', worktreePath: '/tmp/test' };
            const helper = await startTestServer(() => ({ status: 200, body: responseBody }));
            try {
                const client = makeClient(helper.port());
                const result = await client.createSession({ sessionName: 'test', agentName: 'claude' });

                assert.deepStrictEqual(result, responseBody);
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // daemon-client-delete-session
    // -------------------------------------------------------------------------

    suite('deleteSession()', () => {
        test('Given session name "my session", when deleteSession() is called, then DELETE /api/v1/sessions/my%20session is requested', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: { success: true },
            }));
            try {
                const client = makeClient(helper.port());
                await client.deleteSession('my session');

                assert.strictEqual(helper.captured[0].method, 'DELETE');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my%20session');
            } finally {
                await helper.close();
            }
        });

        test('Given a 200 response, when deleteSession() resolves, then the result matches the response body', async () => {
            const responseBody = { success: true };
            const helper = await startTestServer(() => ({ status: 200, body: responseBody }));
            try {
                const client = makeClient(helper.port());
                const result = await client.deleteSession('test-session');

                assert.deepStrictEqual(result, responseBody);
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Session-level endpoints
    // -------------------------------------------------------------------------

    suite('getSessionStatus()', () => {
        test('Given session name, when getSessionStatus() is called, then GET /api/v1/sessions/:name/status is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { status: 'idle' } }));
            try {
                const client = makeClient(helper.port());
                await client.getSessionStatus('my-session');

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my-session/status');
            } finally {
                await helper.close();
            }
        });
    });

    suite('openSession()', () => {
        test('Given session name, when openSession() is called, then POST /api/v1/sessions/:name/open is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.openSession('my-session');

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my-session/open');
            } finally {
                await helper.close();
            }
        });

        test('Given session name and opts, when openSession() is called, then opts are sent as body', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.openSession('my-session', { newWindow: true });

                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), { newWindow: true });
            } finally {
                await helper.close();
            }
        });
    });

    suite('clearSession()', () => {
        test('Given session name, when clearSession() is called, then POST /api/v1/sessions/:name/clear is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.clearSession('my-session');

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my-session/clear');
            } finally {
                await helper.close();
            }
        });
    });

    suite('pinSession() / unpinSession()', () => {
        test('Given session name, when pinSession() is called, then POST /api/v1/sessions/:name/pin is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.pinSession('my-session');

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my-session/pin');
            } finally {
                await helper.close();
            }
        });

        test('Given session name, when unpinSession() is called, then DELETE /api/v1/sessions/:name/pin is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.unpinSession('my-session');

                assert.strictEqual(helper.captured[0].method, 'DELETE');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my-session/pin');
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // daemon-client-session-insights
    // -------------------------------------------------------------------------

    suite('getSessionInsights()', () => {
        test('Given opts.includeAnalysis=false, when getSessionInsights() is called, then URL includes ?includeAnalysis=false', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { insights: null } }));
            try {
                const client = makeClient(helper.port());
                await client.getSessionInsights('my-session', { includeAnalysis: false });

                const qs = parseQs(helper.captured[0].url);
                assert.strictEqual(qs['includeAnalysis'], 'false');
            } finally {
                await helper.close();
            }
        });

        test('Given opts.includeAnalysis=true, when getSessionInsights() is called, then URL includes ?includeAnalysis=true', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { insights: null } }));
            try {
                const client = makeClient(helper.port());
                await client.getSessionInsights('my-session', { includeAnalysis: true });

                const qs = parseQs(helper.captured[0].url);
                assert.strictEqual(qs['includeAnalysis'], 'true');
            } finally {
                await helper.close();
            }
        });

        test('Given no opts, when getSessionInsights() is called, then URL does not include includeAnalysis query param', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { insights: null } }));
            try {
                const client = makeClient(helper.port());
                await client.getSessionInsights('my-session');

                assert.ok(
                    !helper.captured[0].url.includes('includeAnalysis'),
                    'URL should not include includeAnalysis when no opts given'
                );
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Git endpoints
    // -------------------------------------------------------------------------

    suite('listBranches()', () => {
        test('Given opts.includeRemote=true, when listBranches() is called, then URL includes ?includeRemote=true', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { branches: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listBranches({ includeRemote: true });

                const qs = parseQs(helper.captured[0].url);
                assert.strictEqual(qs['includeRemote'], 'true');
            } finally {
                await helper.close();
            }
        });

        test('Given no opts, when listBranches() is called, then GET /api/v1/git/branches is requested without query string', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { branches: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listBranches();

                assert.strictEqual(helper.captured[0].url, '/api/v1/git/branches');
            } finally {
                await helper.close();
            }
        });
    });

    suite('repairWorktrees()', () => {
        test('Given a call to repairWorktrees(), then POST /api/v1/git/repair is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { repaired: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.repairWorktrees();

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/git/repair');
            } finally {
                await helper.close();
            }
        });
    });

    suite('getSessionDiff()', () => {
        test('Given opts.includeUncommitted=true, when getSessionDiff() is called, then URL includes ?includeUncommitted=true', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { diff: '' } }));
            try {
                const client = makeClient(helper.port());
                await client.getSessionDiff('feat', { includeUncommitted: true });

                const qs = parseQs(helper.captured[0].url);
                assert.strictEqual(qs['includeUncommitted'], 'true');
            } finally {
                await helper.close();
            }
        });
    });

    suite('getSessionDiffFiles()', () => {
        test('Given a session name, when getSessionDiffFiles() is called, then GET /api/v1/sessions/:name/diff/files is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { files: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.getSessionDiffFiles('feat-session');

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.ok(helper.captured[0].url.startsWith('/api/v1/sessions/feat-session/diff/files'));
            } finally {
                await helper.close();
            }
        });
    });

    suite('getWorktreeInfo()', () => {
        test('Given a session name, when getWorktreeInfo() is called, then GET /api/v1/sessions/:name/worktree is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { path: '/tmp' } }));
            try {
                const client = makeClient(helper.port());
                await client.getWorktreeInfo('my-session');

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/my-session/worktree');
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Workflow endpoints
    // -------------------------------------------------------------------------

    suite('listWorkflows()', () => {
        test('Given opts with both flags, when listWorkflows() is called, then URL includes both query params', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { workflows: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listWorkflows({ includeBuiltin: true, includeCustom: false });

                const qs = parseQs(helper.captured[0].url);
                assert.strictEqual(qs['includeBuiltin'], 'true');
                assert.strictEqual(qs['includeCustom'], 'false');
            } finally {
                await helper.close();
            }
        });

        test('Given no opts, when listWorkflows() is called, then GET /api/v1/workflows is requested without query string', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { workflows: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listWorkflows();

                assert.strictEqual(helper.captured[0].url, '/api/v1/workflows');
            } finally {
                await helper.close();
            }
        });
    });

    suite('validateWorkflow()', () => {
        test('Given workflow content, when validateWorkflow() is called, then POST /api/v1/workflows/validate is made with body', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { valid: true } }));
            try {
                const client = makeClient(helper.port());
                const content = { name: 'my-workflow', steps: [] };
                await client.validateWorkflow(content);

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/workflows/validate');
                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), content);
            } finally {
                await helper.close();
            }
        });
    });

    suite('createWorkflow()', () => {
        test('Given name and content, when createWorkflow() is called, then POST /api/v1/workflows is made with { name, content }', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.createWorkflow('my-wf', { steps: ['a', 'b'] });

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/workflows');
                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), {
                    name: 'my-wf',
                    content: { steps: ['a', 'b'] },
                });
            } finally {
                await helper.close();
            }
        });
    });

    suite('getWorkflowState()', () => {
        test('Given session name, when getWorkflowState() is called, then GET /api/v1/sessions/:name/workflow is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { state: null } }));
            try {
                const client = makeClient(helper.port());
                await client.getWorkflowState('wf-session');

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/sessions/wf-session/workflow');
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Agent endpoints
    // -------------------------------------------------------------------------

    suite('listAgents()', () => {
        test('Given a call to listAgents(), then GET /api/v1/agents is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { agents: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listAgents();

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/agents');
            } finally {
                await helper.close();
            }
        });
    });

    suite('getAgentConfig()', () => {
        test('Given agent name with special chars, when getAgentConfig() is called, then name is URI-encoded in the URL', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { config: {} } }));
            try {
                const client = makeClient(helper.port());
                await client.getAgentConfig('claude code');

                assert.strictEqual(helper.captured[0].url, '/api/v1/agents/claude%20code');
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Config endpoints
    // -------------------------------------------------------------------------

    suite('getAllConfig()', () => {
        test('Given a call to getAllConfig(), then GET /api/v1/config is made', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { config: {} } }));
            try {
                const client = makeClient(helper.port());
                await client.getAllConfig();

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/config');
            } finally {
                await helper.close();
            }
        });
    });

    suite('getConfig()', () => {
        test('Given key with special chars, when getConfig() is called, then key is URI-encoded in the URL', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { value: 'claude' } }));
            try {
                const client = makeClient(helper.port());
                await client.getConfig('lanes.agent/name');

                assert.strictEqual(helper.captured[0].url, '/api/v1/config/lanes.agent%2Fname');
            } finally {
                await helper.close();
            }
        });
    });

    suite('setConfig()', () => {
        test('Given key and value, when setConfig() is called, then PUT /api/v1/config/:key is made with { value }', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.setConfig('agentName', 'claude');

                assert.strictEqual(helper.captured[0].method, 'PUT');
                assert.strictEqual(helper.captured[0].url, '/api/v1/config/agentName');
                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), { value: 'claude' });
            } finally {
                await helper.close();
            }
        });
    });

    // -------------------------------------------------------------------------
    // Terminal endpoints
    // -------------------------------------------------------------------------

    suite('listTerminals()', () => {
        test('Given no opts, when listTerminals() is called, then GET /api/v1/terminals is requested without query string', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { terminals: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listTerminals();

                assert.strictEqual(helper.captured[0].method, 'GET');
                assert.strictEqual(helper.captured[0].url, '/api/v1/terminals');
            } finally {
                await helper.close();
            }
        });

        test('Given opts.sessionName, when listTerminals() is called, then sessionName is URI-encoded in query string', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { terminals: [] } }));
            try {
                const client = makeClient(helper.port());
                await client.listTerminals({ sessionName: 'my session' });

                const qs = parseQs(helper.captured[0].url);
                assert.strictEqual(qs['sessionName'], 'my session');
            } finally {
                await helper.close();
            }
        });
    });

    suite('createTerminal()', () => {
        test('Given opts, when createTerminal() is called, then POST /api/v1/terminals is made with body', async () => {
            const helper = await startTestServer(() => ({
                status: 200,
                body: { terminalName: 'term-1' },
            }));
            try {
                const client = makeClient(helper.port());
                await client.createTerminal({ sessionName: 'feat', shell: 'bash' });

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/terminals');
                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), {
                    sessionName: 'feat',
                    shell: 'bash',
                });
            } finally {
                await helper.close();
            }
        });
    });

    suite('sendToTerminal()', () => {
        test('Given name and text, when sendToTerminal() is called, then POST /api/v1/terminals/:name/send is made with { command: text }', async () => {
            const helper = await startTestServer(() => ({ status: 200, body: { success: true } }));
            try {
                const client = makeClient(helper.port());
                await client.sendToTerminal('term-1', 'ls -la');

                assert.strictEqual(helper.captured[0].method, 'POST');
                assert.strictEqual(helper.captured[0].url, '/api/v1/terminals/term-1/send');
                assert.deepStrictEqual(JSON.parse(helper.captured[0].body), { command: 'ls -la' });
            } finally {
                await helper.close();
            }
        });
    });
});

// ---------------------------------------------------------------------------
// Suite: DaemonClient error handling
// ---------------------------------------------------------------------------

suite('DaemonClient error handling', () => {
    // -------------------------------------------------------------------------
    // daemon-client-error-400
    // -------------------------------------------------------------------------

    test('Given a 400 response with { error: "bad input" }, when any method is called, then a ValidationError is thrown with the server error message', async () => {
        const helper = await startTestServer(() => ({
            status: 400,
            body: { error: 'bad input' },
        }));
        try {
            const client = makeClient(helper.port());

            let thrown: unknown;
            try {
                await client.listSessions();
            } catch (err) {
                thrown = err;
            }

            assert.ok(thrown instanceof ValidationError, 'Should throw a ValidationError for 400');
            assert.ok(
                (thrown as ValidationError).message.includes('bad input'),
                'Error message should contain the server error message'
            );
        } finally {
            await helper.close();
        }
    });

    // -------------------------------------------------------------------------
    // daemon-client-error-401
    // -------------------------------------------------------------------------

    test('Given a 401 response, when any method is called, then a DaemonHttpError is thrown with statusCode 401', async () => {
        const helper = await startTestServer(() => ({
            status: 401,
            body: { error: 'Unauthorized' },
        }));
        try {
            const client = makeClient(helper.port());

            let thrown: unknown;
            try {
                await client.listSessions();
            } catch (err) {
                thrown = err;
            }

            assert.ok(thrown instanceof DaemonHttpError, 'Should throw a DaemonHttpError for 401');
            assert.strictEqual((thrown as DaemonHttpError).statusCode, 401);
            assert.ok(
                (thrown as DaemonHttpError).message.toLowerCase().includes('unauthorized'),
                'Error message should contain auth-related text'
            );
        } finally {
            await helper.close();
        }
    });

    // -------------------------------------------------------------------------
    // daemon-client-error-404
    // -------------------------------------------------------------------------

    test('Given a 404 response with { error: "not found" }, when any method is called, then a DaemonHttpError is thrown with statusCode 404', async () => {
        const helper = await startTestServer(() => ({
            status: 404,
            body: { error: 'not found' },
        }));
        try {
            const client = makeClient(helper.port());

            let thrown: unknown;
            try {
                await client.listSessions();
            } catch (err) {
                thrown = err;
            }

            assert.ok(thrown instanceof DaemonHttpError, 'Should throw a DaemonHttpError for 404');
            assert.strictEqual((thrown as DaemonHttpError).statusCode, 404);
        } finally {
            await helper.close();
        }
    });

    // -------------------------------------------------------------------------
    // daemon-client-error-500
    // -------------------------------------------------------------------------

    test('Given a 500 response with { error: "server error" }, when any method is called, then a DaemonHttpError is thrown with statusCode 500', async () => {
        const helper = await startTestServer(() => ({
            status: 500,
            body: { error: 'server error' },
        }));
        try {
            const client = makeClient(helper.port());

            let thrown: unknown;
            try {
                await client.listSessions();
            } catch (err) {
                thrown = err;
            }

            assert.ok(thrown instanceof DaemonHttpError, 'Should throw a DaemonHttpError for 500');
            assert.strictEqual((thrown as DaemonHttpError).statusCode, 500);
            assert.ok(
                (thrown as DaemonHttpError).message.includes('server error'),
                'Error message should contain the server error text'
            );
        } finally {
            await helper.close();
        }
    });

    test('Given a 503 response with no error field in body, when any method is called, then DaemonHttpError message falls back to "HTTP 503"', async () => {
        const helper = await startTestServer(() => ({
            status: 503,
            body: { message: 'service unavailable' }, // no "error" key
        }));
        try {
            const client = makeClient(helper.port());

            let thrown: unknown;
            try {
                await client.listSessions();
            } catch (err) {
                thrown = err;
            }

            assert.ok(thrown instanceof DaemonHttpError, 'Should throw DaemonHttpError');
            assert.ok(
                (thrown as DaemonHttpError).message.includes('HTTP 503'),
                `Expected "HTTP 503" in message but got: ${(thrown as DaemonHttpError).message}`
            );
        } finally {
            await helper.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Suite: DaemonClient SSE
// ---------------------------------------------------------------------------

suite('DaemonClient SSE', () => {
    // -------------------------------------------------------------------------
    // daemon-client-subscribe-events
    // -------------------------------------------------------------------------

    test('Given a mock SSE server, when subscribeEvents() is called, then a GET request to /api/v1/events is made', (done) => {
        // Create a minimal SSE server that closes immediately after receiving the request
        const server = http.createServer((req, res) => {
            if (req.url === '/api/v1/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive',
                });
                // Record and then end (simulating a quick disconnect)
                res.end();
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: TEST_TOKEN });

            let requestReceived = false;

            // Override our check using the server request event
            server.once('request', (req) => {
                requestReceived = true;
                assert.strictEqual(req.method, 'GET');
                assert.strictEqual(req.url, '/api/v1/events');
            });

            const sub = client.subscribeEvents({
                onConnected: () => {
                    // Close to avoid reconnect loops
                    sub.close();
                },
                onError: () => {
                    // After close, reconnect is suppressed
                },
            });

            // Allow time for the request to reach the server and be verified
            setTimeout(() => {
                sub.close();
                server.close(() => {
                    assert.ok(requestReceived, 'A request to /api/v1/events should have been made');
                    done();
                });
            }, 500);
        });
    });

    test('Given a subscribeEvents() call, when close() is called on the returned handle, then the connection is terminated', (done) => {
        // Server that keeps the SSE stream open
        const server = http.createServer((_req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            // Keep the connection open - we rely on close() to destroy it
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: TEST_TOKEN });

            const sub = client.subscribeEvents({});

            // Give the connection time to establish then close it
            setTimeout(() => {
                // close() should not throw
                assert.doesNotThrow(() => sub.close());

                server.close(done);
            }, 100);
        });
    });

    test('Given an SSE event "sessionStatusChanged", when the server emits it, then onSessionStatusChanged callback is called', (done) => {
        const eventData = { sessionName: 'feat-a', status: 'working' };

        const server = http.createServer((_req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            // Send a sessionStatusChanged event then end
            res.write(`event: sessionStatusChanged\ndata: ${JSON.stringify(eventData)}\n\n`);
            res.end();
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: TEST_TOKEN });

            let callbackCalled = false;

            const sub = client.subscribeEvents({
                onSessionStatusChanged: (data) => {
                    callbackCalled = true;
                    assert.deepStrictEqual(data, eventData);
                    sub.close();
                    server.close(done);
                },
                onError: () => {
                    // suppress reconnect errors after close
                },
            });

            // Timeout guard
            setTimeout(() => {
                if (!callbackCalled) {
                    sub.close();
                    server.close(() => {
                        done(new Error('onSessionStatusChanged was not called within timeout'));
                    });
                }
            }, 2000);
        });
    });

    test('Given an SSE event "sessionCreated", when the server emits it, then onSessionCreated callback is called', (done) => {
        const eventData = { sessionName: 'new-session', worktreePath: '/tmp/new-session' };

        const server = http.createServer((_req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            res.write(`event: sessionCreated\ndata: ${JSON.stringify(eventData)}\n\n`);
            res.end();
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: TEST_TOKEN });

            let callbackCalled = false;

            const sub = client.subscribeEvents({
                onSessionCreated: (data) => {
                    callbackCalled = true;
                    assert.deepStrictEqual(data, eventData);
                    sub.close();
                    server.close(done);
                },
                onError: () => {},
            });

            setTimeout(() => {
                if (!callbackCalled) {
                    sub.close();
                    server.close(() => {
                        done(new Error('onSessionCreated was not called within timeout'));
                    });
                }
            }, 2000);
        });
    });

    test('Given an SSE event "sessionDeleted", when the server emits it, then onSessionDeleted callback is called', (done) => {
        const eventData = { sessionName: 'old-session' };

        const server = http.createServer((_req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            res.write(`event: sessionDeleted\ndata: ${JSON.stringify(eventData)}\n\n`);
            res.end();
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: TEST_TOKEN });

            let callbackCalled = false;

            const sub = client.subscribeEvents({
                onSessionDeleted: (data) => {
                    callbackCalled = true;
                    assert.deepStrictEqual(data, eventData);
                    sub.close();
                    server.close(done);
                },
                onError: () => {},
            });

            setTimeout(() => {
                if (!callbackCalled) {
                    sub.close();
                    server.close(() => {
                        done(new Error('onSessionDeleted was not called within timeout'));
                    });
                }
            }, 2000);
        });
    });

    test('Given an SSE event "fileChanged", when the server emits it, then onFileChanged callback is called', (done) => {
        const eventData = { path: '/src/foo.ts', eventType: 'changed' as const };

        const server = http.createServer((_req, res) => {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            res.write(`event: fileChanged\ndata: ${JSON.stringify(eventData)}\n\n`);
            res.end();
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: TEST_TOKEN });

            let callbackCalled = false;

            const sub = client.subscribeEvents({
                onFileChanged: (data) => {
                    callbackCalled = true;
                    assert.deepStrictEqual(data, eventData);
                    sub.close();
                    server.close(done);
                },
                onError: () => {},
            });

            setTimeout(() => {
                if (!callbackCalled) {
                    sub.close();
                    server.close(() => {
                        done(new Error('onFileChanged was not called within timeout'));
                    });
                }
            }, 2000);
        });
    });

    test('Given subscribeEvents(), when the SSE connection emits an Authorization header, then it matches the token', (done) => {
        let authHeader: string | undefined;

        const server = http.createServer((req, res) => {
            authHeader = req.headers['authorization'];
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                Connection: 'keep-alive',
            });
            res.end();
        });

        server.listen(0, '127.0.0.1', () => {
            const port = (server.address() as { port: number }).port;
            const client = new DaemonClient({ port, token: 'sse-token-test' });

            const sub = client.subscribeEvents({
                onConnected: () => {
                    sub.close();
                },
                onError: () => {},
            });

            setTimeout(() => {
                sub.close();
                server.close(() => {
                    assert.strictEqual(authHeader, 'Bearer sse-token-test');
                    done();
                });
            }, 500);
        });
    });
});
