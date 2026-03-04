/**
 * Daemon Server Entry Point
 *
 * This is the main process spawned by the lifecycle module.
 * It starts the HTTP server, writes the PID/port/token files, and handles
 * graceful shutdown on SIGTERM/SIGINT.
 *
 * CLI usage:
 *   node server.js --workspace <path> [--port <number>]
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import { execGit } from '../core/gitService';
import { DaemonConfigStore } from './config';
import { DaemonNotificationEmitter } from './notifications';
import { DaemonFileWatchManager } from './fileWatcher';
import { generateToken, writeTokenFile } from './auth';
import { createRouter } from './router';
import { SessionHandlerService } from '../core/services/SessionHandlerService';
import { getWorktreesFolder } from '../core/session/SessionDataService';
import { IHandlerContext } from '../core/interfaces/IHandlerContext';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { workspace: string; port: number } {
    let workspace = '';
    let port = 0;

    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--workspace' && i + 1 < argv.length) {
            workspace = argv[i + 1];
            i++;
        } else if (argv[i] === '--port' && i + 1 < argv.length) {
            const parsed = parseInt(argv[i + 1], 10);
            if (!isNaN(parsed)) {
                port = parsed;
            }
            i++;
        }
    }

    return { workspace, port };
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

const LANES_DIR = '.lanes';

async function writeLanesFile(workspaceRoot: string, fileName: string, content: string): Promise<void> {
    const lanesDir = path.join(workspaceRoot, LANES_DIR);
    await fs.mkdir(lanesDir, { recursive: true });
    await fs.writeFile(path.join(lanesDir, fileName), content, 'utf-8');
}

async function removeLanesFile(workspaceRoot: string, fileName: string): Promise<void> {
    try {
        await fs.unlink(path.join(workspaceRoot, LANES_DIR, fileName));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }
}

// ---------------------------------------------------------------------------
// Resolve git root from workspace path
// ---------------------------------------------------------------------------

async function resolveGitRoot(workspacePath: string): Promise<string> {
    try {
        const result = await execGit(
            ['rev-parse', '--show-toplevel'],
            workspacePath
        );
        return result.trim();
    } catch {
        // If git fails, fall back to the provided workspace path
        return workspacePath;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const { workspace, port } = parseArgs(process.argv.slice(2));

    if (!workspace) {
        process.stderr.write('[Daemon] Error: --workspace argument is required\n');
        process.exit(1);
    }

    // Resolve the actual git root (workspace may already be a git root)
    const workspaceRoot = await resolveGitRoot(workspace);

    // 1. Initialize DaemonConfigStore
    const configStore = new DaemonConfigStore(workspaceRoot);
    await configStore.initialize();

    // 2. Create DaemonNotificationEmitter
    const notificationEmitter = new DaemonNotificationEmitter();

    // 3. Create DaemonFileWatchManager
    const fileWatchManager = new DaemonFileWatchManager(notificationEmitter);

    // 4. Build IHandlerContext
    const context: IHandlerContext = {
        workspaceRoot,
        config: configStore,
        notificationEmitter,
        fileWatchManager,
    };

    // 5. Create SessionHandlerService
    const handlerService = new SessionHandlerService(context);

    // 5a. Set up automatic file watching for session and workflow-state changes.
    // fileWatchManager.dispose() in the shutdown handler closes all watchers,
    // so we don't need to track the IDs for cleanup.
    const worktreesFolder = getWorktreesFolder(
        configStore.get('lanes.worktreesFolder') as string | undefined
    );
    fileWatchManager.setupAutoWatching(workspaceRoot, worktreesFolder);

    // 6. Generate auth token and write to .lanes/daemon.token
    const authToken = generateToken();
    await writeTokenFile(workspaceRoot, authToken);

    // 7. Create router and HTTP server
    const requestHandler = createRouter(handlerService, notificationEmitter, authToken);
    const server = http.createServer(requestHandler);

    // 8. Start listening on 127.0.0.1 only
    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
            resolve();
        });
    });

    const address = server.address();
    const actualPort = typeof address === 'object' && address !== null ? address.port : port;

    // 9. Write PID, port, and log startup info
    await writeLanesFile(workspaceRoot, 'daemon.pid', String(process.pid));
    await writeLanesFile(workspaceRoot, 'daemon.port', String(actualPort));

    process.stderr.write(
        `[Daemon] Started. pid=${process.pid} port=${actualPort} workspace=${workspaceRoot}\n`
    );

    // Handle runtime server errors (e.g., unexpected socket errors)
    server.on('error', (err) => {
        process.stderr.write(`[Daemon] Server error: ${err.message}\n`);
    });

    // ---------------------------------------------------------------------------
    // Graceful shutdown
    // ---------------------------------------------------------------------------

    // Track active connections so we can destroy them on shutdown.
    // Without this, long-lived SSE connections prevent server.close() from completing.
    const activeConnections = new Set<import('net').Socket>();
    server.on('connection', (socket) => {
        activeConnections.add(socket);
        socket.on('close', () => {
            activeConnections.delete(socket);
        });
    });

    async function shutdown(signal: string): Promise<void> {
        process.stderr.write(`[Daemon] Received ${signal}, shutting down...\n`);

        // Close the HTTP server (stop accepting new connections)
        // and destroy all active connections (including SSE streams)
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            for (const socket of activeConnections) {
                socket.destroy();
            }
        });

        // Dispose file watchers
        fileWatchManager.dispose();

        // Remove PID, port, and token files
        await removeLanesFile(workspaceRoot, 'daemon.pid');
        await removeLanesFile(workspaceRoot, 'daemon.port');
        await removeLanesFile(workspaceRoot, 'daemon.token');

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
