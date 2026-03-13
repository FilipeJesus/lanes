/**
 * Daemon Lifecycle - Start, stop, and query the machine-wide HTTP daemon.
 *
 * The daemon runs as a detached child process and stores PID/port files in
 * `~/.lanes/` so all tools can discover the same background process.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as syncFs from 'fs';
import { spawn } from 'child_process';
import { removeTokenFile } from './auth';
import { registerProject } from './registry';

const LANES_DIR = '.lanes';
const PID_FILE = 'daemon.pid';
const PORT_FILE = 'daemon.port';
const LOG_FILE = 'daemon.log';
const EARLY_EXIT_GRACE_MS = 300;

function getGlobalLanesDir(): string {
    return path.join(process.env.HOME || os.homedir(), LANES_DIR);
}

function getGlobalFilePath(fileName: string): string {
    return path.join(getGlobalLanesDir(), fileName);
}

export function getDaemonLogPath(): string {
    return getGlobalFilePath(LOG_FILE);
}

export interface StartDaemonOptions {
    /** Optional workspace root to auto-register when starting the global daemon. */
    workspaceRoot?: string;
    /** Port on which the daemon should listen. Defaults to 0 (OS-assigned). */
    port?: number;
    /** Absolute path to the daemon server entry-point script. */
    serverPath: string;
}

export async function startDaemon(options: StartDaemonOptions): Promise<void> {
    const { workspaceRoot, port = 0, serverPath } = options;

    if (await isDaemonRunning()) {
        if (workspaceRoot) {
            await registerProjectForDaemon(workspaceRoot);
        }
        return;
    }

    await fs.mkdir(getGlobalLanesDir(), { recursive: true });

    const args = [serverPath, '--port', String(port)];
    const logFd = syncFs.openSync(getDaemonLogPath(), 'a');
    const child = spawn(process.execPath, args, {
        detached: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env },
    });

    syncFs.closeSync(logFd);

    if (child.pid === undefined) {
        throw new Error('Failed to start daemon: child process has no PID');
    }

    await fs.writeFile(getGlobalFilePath(PID_FILE), String(child.pid), 'utf-8');
    try {
        await waitForEarlyExit(child.pid, child);
    } catch (err) {
        await removeGlobalFile(PID_FILE);
        throw err;
    }

    child.unref();

    if (workspaceRoot) {
        await registerProjectForDaemon(workspaceRoot);
    }
}

export async function stopDaemon(_workspaceRoot?: string): Promise<void> {
    const pid = await getDaemonPid();
    if (pid !== undefined && !isNaN(pid)) {
        try {
            process.kill(pid, 'SIGTERM');
        } catch {
            // Process may already be gone — ignore.
        }
    }

    await removeGlobalFile(PID_FILE);
    await removeGlobalFile(PORT_FILE);
    await removeTokenFile();
}

export async function isDaemonRunning(_workspaceRoot?: string): Promise<boolean> {
    const pid = await getDaemonPid();
    if (pid === undefined || isNaN(pid)) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        await removeGlobalFile(PID_FILE);
        await removeGlobalFile(PORT_FILE);
        return false;
    }
}

export async function waitForDaemonReady(timeoutMs = 5000, pollDelayMs = 200): Promise<number> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const port = await getDaemonPort();
        if (port !== undefined && port > 0) {
            return port;
        }

        await delay(pollDelayMs);
    }

    throw new Error(
        `Daemon did not become ready within ${timeoutMs}ms. Check ${getDaemonLogPath()} for details.`
    );
}

export async function getDaemonPort(_workspaceRoot?: string): Promise<number | undefined> {
    try {
        const content = await fs.readFile(getGlobalFilePath(PORT_FILE), 'utf-8');
        const port = parseInt(content.trim(), 10);
        return isNaN(port) ? undefined : port;
    } catch {
        return undefined;
    }
}

export async function getDaemonPid(_workspaceRoot?: string): Promise<number | undefined> {
    try {
        const content = await fs.readFile(getGlobalFilePath(PID_FILE), 'utf-8');
        const pid = parseInt(content.trim(), 10);
        return isNaN(pid) ? undefined : pid;
    } catch {
        return undefined;
    }
}

async function registerProjectForDaemon(workspaceRoot: string): Promise<void> {
    const resolved = path.resolve(workspaceRoot);
    await registerProject({
        projectId: '',
        workspaceRoot: resolved,
        projectName: path.basename(resolved),
        registeredAt: new Date().toISOString(),
    });
}

async function removeGlobalFile(fileName: string): Promise<void> {
    try {
        await fs.unlink(getGlobalFilePath(fileName));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }
}

async function waitForEarlyExit(pid: number, child: import('child_process').ChildProcess): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, EARLY_EXIT_GRACE_MS);

        const handleError = (err: Error) => {
            cleanup();
            reject(err);
        };

        const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
            cleanup();
            reject(
                new Error(
                    `Daemon process ${pid} exited before startup completed ` +
                    `(code=${code ?? 'null'}, signal=${signal ?? 'null'}). Check ${getDaemonLogPath()} for details.`
                )
            );
        };

        const cleanup = () => {
            clearTimeout(timer);
            child.off('error', handleError);
            child.off('exit', handleExit);
        };

        child.once('error', handleError);
        child.once('exit', handleExit);
    });
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
