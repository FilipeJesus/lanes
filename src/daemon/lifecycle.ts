/**
 * Daemon Lifecycle - Start, stop, and query the machine-wide HTTP daemon.
 *
 * The daemon runs as a detached child process and stores PID/port files in
 * `~/.lanes/` so all tools can discover the same background process.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { readTokenFile, removeTokenFile } from './auth';
import { registerProject } from './registry';

const LANES_DIR = '.lanes';
const PID_FILE = 'daemon.pid';
const PORT_FILE = 'daemon.port';
const STARTED_AT_FILE = 'daemon.startedAt';

function getGlobalLanesDir(): string {
    return path.join(process.env.HOME || os.homedir(), LANES_DIR);
}

function getGlobalFilePath(fileName: string): string {
    return path.join(getGlobalLanesDir(), fileName);
}

export interface StartDaemonOptions {
    /** Optional workspace root to auto-register when starting the global daemon. */
    workspaceRoot?: string;
    /** Port on which the daemon should listen. Defaults to 0 (OS-assigned). */
    port?: number;
    /** Absolute path to the daemon server entry-point script. */
    serverPath: string;
}

export interface MachineDaemonState {
    pid: number;
    port: number;
    token: string;
    startedAt: string;
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
    const child = spawn(process.execPath, args, {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env },
    });
    child.unref();

    if (child.pid === undefined) {
        throw new Error('Failed to start daemon: child process has no PID');
    }

    await fs.writeFile(getGlobalFilePath(PID_FILE), String(child.pid), 'utf-8');
    if (port > 0) {
        await fs.writeFile(getGlobalFilePath(PORT_FILE), String(port), 'utf-8');
    }

    if (workspaceRoot) {
        await registerProjectForDaemon(workspaceRoot);
    }
}

export async function stopDaemon(): Promise<void> {
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
    await removeGlobalFile(STARTED_AT_FILE);
    await removeTokenFile();
}

export async function isDaemonRunning(): Promise<boolean> {
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
        await removeGlobalFile(STARTED_AT_FILE);
        await removeTokenFile();
        return false;
    }
}

export async function getDaemonPort(): Promise<number | undefined> {
    try {
        const content = await fs.readFile(getGlobalFilePath(PORT_FILE), 'utf-8');
        const port = parseInt(content.trim(), 10);
        return isNaN(port) ? undefined : port;
    } catch {
        return undefined;
    }
}

export async function getDaemonPid(): Promise<number | undefined> {
    try {
        const content = await fs.readFile(getGlobalFilePath(PID_FILE), 'utf-8');
        const pid = parseInt(content.trim(), 10);
        return isNaN(pid) ? undefined : pid;
    } catch {
        return undefined;
    }
}

export async function getDaemonStartedAt(): Promise<string | undefined> {
    try {
        const content = await fs.readFile(getGlobalFilePath(STARTED_AT_FILE), 'utf-8');
        const startedAt = content.trim();
        return startedAt || undefined;
    } catch {
        return undefined;
    }
}

async function getCompatibleDaemonStartedAt(): Promise<string> {
    const startedAt = await getDaemonStartedAt();
    if (startedAt !== undefined) {
        return startedAt;
    }

    try {
        const stat = await fs.stat(getGlobalFilePath(PID_FILE));
        return stat.mtime.toISOString();
    } catch {
        return new Date().toISOString();
    }
}

export async function getMachineDaemonState(): Promise<MachineDaemonState | undefined> {
    if (!(await isDaemonRunning())) {
        return undefined;
    }

    const [pid, port, startedAt] = await Promise.all([
        getDaemonPid(),
        getDaemonPort(),
        getCompatibleDaemonStartedAt(),
    ]);

    if (pid === undefined || port === undefined) {
        return undefined;
    }

    try {
        const token = await readTokenFile();
        return { pid, port, token, startedAt };
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
