/**
 * Gateway Server
 *
 * A lightweight HTTP server that:
 * - Reads ~/.lanes/projects.json to discover explicitly registered projects
 * - Reads the machine-wide daemon lifecycle files from ~/.lanes/
 * - Serves GET /api/gateway/projects returning registered projects plus global daemon state
 * - Serves static files from the web-ui build output in production
 * - Has CORS enabled for local development
 *
 * This is the entry point for the `lanes web` command.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
    type DaemonRegistryEntry,
    type RegisteredProjectEntry,
    listRegisteredProjects,
} from './registry';
import { isDaemonRunning, getDaemonPid, getDaemonPort } from './lifecycle';
import { readTokenFile } from './auth';

export type GatewayProjectInfo = RegisteredProjectEntry & {
    status: 'running' | 'registered';
    daemon: DaemonRegistryEntry | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default gateway port. */
export const DEFAULT_GATEWAY_PORT = 3847;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the set of allowed CORS origins for the gateway.
 * Includes the actual gateway port and the Vite dev server port (5173).
 */
function buildAllowedOrigins(gatewayPort: number): Set<string> {
    const origins = new Set([
        `http://localhost:${gatewayPort}`,
        `http://127.0.0.1:${gatewayPort}`,
        'http://localhost:5173', // Vite dev server
        'http://127.0.0.1:5173',
    ]);
    // Always include the default port if different from the actual port
    if (gatewayPort !== DEFAULT_GATEWAY_PORT) {
        origins.add(`http://localhost:${DEFAULT_GATEWAY_PORT}`);
        origins.add(`http://127.0.0.1:${DEFAULT_GATEWAY_PORT}`);
    }
    return origins;
}

function createSetCorsHeaders(allowedOrigins: Set<string>) {
    return function setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
        const origin = req.headers['origin'] ?? '';
        if (allowedOrigins.has(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
    };
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

async function listGatewayProjects(): Promise<GatewayProjectInfo[]> {
    const [registeredProjects, running, pid, port, token] = await Promise.all([
        listRegisteredProjects(),
        isDaemonRunning(),
        getDaemonPid(),
        getDaemonPort(),
        readTokenFile().catch(() => undefined),
    ]);

    return registeredProjects
        .map((project) => {
            const daemon: DaemonRegistryEntry | null =
                running && pid !== undefined && port !== undefined && token
                    ? {
                        projectId: project.projectId,
                        workspaceRoot: project.workspaceRoot,
                        projectName: project.projectName,
                        pid,
                        port,
                        token,
                        startedAt: project.registeredAt,
                    }
                    : null;

            return {
                ...project,
                status: daemon ? 'running' as const : 'registered' as const,
                daemon,
            };
        })
        .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

/**
 * Attempt to serve a static file. Returns true if the file was served,
 * false if it was not found.
 */
async function serveStaticFile(res: http.ServerResponse, filePath: string): Promise<boolean> {
    try {
        const content = await fs.readFile(filePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.mjs': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
        };
        const contentType = contentTypeMap[ext] ?? 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
        return true;
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw err;
    }
}

// ---------------------------------------------------------------------------
// Gateway server factory
// ---------------------------------------------------------------------------

export interface GatewayServerOptions {
    /** Port to listen on. Defaults to DEFAULT_GATEWAY_PORT. */
    port?: number;
    /**
     * Path to the web-ui static build output directory.
     * When provided, the gateway will serve static files from this directory.
     * If not provided (or the directory doesn't exist), only the API is served.
     */
    staticDir?: string;
}

/**
 * Create and start the gateway HTTP server.
 * Returns the bound port (useful when port 0 is passed for OS-assigned port).
 */
export async function createGatewayServer(options: GatewayServerOptions = {}): Promise<{
    server: http.Server;
    port: number;
}> {
    const { port = DEFAULT_GATEWAY_PORT, staticDir } = options;

    const allowedOrigins = buildAllowedOrigins(port);
    const setCorsHeaders = createSetCorsHeaders(allowedOrigins);

    const server = http.createServer(async (req, res) => {
        const method = req.method ?? 'GET';
        const rawUrl = req.url ?? '/';
        const pathname = rawUrl.split('?')[0];

        // Always set CORS headers
        setCorsHeaders(req, res);

        // Handle CORS pre-flight
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        try {
            if (method === 'GET' && pathname === '/api/gateway/daemons') {
                const projects = await listGatewayProjects();
                const daemons = projects
                    .map((project) => project.daemon)
                    .filter((daemon): daemon is DaemonRegistryEntry => daemon !== null);
                sendJson(res, 200, daemons);
                return;
            }

            // ------------------------------------------------------------------
            // API: GET /api/gateway/projects
            // Returns registered projects plus live daemon state.
            // ------------------------------------------------------------------
            if (method === 'GET' && pathname === '/api/gateway/projects') {
                const projects = await listGatewayProjects();
                sendJson(res, 200, projects);
                return;
            }

            // ------------------------------------------------------------------
            // Static file serving (production web-ui)
            // ------------------------------------------------------------------
            if (staticDir && (method === 'GET' || method === 'HEAD')) {
                // Resolve safe file path (prevent directory traversal)
                const resolvedStatic = path.resolve(staticDir);
                let filePath = path.resolve(staticDir, '.' + pathname);

                // Verify the resolved path is within the static directory
                if (!filePath.startsWith(resolvedStatic + path.sep) && filePath !== resolvedStatic) {
                    sendJson(res, 403, { error: 'Forbidden' });
                    return;
                }

                // Default to index.html for the root
                if (filePath === resolvedStatic) {
                    filePath = path.join(staticDir, 'index.html');
                }

                const served = await serveStaticFile(res, filePath);
                if (served) {return;}

                // For SPA routing: if the path has no extension (or is unknown),
                // fall back to index.html so client-side routing works.
                if (!path.extname(filePath)) {
                    const indexPath = path.join(staticDir, 'index.html');
                    const indexServed = await serveStaticFile(res, indexPath);
                    if (indexServed) {return;}
                }
            }

            // ------------------------------------------------------------------
            // 404 — route not matched
            // ------------------------------------------------------------------
            sendJson(res, 404, { error: 'Not Found' });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`[Gateway] Internal error: ${message}\n`);
            sendJson(res, 500, { error: 'Internal server error' });
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : port;

    return { server, port: actualPort };
}

/**
 * Start the gateway server and block until the process receives SIGTERM or SIGINT.
 * Intended for use by the `lanes web` CLI command.
 */
export async function runGatewayServer(options: GatewayServerOptions = {}): Promise<void> {
    const { server, port } = await createGatewayServer(options);

    const projects = await listRegisteredProjects();
    const webUiNote = options.staticDir ? ` | Web UI: http://127.0.0.1:${port}` : '';
    process.stdout.write(`Gateway running on http://127.0.0.1:${port}${webUiNote}\n`);
    process.stdout.write(`  Projects: http://127.0.0.1:${port}/api/gateway/projects\n`);
    process.stdout.write(`  Tracking ${projects.length} registered project(s)\n`);

    // Track active connections for graceful shutdown
    const activeConnections = new Set<import('net').Socket>();
    server.on('connection', (socket) => {
        activeConnections.add(socket);
        socket.on('close', () => activeConnections.delete(socket));
    });

    async function shutdown(signal: string): Promise<void> {
        process.stderr.write(`[Gateway] Received ${signal}, shutting down...\n`);
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of activeConnections) {
                socket.destroy();
            }
        });
        process.stderr.write('[Gateway] Shutdown complete.\n');
        process.exit(0);
    }

    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });

    // Keep the process alive
    await new Promise<void>(() => { /* never resolves */ });
}
