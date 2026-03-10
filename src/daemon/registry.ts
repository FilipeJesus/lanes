/**
 * Global daemon and project registries.
 *
 * `~/.lanes/daemons.json` tracks live per-workspace daemon processes.
 * `~/.lanes/projects.json` tracks known workspaces that were explicitly
 * registered with the machine-wide gateway.
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

/**
 * A workspace registered with the machine-wide gateway.
 */
export type RegisteredProjectEntry = {
    /** Absolute path to the workspace root this project serves. */
    workspaceRoot: string;
    /** Human-readable project name (typically the workspace directory name). */
    projectName: string;
    /** ISO-8601 timestamp of when the project was registered. */
    registeredAt: string;
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

/**
 * Returns the absolute path to the global project registry file:
 * `~/.lanes/projects.json`.
 */
export function getProjectsRegistryPath(): string {
    return path.join(os.homedir(), '.lanes', 'projects.json');
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
 * Read a registry file from disk.
 * Returns an empty array if the file does not exist or is malformed.
 */
async function readRegistryFile<T>(registryPath: string): Promise<T[]> {
    try {
        const content = await fs.readFile(registryPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return parsed as T[];
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
 * Write entries to a registry atomically using a temp file + rename.
 * This prevents corruption if the process is interrupted mid-write.
 */
async function writeRegistryFile<T>(registryPath: string, entries: T[]): Promise<void> {
    await ensureRegistryDir();
    const tempPath = `${registryPath}.tmp`;

    await fs.writeFile(tempPath, JSON.stringify(entries, null, 2), { encoding: 'utf-8', mode: 0o600 });
    await fs.rename(tempPath, registryPath);
}

async function readDaemonRegistry(): Promise<DaemonRegistryEntry[]> {
    return readRegistryFile<DaemonRegistryEntry>(getRegistryPath());
}

async function writeDaemonRegistry(entries: DaemonRegistryEntry[]): Promise<void> {
    await writeRegistryFile(getRegistryPath(), entries);
}

async function readProjectsRegistry(): Promise<RegisteredProjectEntry[]> {
    return readRegistryFile<RegisteredProjectEntry>(getProjectsRegistryPath());
}

async function writeProjectsRegistry(entries: RegisteredProjectEntry[]): Promise<void> {
    await writeRegistryFile(getProjectsRegistryPath(), entries);
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
    const existing = await readDaemonRegistry();
    const filtered = existing.filter((e) => e.workspaceRoot !== entry.workspaceRoot);
    filtered.push(entry);
    await writeDaemonRegistry(filtered);
}

/**
 * Remove the daemon entry for the given workspace root from the global registry.
 * Does nothing if no entry for that workspace exists.
 */
export async function deregisterDaemon(workspaceRoot: string): Promise<void> {
    const existing = await readDaemonRegistry();
    const filtered = existing.filter((e) => e.workspaceRoot !== workspaceRoot);
    if (filtered.length !== existing.length) {
        await writeDaemonRegistry(filtered);
    }
}

/**
 * Return all entries currently in the global registry (no liveness check).
 */
export async function listRegisteredDaemons(): Promise<DaemonRegistryEntry[]> {
    return readDaemonRegistry();
}

/**
 * Remove registry entries whose daemon process is no longer alive.
 * Uses `process.kill(pid, 0)` to test liveness without sending a real signal.
 * Returns the remaining live entries.
 */
export async function cleanStaleEntries(): Promise<DaemonRegistryEntry[]> {
    const existing = await readDaemonRegistry();

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
        await writeDaemonRegistry(liveEntries);
    }

    return liveEntries;
}

/**
 * Register (or update) a project in the global project registry.
 */
export async function registerProject(entry: RegisteredProjectEntry): Promise<void> {
    const existing = await readProjectsRegistry();
    const filtered = existing.filter((project) => project.workspaceRoot !== entry.workspaceRoot);
    filtered.push(entry);
    await writeProjectsRegistry(filtered);
}

/**
 * Remove a project from the global project registry.
 */
export async function deregisterProject(workspaceRoot: string): Promise<void> {
    const existing = await readProjectsRegistry();
    const filtered = existing.filter((project) => project.workspaceRoot !== workspaceRoot);
    if (filtered.length !== existing.length) {
        await writeProjectsRegistry(filtered);
    }
}

/**
 * Return all explicitly registered projects.
 */
export async function listRegisteredProjects(): Promise<RegisteredProjectEntry[]> {
    return readProjectsRegistry();
}
