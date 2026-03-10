/**
 * Tests for DaemonClient — terminal I/O endpoints.
 *
 * Covers:
 *  - getTerminalOutput(): GET /api/v1/terminals/:name/output
 *  - getTerminalOutput(): returns TerminalOutputData from server
 *  - resizeTerminal(): POST /api/v1/terminals/:name/resize with { cols, rows }
 */

import * as assert from 'assert';
import * as http from 'http';
import { DaemonClient } from '../../daemon/client';
import type { TerminalOutputData } from '../../core/interfaces/ITerminalIOProvider';

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
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(response.body));
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

async function startTestServer(
    responseFactory: (req: CapturedRequest) => ServerResponse
): Promise<ReturnType<typeof createTestServer>> {
    const helper = createTestServer(responseFactory);
    await new Promise<void>((resolve) => helper.server.listen(0, '127.0.0.1', resolve));
    return helper;
}

const TEST_TOKEN = 'test-bearer-token-terminal-abc';

function makeClient(port: number): DaemonClient {
    return new DaemonClient({ port, token: TEST_TOKEN });
}

// ---------------------------------------------------------------------------
// Suite: DaemonClient - getTerminalOutput
// ---------------------------------------------------------------------------

suite('DaemonClient - getTerminalOutput', () => {
    test('Given a terminal name, when getTerminalOutput is called, then it makes GET /api/v1/terminals/:name/output', async () => {
        // Arrange
        const helper = await startTestServer(() => ({
            status: 200,
            body: { content: 'terminal content\n', rows: 24, cols: 80 },
        }));

        try {
            const client = makeClient(helper.port());

            // Act
            await client.getTerminalOutput('my-terminal');

            // Assert
            assert.strictEqual(helper.captured.length, 1, 'Exactly one request should be made');
            assert.strictEqual(helper.captured[0].method, 'GET');
            assert.strictEqual(
                helper.captured[0].url,
                '/api/v1/terminals/my-terminal/output'
            );
        } finally {
            await helper.close();
        }
    });

    test('Given the server returns terminal data, when getTerminalOutput is called, then it returns TerminalOutputData', async () => {
        // Arrange
        const expectedData: TerminalOutputData = {
            content: 'hello world\n',
            rows: 40,
            cols: 120,
        };

        const helper = await startTestServer(() => ({
            status: 200,
            body: expectedData,
        }));

        try {
            const client = makeClient(helper.port());

            // Act
            const result = await client.getTerminalOutput('my-terminal');

            // Assert
            assert.strictEqual(result.content, expectedData.content);
            assert.strictEqual(result.rows, expectedData.rows);
            assert.strictEqual(result.cols, expectedData.cols);
        } finally {
            await helper.close();
        }
    });

    test('Given a terminal name with special characters, when getTerminalOutput is called, then the name is URI-encoded in the URL', async () => {
        // Arrange
        const helper = await startTestServer(() => ({
            status: 200,
            body: { content: '', rows: 24, cols: 80 },
        }));

        try {
            const client = makeClient(helper.port());

            // Act
            await client.getTerminalOutput('terminal with spaces');

            // Assert
            assert.strictEqual(
                helper.captured[0].url,
                '/api/v1/terminals/terminal%20with%20spaces/output',
                'Terminal name should be URI-encoded in the URL'
            );
        } finally {
            await helper.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Suite: DaemonClient - resizeTerminal
// ---------------------------------------------------------------------------

suite('DaemonClient - resizeTerminal', () => {
    test('Given a terminal name and dimensions, when resizeTerminal is called, then it makes POST /api/v1/terminals/:name/resize with { cols, rows }', async () => {
        // Arrange
        const helper = await startTestServer(() => ({
            status: 200,
            body: { success: true },
        }));

        try {
            const client = makeClient(helper.port());

            // Act
            await client.resizeTerminal('my-terminal', 120, 40);

            // Assert
            assert.strictEqual(helper.captured.length, 1, 'Exactly one request should be made');
            assert.strictEqual(helper.captured[0].method, 'POST');
            assert.strictEqual(
                helper.captured[0].url,
                '/api/v1/terminals/my-terminal/resize'
            );

            // Verify the request body contains the correct cols and rows
            const requestBody = JSON.parse(helper.captured[0].body) as { cols: number; rows: number };
            assert.strictEqual(requestBody.cols, 120);
            assert.strictEqual(requestBody.rows, 40);
        } finally {
            await helper.close();
        }
    });

    test('Given a terminal name with URI-unsafe characters, when resizeTerminal is called, then the name is URI-encoded in the URL', async () => {
        // Arrange
        const helper = await startTestServer(() => ({
            status: 200,
            body: { success: true },
        }));

        try {
            const client = makeClient(helper.port());

            // Act
            await client.resizeTerminal('terminal/special', 80, 24);

            // Assert
            assert.strictEqual(
                helper.captured[0].url,
                '/api/v1/terminals/terminal%2Fspecial/resize',
                'Terminal name should be URI-encoded in the URL'
            );
        } finally {
            await helper.close();
        }
    });
});
