/**
 * Daemon Lifecycle - Start, stop, and query the machine-wide HTTP daemon.
 *
 * The daemon runs as a detached child process and stores PID/port files in
 * `~/.lanes/` so all tools can discover the same background process.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { removeTokenFile } from './auth';
import { registerProject } from './registry';

const LANES_DIR = '.lanes';
const PID_FILE = 'daemon.pid';
const PORT_FILE = 'daemon.port';
const LOG_FILE = 'daemon.log';
const STARTUP_TIMEOUT_MS = 5_000;
const STARTUP_POLL_INTERVAL_MS = 100;
const DEFAULT_LOG_TAIL_LINES = 25;

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
    /** Startup timeout in milliseconds. */
    startupTimeoutMs?: number;
}

export interface StartDaemonResult {
    pid: number;
    port: number;
    logPath: string;
    reusedExisting: boolean;
}

export interface DaemonDiagnostics {
    running: boolean;
    pid?: number;
    port?: number;
    logPath: string;
    logTail: string[];
}

export class DaemonStartupError extends Error {
    constructor(
        message: string,
        public readonly reason: string,
        public readonly diagnostics: DaemonDiagnostics,
        public readonly exitCode?: number | null,
        public readonly signal?: NodeJS.Signals | null
    ) {
        super(message);
        this.name = 'DaemonStartupError';
    }
}

export function getDaemonErrorSummary(err: unknown): string {
    if (err instanceof DaemonStartupError) {
        const lastLogLine = err.diagnostics.logTail.at(-1);
        const parts = [
            `Failed to start daemon: ${err.reason}.`,
            `Log: ${err.diagnostics.logPath}.`,
        ];
        if (lastLogLine) {
            parts.push(`Last log line: ${lastLogLine}`);
        }
        return parts.join(' ');
    }

    if (err instanceof Error) {
        return err.message;
    }

    return String(err);
}

export async function startDaemon(options: StartDaemonOptions): Promise<StartDaemonResult> {
    const { workspaceRoot, port = 0, serverPath, startupTimeoutMs = STARTUP_TIMEOUT_MS } = options;

    if (await isDaemonRunning()) {
        const runningState = await waitForDaemonReady({ timeoutMs: startupTimeoutMs });
        if (workspaceRoot) {
            await registerProjectForDaemon(workspaceRoot);
        }

        return {
            pid: runningState.pid,
            port: runningState.port,
            logPath: getDaemonLogPath(),
            reusedExisting: true,
        };
    }

    await fs.mkdir(getGlobalLanesDir(), { recursive: true });
    const logPath = getDaemonLogPath();

    const args = [serverPath, '--port', String(port)];
    const logFd = fsSync.openSync(logPath, 'a');
    const child: ChildProcess = (() => {
        try {
            return spawn(process.execPath, args, {
                detached: true,
                stdio: ['ignore', logFd, logFd],
                env: { ...process.env },
            });
        } finally {
            fsSync.closeSync(logFd);
        }
    })();

    if (child.pid === undefined) {
        throw new Error('Failed to start daemon: child process has no PID');
    }

    const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
        child.once('error', reject);
    });

    const readyState = await waitForDaemonReady({
        timeoutMs: startupTimeoutMs,
        expectedPid: child.pid,
        exitPromise,
    });

    if (workspaceRoot) {
        await registerProjectForDaemon(workspaceRoot);
    }

    child.unref();

    return {
        pid: readyState.pid,
        port: readyState.port,
        logPath,
        reusedExisting: false,
    };
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
    await removeTokenFile().catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    });
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

export function getDaemonLogPath(): string {
    return getGlobalFilePath(LOG_FILE);
}

export async function readDaemonLogTail(maxLines = DEFAULT_LOG_TAIL_LINES): Promise<string[]> {
    try {
        const content = await fs.readFile(getDaemonLogPath(), 'utf-8');
        return content
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0)
            .slice(-Math.max(1, maxLines));
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw err;
    }
}

export async function getDaemonDiagnostics(maxLogLines = DEFAULT_LOG_TAIL_LINES): Promise<DaemonDiagnostics> {
    const [pid, port, logTail] = await Promise.all([
        getDaemonPid(),
        getDaemonPort(),
        readDaemonLogTail(maxLogLines),
    ]);

    return {
        running: pid !== undefined ? await isProcessRunning(pid) : false,
        pid,
        port,
        logPath: getDaemonLogPath(),
        logTail,
    };
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

async function waitForDaemonReady(options: {
    timeoutMs: number;
    expectedPid?: number;
    exitPromise?: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}): Promise<{ pid: number; port: number }> {
    const deadline = Date.now() + options.timeoutMs;

    while (Date.now() < deadline) {
        const pid = await getDaemonPid();
        const port = await getDaemonPort();

        if (
            pid !== undefined &&
            port !== undefined &&
            port > 0 &&
            (options.expectedPid === undefined || pid === options.expectedPid) &&
            await isProcessRunning(pid)
        ) {
            return { pid, port };
        }

        const remainingMs = deadline - Date.now();
        const nextDelayMs = Math.min(STARTUP_POLL_INTERVAL_MS, Math.max(remainingMs, 0));
        if (nextDelayMs === 0) {
            break;
        }

        if (options.exitPromise) {
            const outcome = await Promise.race([
                options.exitPromise.then((result) => ({ type: 'exit' as const, result })),
                delay(nextDelayMs).then(() => ({ type: 'poll' as const })),
            ]);

            if (outcome.type === 'exit') {
                await cleanupDaemonRuntimeFiles();
                throw await createDaemonStartupError(
                    describeExit(outcome.result.code, outcome.result.signal),
                    outcome.result.code,
                    outcome.result.signal
                );
            }
        } else {
            await delay(nextDelayMs);
        }
    }

    await terminateDaemonProcess(options.expectedPid);
    await cleanupDaemonRuntimeFiles();
    throw await createDaemonStartupError(`daemon did not become ready within ${options.timeoutMs}ms`);
}

async function createDaemonStartupError(
    reason: string,
    exitCode?: number | null,
    signal?: NodeJS.Signals | null
): Promise<DaemonStartupError> {
    const diagnostics = await getDaemonDiagnostics();
    const recentLogLines = diagnostics.logTail.slice(-5);
    const messageParts = [
        `Failed to start daemon: ${reason}.`,
        `Log: ${diagnostics.logPath}.`,
    ];

    if (recentLogLines.length > 0) {
        messageParts.push(`Recent log output:\n${recentLogLines.join('\n')}`);
    } else {
        messageParts.push('The daemon log is empty.');
    }

    return new DaemonStartupError(messageParts.join('\n'), reason, diagnostics, exitCode, signal);
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
    if (code !== null) {
        return `process exited with code ${code}`;
    }
    if (signal !== null) {
        return `process exited after signal ${signal}`;
    }
    return 'process exited before reporting readiness';
}

async function isProcessRunning(pid: number): Promise<boolean> {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function cleanupDaemonRuntimeFiles(): Promise<void> {
    await Promise.all([
        removeGlobalFile(PID_FILE),
        removeGlobalFile(PORT_FILE),
        removeTokenFile().catch((err: unknown) => {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw err;
            }
        }),
    ]);
}

async function terminateDaemonProcess(pid: number | undefined): Promise<void> {
    if (pid === undefined || Number.isNaN(pid)) {
        return;
    }

    try {
        process.kill(pid, 'SIGTERM');
    } catch {
        // Process may already be gone.
    }
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
