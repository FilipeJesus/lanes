/**
 * Daemon Registry - Global registry of running daemon instances
 *
 * Maintains a JSON registry at `~/.lanes/daemons.json` that tracks all running
 * daemon instances across workspaces. This allows tools (CLI, IDE plugins) to
 * discover daemons without knowing each workspace path in advance.
 *
 * The registry is written atomically (write to temp + rename) to prevent
 * corruption from concurrent access.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single entry in the global daemon registry.
 */
export type DaemonRegistryEntry = {
    /** Absolute path to the workspace root this daemon serves. */
    workspaceRoot: string;
    /** Port number the daemon is listening on. */
    port: number;
    /** OS process ID of the daemon process. */
    pid: number;
    /** Bearer token for authenticating requests to this daemon. */
    token: string;
    /** ISO-8601 timestamp of when the daemon was started. */
    startedAt: string;
    /** Human-readable project name (typically the workspace directory name). */
    projectName: string;
};

// ---------------------------------------------------------------------------
// Registry path
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the global registry file: `~/.lanes/daemons.json`.
 */
export function getRegistryPath(): string {
    return path.join(os.homedir(), '.lanes', 'daemons.json');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the `~/.lanes/` directory exists.
 */
async function ensureRegistryDir(): Promise<void> {
    const registryDir = path.join(os.homedir(), '.lanes');
    await fs.mkdir(registryDir, { recursive: true });
}

/**
 * Read the current registry from disk.
 * Returns an empty array if the file does not exist or is malformed.
 */
async function readRegistry(): Promise<DaemonRegistryEntry[]> {
    const registryPath = getRegistryPath();
    try {
        const content = await fs.readFile(registryPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return parsed as DaemonRegistryEntry[];
        }
        return [];
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        if (err instanceof SyntaxError) {
            // Malformed JSON — start fresh
            return [];
        }
        // Permission errors, disk failures, etc. — propagate
        throw err;
    }
}

/**
 * Write entries to the registry atomically using a temp file + rename.
 * This prevents corruption if the process is interrupted mid-write.
 */
async function writeRegistry(entries: DaemonRegistryEntry[]): Promise<void> {
    await ensureRegistryDir();
    const registryPath = getRegistryPath();
    const tempPath = `${registryPath}.tmp`;

    await fs.writeFile(tempPath, JSON.stringify(entries, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tempPath, registryPath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register (or update) a daemon entry in the global registry.
 * If an entry with the same `workspaceRoot` already exists, it is replaced.
 *
 * Note: The read-modify-write cycle is not concurrency-safe across processes.
 * If two daemons register simultaneously, one entry may be lost. In practice
 * this is rare since daemon starts are user-initiated and sequential.
 */
export async function registerDaemon(entry: DaemonRegistryEntry): Promise<void> {
    const existing = await readRegistry();
    const filtered = existing.filter((e) => e.workspaceRoot !== entry.workspaceRoot);
    filtered.push(entry);
    await writeRegistry(filtered);
}

/**
 * Remove the daemon entry for the given workspace root from the global registry.
 * Does nothing if no entry for that workspace exists.
 */
export async function deregisterDaemon(workspaceRoot: string): Promise<void> {
    const existing = await readRegistry();
    const filtered = existing.filter((e) => e.workspaceRoot !== workspaceRoot);
    if (filtered.length !== existing.length) {
        await writeRegistry(filtered);
    }
}

/**
 * Return all entries currently in the global registry (no liveness check).
 */
export async function listRegisteredDaemons(): Promise<DaemonRegistryEntry[]> {
    return readRegistry();
}

/**
 * Remove registry entries whose daemon process is no longer alive.
 * Uses `process.kill(pid, 0)` to test liveness without sending a real signal.
 * Returns the remaining live entries.
 */
export async function cleanStaleEntries(): Promise<DaemonRegistryEntry[]> {
    const existing = await readRegistry();

    const liveEntries = existing.filter((entry) => {
        try {
            // Signal 0 checks process existence without sending a real signal
            process.kill(entry.pid, 0);
            return true;
        } catch {
            // ESRCH: no such process — entry is stale
            return false;
        }
    });

    if (liveEntries.length !== existing.length) {
        await writeRegistry(liveEntries);
    }

    return liveEntries;
}
