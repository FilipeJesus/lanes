/**
 * Daemon Lifecycle - Start, stop, and query the standalone HTTP daemon process
 *
 * The daemon runs as a detached child process. Its PID and port are persisted
 * to `.lanes/daemon.pid` and `.lanes/daemon.port` so callers can discover and
 * manage it without keeping a reference to the child_process handle.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { removeTokenFile } from './auth';

const LANES_DIR = '.lanes';
const PID_FILE = 'daemon.pid';
const PORT_FILE = 'daemon.port';

/**
 * Options for starting the daemon.
 */
export interface StartDaemonOptions {
    /** Absolute path to the workspace root (repository root). */
    workspaceRoot: string;
    /** Port on which the daemon should listen. Defaults to 0 (OS-assigned). */
    port?: number;
    /** Absolute path to the daemon server entry-point script. */
    serverPath: string;
}

/**
 * Spawn the daemon as a detached child process and write PID + port files.
 * The caller does not receive a handle to the child — use stopDaemon() to kill it.
 */
export async function startDaemon(options: StartDaemonOptions): Promise<void> {
    const { workspaceRoot, port = 0, serverPath } = options;

    if (await isDaemonRunning(workspaceRoot)) {
        throw new Error('Daemon is already running. Stop it first with stopDaemon().');
    }

    const lanesDir = path.join(workspaceRoot, LANES_DIR);
    await fs.mkdir(lanesDir, { recursive: true });

    const args = [serverPath, '--workspace', workspaceRoot, '--port', String(port)];
    const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });

    // Unref so the parent process can exit without waiting for the daemon
    child.unref();

    if (child.pid === undefined) {
        throw new Error('Failed to start daemon: child process has no PID');
    }

    // Write PID file
    const pidPath = path.join(lanesDir, PID_FILE);
    await fs.writeFile(pidPath, String(child.pid), 'utf-8');

    // Write port file (the daemon will overwrite this with the actual port if 0 was given)
    const portPath = path.join(lanesDir, PORT_FILE);
    await fs.writeFile(portPath, String(port), 'utf-8');
}

/**
 * Stop the running daemon by reading its PID file, sending SIGTERM,
 * and cleaning up the PID and port files.
 * Does not throw if the daemon is not running.
 */
export async function stopDaemon(workspaceRoot: string): Promise<void> {
    const lanesDir = path.join(workspaceRoot, LANES_DIR);
    const pidPath = path.join(lanesDir, PID_FILE);

    let pid: number | undefined;
    try {
        const content = await fs.readFile(pidPath, 'utf-8');
        pid = parseInt(content.trim(), 10);
    } catch {
        // PID file doesn't exist — nothing to stop
        return;
    }

    if (!isNaN(pid)) {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            // Process may already be gone — ignore
        }
    }

    // Clean up PID, port, and token files
    await removeLanesFile(lanesDir, PID_FILE);
    await removeLanesFile(lanesDir, PORT_FILE);
    await removeTokenFile(workspaceRoot);
}

/**
 * Check whether the daemon is currently running.
 * Returns true only if the PID file exists and the process is alive.
 */
export async function isDaemonRunning(workspaceRoot: string): Promise<boolean> {
    const lanesDir = path.join(workspaceRoot, LANES_DIR);
    const pidPath = path.join(lanesDir, PID_FILE);

    let pid: number;
    try {
        const content = await fs.readFile(pidPath, 'utf-8');
        pid = parseInt(content.trim(), 10);
    } catch {
        return false;
    }

    if (isNaN(pid)) {
        return false;
    }

    try {
        // Signal 0 checks process existence without sending a real signal
        process.kill(pid, 0);
        return true;
    } catch {
        // Process is dead — clean up stale PID/port files
        await removeLanesFile(lanesDir, PID_FILE);
        await removeLanesFile(lanesDir, PORT_FILE);
        return false;
    }
}

/**
 * Read the port number from `.lanes/daemon.port`.
 * Returns undefined if the file does not exist or its content is invalid.
 */
export async function getDaemonPort(workspaceRoot: string): Promise<number | undefined> {
    const portPath = path.join(workspaceRoot, LANES_DIR, PORT_FILE);
    try {
        const content = await fs.readFile(portPath, 'utf-8');
        const port = parseInt(content.trim(), 10);
        return isNaN(port) ? undefined : port;
    } catch {
        return undefined;
    }
}

/**
 * Read the PID from `.lanes/daemon.pid`.
 * Returns undefined if the file does not exist or its content is invalid.
 */
export async function getDaemonPid(workspaceRoot: string): Promise<number | undefined> {
    const pidPath = path.join(workspaceRoot, LANES_DIR, PID_FILE);
    try {
        const content = await fs.readFile(pidPath, 'utf-8');
        const pid = parseInt(content.trim(), 10);
        return isNaN(pid) ? undefined : pid;
    } catch {
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function removeLanesFile(lanesDir: string, fileName: string): Promise<void> {
    try {
        await fs.unlink(path.join(lanesDir, fileName));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }
}
