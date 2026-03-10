/**
 * `lanes web` — Start the Lanes gateway server and optionally serve the web UI.
 *
 * The gateway server:
 * - Reads ~/.lanes/daemons.json to discover running daemon instances
 * - Exposes GET /api/gateway/daemons for the web UI to fetch project list
 * - Optionally serves the web UI static files (production build)
 */

import { spawn, type ChildProcess } from 'child_process';
import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getErrorMessage } from '../../core/utils';
import {
    createGatewayServer,
    runGatewayServer,
    DEFAULT_GATEWAY_PORT,
} from '../../daemon/gateway';

const VITE_DEV_SERVER_PORT = 5173;

export const webCommandDeps = {
    spawnViteProcess: spawn,
};

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function resolveStaticDir(): Promise<string | undefined> {
    const cwdCandidate = path.resolve(process.cwd(), 'out', 'web-ui');
    const bundleCandidate = path.resolve(__dirname, 'web-ui');

    for (const candidate of [cwdCandidate, bundleCandidate]) {
        if (await pathExists(path.join(candidate, 'index.html'))) {
            return candidate;
        }
    }

    return bundleCandidate;
}

async function resolveWebUiSourceDir(): Promise<string> {
    const cwdCandidate = path.resolve(process.cwd(), 'web-ui');
    if (await pathExists(path.join(cwdCandidate, 'package.json'))) {
        return cwdCandidate;
    }

    const bundleRelativeCandidate = path.resolve(__dirname, '..', '..', '..', 'web-ui');
    if (await pathExists(path.join(bundleRelativeCandidate, 'package.json'))) {
        return bundleRelativeCandidate;
    }

    throw new Error(
        'Unable to find web-ui source directory for dev mode. Run from the repo root or install dependencies in web-ui/.'
    );
}

function spawnViteDevServer(webUiDir: string, gatewayPort: number): ChildProcess {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = webCommandDeps.spawnViteProcess(
        npmCommand,
        ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(VITE_DEV_SERVER_PORT), '--strictPort'],
        {
            cwd: webUiDir,
            stdio: 'inherit',
            env: {
                ...process.env,
                LANES_WEB_GATEWAY_PORT: String(gatewayPort),
            },
        }
    );

    child.once('error', (error) => {
        process.stderr.write(`[Web] Failed to start Vite dev server: ${getErrorMessage(error)}\n`);
    });

    return child;
}

async function runGatewayAndViteDevServer(port: number): Promise<void> {
    const webUiDir = await resolveWebUiSourceDir();
    const viteProcess = spawnViteDevServer(webUiDir, port);
    const { server } = await createGatewayServer({ port });

    const activeConnections = new Set<import('net').Socket>();
    server.on('connection', (socket) => {
        activeConnections.add(socket);
        socket.on('close', () => activeConnections.delete(socket));
    });

    process.stdout.write(`Gateway running on http://127.0.0.1:${port}\n`);
    process.stdout.write(`  Web UI (Vite): http://127.0.0.1:${VITE_DEV_SERVER_PORT}\n`);
    process.stdout.write(`  Projects: http://127.0.0.1:${port}/api/gateway/projects\n`);

    let shuttingDown = false;
    let settle: ((error?: Error) => void) | undefined;
    const completed = new Promise<void>((resolve, reject) => {
        settle = (error?: Error) => error ? reject(error) : resolve();
    });

    const cleanup = async (reason: string): Promise<void> => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        process.stderr.write(`[Web] ${reason}\n`);

        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of activeConnections) {
                socket.destroy();
            }
        });

        if (!viteProcess.killed) {
            viteProcess.kill('SIGTERM');
        }
    };

    const handleSigterm = () => {
        void cleanup('Received SIGTERM, shutting down...').then(() => settle?.()).catch((error) => settle?.(error));
    };
    const handleSigint = () => {
        void cleanup('Received SIGINT, shutting down...').then(() => settle?.()).catch((error) => settle?.(error));
    };

    process.on('SIGTERM', handleSigterm);
    process.on('SIGINT', handleSigint);

    viteProcess.once('exit', (code, signal) => {
        if (shuttingDown) {
            settle?.();
            return;
        }

        const error = new Error(`Vite dev server exited unexpectedly (${signal ?? `code ${code ?? 0}`})`);
        void cleanup(`${error.message}, shutting down...`).then(() => settle?.(error)).catch((cleanupError) => settle?.(cleanupError));
    });
    viteProcess.once('error', (error) => {
        if (shuttingDown) {
            settle?.();
            return;
        }

        void cleanup(`Failed to start Vite dev server: ${getErrorMessage(error)}`).then(() => settle?.(error)).catch((cleanupError) => settle?.(cleanupError));
    });

    try {
        await completed;
    } finally {
        process.off('SIGTERM', handleSigterm);
        process.off('SIGINT', handleSigint);
    }
}

export function registerWebCommand(program: Command): void {
    program
        .command('web')
        .description('Start the Lanes web UI and gateway server')
        .option(
            '--port <port>',
            `Port for the gateway server (default: ${DEFAULT_GATEWAY_PORT})`,
            String(DEFAULT_GATEWAY_PORT)
        )
        .option(
            '--no-ui',
            'Start gateway API only, without serving the web UI static files'
        )
        .option(
            '--dev',
            'Start the gateway API alongside the Vite dev server instead of serving the built static bundle'
        )
        .action(async (options) => {
            const port = parseInt(options.port, 10);

            if (isNaN(port) || port < 1 || port > 65535) {
                console.error(`Error: Invalid port: ${options.port}. Must be a number between 1 and 65535.`);
                process.exit(1);
            }

            try {
                if (options.dev) {
                    if (options.ui === false) {
                        throw new Error('--dev cannot be combined with --no-ui');
                    }

                    await runGatewayAndViteDevServer(port);
                    return;
                }

                const staticDir = options.ui !== false ? await resolveStaticDir() : undefined;
                await runGatewayServer({ port, staticDir });
            } catch (err) {
                console.error(`Error: ${getErrorMessage(err)}`);
                process.exit(1);
            }
        });
}
