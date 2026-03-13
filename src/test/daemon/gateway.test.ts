/**
 * Tests for the GatewayServer (src/daemon/gateway.ts).
 *
 * Uses a real Node.js HTTP server (port 0 for OS-assigned port) so the
 * gateway is exercised end-to-end.
 *
 * Covers:
 *  - GET /api/gateway/daemons returns live daemon entries from the registry
 *  - Stale (dead-PID) entries are excluded from the response
 *  - The endpoint is public (no auth required) and returns 200
 *  - CORS headers are set on every response
 *  - OPTIONS pre-flight request returns 204 with CORS headers
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import { createGatewayServer } from '../../daemon/gateway';
import { registerProject } from '../../daemon/registry';
import type { GatewayDaemonInfo } from '../../daemon/gateway';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send an HTTP request to the test server and collect the response. */
function request(
    port: number,
    options: { method?: string; path?: string; headers?: Record<string, string> }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: options.path ?? '/',
                method: options.method ?? 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode ?? 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        req.end();
    });
}

/** Create a minimal valid machine-wide daemon projection for testing. */
function makeEntry(overrides: Partial<GatewayDaemonInfo> = {}): GatewayDaemonInfo {
    return {
        projectId: 'project-test-123',
        workspaceRoot: '/tmp/test-workspace',
        port: 3000,
        pid: process.pid,
        token: 'abc123',
        startedAt: new Date().toISOString(),
        projectName: 'test-project',
        ...overrides,
    };
}

function writeGlobalDaemonFiles(homeDir: string, entry: GatewayDaemonInfo): void {
    const lanesDir = path.join(homeDir, '.lanes');
    fs.mkdirSync(lanesDir, { recursive: true });
    fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(entry.pid), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.port'), String(entry.port), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.token'), entry.token, 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.startedAt'), entry.startedAt, 'utf-8');
}

// ---------------------------------------------------------------------------
// Suite: GatewayServer
// ---------------------------------------------------------------------------

suite('GatewayServer', () => {
    let server: http.Server;
    let gatewayPort: number;
    let tempDir: string;
    let originalHome: string | undefined;

    setup(async () => {
        // Create isolated temp HOME so registry operations don't touch real ~/.lanes
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-gateway-test-'));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;

        // Start gateway on an OS-assigned port (port 0)
        const result = await createGatewayServer({ port: 0 });
        server = result.server;
        gatewayPort = result.port;
    });

    teardown(async () => {
        sinon.restore();
        // Close the server
        await new Promise<void>((resolve, reject) => {
            server.close((err) => {
                if (err) { reject(err); } else { resolve(); }
            });
        });
        // Restore HOME
        if (originalHome !== undefined) {
            process.env.HOME = originalHome;
        } else {
            delete process.env.HOME;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -----------------------------------------------------------------------
    // gateway-server-serves-daemons
    // -----------------------------------------------------------------------

    test('Given running daemons in registry, when GET /api/gateway/daemons is called, then returns array of DaemonInfo', async () => {
        // Arrange: create a registered project and live global daemon state
        const entry = makeEntry({
            workspaceRoot: '/workspace/running',
            projectName: 'running-project',
            pid: process.pid,
        });
        await registerProject({
            projectId: '',
            workspaceRoot: entry.workspaceRoot,
            projectName: entry.projectName,
            registeredAt: new Date().toISOString(),
        });
        writeGlobalDaemonFiles(tempDir, entry);

        // Act
        const res = await request(gatewayPort, { method: 'GET', path: '/api/gateway/daemons' });

        // Assert
        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        const body = JSON.parse(res.body) as GatewayDaemonInfo[];
        assert.ok(Array.isArray(body), 'Response body should be an array');
        assert.ok(body.length >= 1, 'Should contain at least one live daemon entry');
        const found = body.find((d) => d.workspaceRoot === '/workspace/running');
        assert.ok(found, 'Registered live daemon should appear in the response');
        assert.strictEqual(found!.projectName, 'running-project');
    });

    test('Given stale daemons in registry, when GET /api/gateway/daemons is called, then stale entries are excluded', async () => {
        // Arrange: create a stale global daemon state
        const deadPid = 999999999;
        const staleEntry = makeEntry({
            workspaceRoot: '/workspace/stale',
            projectName: 'stale-project',
            pid: deadPid,
        });
        await registerProject({
            projectId: '',
            workspaceRoot: staleEntry.workspaceRoot,
            projectName: staleEntry.projectName,
            registeredAt: new Date().toISOString(),
        });
        writeGlobalDaemonFiles(tempDir, staleEntry);

        // Stub process.kill to simulate a dead process for the fake PID
        sinon.stub(process, 'kill').callsFake((pid: number | NodeJS.Signals) => {
            if (pid === deadPid) {
                throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
            }
            return true;
        });

        // Act
        const res = await request(gatewayPort, { method: 'GET', path: '/api/gateway/daemons' });

        // Assert
        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        const body = JSON.parse(res.body) as GatewayDaemonInfo[];
        assert.ok(Array.isArray(body), 'Response body should be an array');
        assert.strictEqual(body.length, 0, 'Stale global daemon should not produce daemon entries');
    });

    test('Given no auth, when GET /api/gateway/daemons is called, then returns 200 (public endpoint)', async () => {
        // Act: no Authorization header is sent
        const res = await request(gatewayPort, { method: 'GET', path: '/api/gateway/daemons' });

        // Assert: public endpoint — must succeed without auth
        assert.strictEqual(res.status, 200, 'Should return 200 without any auth header');
    });

    test('Given a registered project without a running daemon, when GET /api/gateway/projects is called, then it is returned with status "registered"', async () => {
        await registerProject({
            projectId: '',
            workspaceRoot: '/workspace/registered-only',
            projectName: 'registered-only',
            registeredAt: new Date().toISOString(),
        });

        const res = await request(gatewayPort, { method: 'GET', path: '/api/gateway/projects' });

        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        const body = JSON.parse(res.body) as Array<{
            workspaceRoot: string;
            status: string;
            daemon: GatewayDaemonInfo | null;
        }>;
        const found = body.find((project) => project.workspaceRoot === '/workspace/registered-only');
        assert.ok(found, 'Registered project should appear in the response');
        assert.strictEqual(found!.status, 'registered');
        assert.strictEqual(found!.daemon, null);
    });

    test('Given a registered project with a live daemon, when GET /api/gateway/projects is called, then it is returned with status "running"', async () => {
        const workspaceRoot = '/workspace/running-project';
        await registerProject({
            projectId: '',
            workspaceRoot,
            projectName: 'running-project',
            registeredAt: new Date().toISOString(),
        });
        writeGlobalDaemonFiles(tempDir, makeEntry({
            workspaceRoot,
            projectName: 'running-project',
            pid: process.pid,
        }));

        const res = await request(gatewayPort, { method: 'GET', path: '/api/gateway/projects' });

        assert.strictEqual(res.status, 200, 'Should return HTTP 200');
        const body = JSON.parse(res.body) as Array<{
            workspaceRoot: string;
            status: string;
            daemon: GatewayDaemonInfo | null;
        }>;
        const found = body.find((project) => project.workspaceRoot === workspaceRoot);
        assert.ok(found, 'Running project should appear in the response');
        assert.strictEqual(found!.status, 'running');
        assert.ok(found!.daemon, 'Running project should include daemon info');
        assert.strictEqual(found!.daemon?.workspaceRoot, workspaceRoot);
    });

    // -----------------------------------------------------------------------
    // gateway-server-cors
    // -----------------------------------------------------------------------

    test('Given allowed origin, when response is returned, then Access-Control-Allow-Origin reflects origin', async () => {
        // Act
        const origin = 'http://localhost:3847';
        const res = await request(gatewayPort, {
            method: 'GET',
            path: '/api/gateway/daemons',
            headers: { Origin: origin },
        });

        // Assert
        assert.strictEqual(
            res.headers['access-control-allow-origin'],
            origin,
            'CORS header Access-Control-Allow-Origin must reflect the allowed origin'
        );
    });

    test('Given disallowed origin, when response is returned, then Access-Control-Allow-Origin is not set', async () => {
        // Act
        const res = await request(gatewayPort, {
            method: 'GET',
            path: '/api/gateway/daemons',
            headers: { Origin: 'http://evil.example.com' },
        });

        // Assert
        assert.strictEqual(
            res.headers['access-control-allow-origin'],
            undefined,
            'CORS header Access-Control-Allow-Origin must not be set for disallowed origins'
        );
    });

    test('Given OPTIONS preflight with allowed origin, when handled, then 204 is returned with CORS headers', async () => {
        // Act
        const origin = 'http://localhost:5173';
        const res = await request(gatewayPort, {
            method: 'OPTIONS',
            path: '/api/gateway/daemons',
            headers: { Origin: origin },
        });

        // Assert
        assert.strictEqual(res.status, 204, 'OPTIONS pre-flight should return 204');
        assert.strictEqual(
            res.headers['access-control-allow-origin'],
            origin,
            'CORS header Access-Control-Allow-Origin must reflect the allowed origin on OPTIONS response'
        );
        assert.ok(
            res.headers['access-control-allow-methods'],
            'Access-Control-Allow-Methods header should be present on OPTIONS response'
        );
    });
});
