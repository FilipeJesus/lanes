/**
 * Global daemon server entry point.
 *
 * Starts one machine-wide HTTP server that routes requests to registered
 * projects by `projectId`.
 */

import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { generateToken, writeTokenFile, removeTokenFile } from './auth';
import { createRouter } from './router';
import { GlobalDaemonProjectManager } from './manager';

function parseArgs(argv: string[]): { port: number } {
    let port = 0;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--port' && i + 1 < argv.length) {
            const parsed = parseInt(argv[i + 1], 10);
            if (!isNaN(parsed)) {
                port = parsed;
            }
            i++;
        }
    }

    return { port };
}

const LANES_DIR = path.join(process.env.HOME || os.homedir(), '.lanes');

async function writeGlobalFile(fileName: string, content: string): Promise<void> {
    await fs.mkdir(LANES_DIR, { recursive: true });
    await fs.writeFile(path.join(LANES_DIR, fileName), content, 'utf-8');
}

async function removeGlobalFile(fileName: string): Promise<void> {
    try {
        await fs.unlink(path.join(LANES_DIR, fileName));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }
}

async function main(): Promise<void> {
    const { port } = parseArgs(process.argv.slice(2));
    const projectManager = new GlobalDaemonProjectManager();
    const authToken = generateToken();
    const startedAt = new Date().toISOString();
    await writeTokenFile(authToken);

    const routerContext = { port: 0 };
    const requestHandler = createRouter(projectManager, authToken, routerContext);
    const server = http.createServer(requestHandler);

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : port;
    routerContext.port = actualPort;

    await writeGlobalFile('daemon.pid', String(process.pid));
    await writeGlobalFile('daemon.port', String(actualPort));
    await writeGlobalFile('daemon.startedAt', startedAt);

    process.stderr.write(
        `[Daemon] Started. pid=${process.pid} port=${actualPort}\n`
    );

    server.on('error', (err) => {
        process.stderr.write(`[Daemon] Server error: ${err.message}\n`);
    });

    const activeConnections = new Set<import('net').Socket>();
    server.on('connection', (socket) => {
        activeConnections.add(socket);
        socket.on('close', () => {
            activeConnections.delete(socket);
        });
    });

    async function shutdown(signal: string): Promise<void> {
        process.stderr.write(`[Daemon] Received ${signal}, shutting down...\n`);

        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of activeConnections) {
                socket.destroy();
            }
        });

        projectManager.dispose();
        await removeGlobalFile('daemon.pid');
        await removeGlobalFile('daemon.port');
        await removeGlobalFile('daemon.startedAt');
        await removeTokenFile();

        process.stderr.write('[Daemon] Shutdown complete.\n');
        process.exit(0);
    }

    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
    process.on('SIGINT', () => { void shutdown('SIGINT'); });
}

main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[Daemon] Fatal error: ${message}\n`);
    process.exit(1);
});
