/**
 * CLI utility functions shared across commands.
 */

import * as path from 'path';
import { Command } from 'commander';
import { execGit, initializeGitPath } from '../core/gitService';
import { fileExists } from '../core/services/FileService';
import * as SettingsService from '../core/services/SettingsService';
import { CliConfigProvider } from './adapters/CliConfigProvider';
import { CliGitPathResolver } from './adapters/CliGitPathResolver';
import { setConfigCallbacks, initializeGlobalStorageContext } from '../core/session/SessionDataService';
import { DaemonClient } from '../daemon/client';
import type { DaemonSessionCreateResponse, DaemonSessionOpenResponse } from '../daemon/contracts';
import {
    listRegisteredRemoteDaemons,
    normalizeDaemonBaseUrl,
    type RegisteredRemoteDaemonEntry,
} from '../daemon/registry';

export interface CliDaemonTargetOptions {
    host?: string;
}

type RemoteSessionLaunch = DaemonSessionCreateResponse | DaemonSessionOpenResponse;

function sanitizeGitRemoteUrl(remote: string): string {
    const trimmed = remote.trim();
    try {
        const parsed = new URL(trimmed);
        if (parsed.username || parsed.password) {
            parsed.username = '';
            parsed.password = '';
            return parsed.toString();
        }
    } catch {
        // SCP-like git remotes (git@github.com:org/repo.git) are already token-free.
    }
    return trimmed;
}

function normalizeGitRemoteForMatching(remote: string): string {
    const sanitized = sanitizeGitRemoteUrl(remote);

    try {
        const parsed = new URL(sanitized);
        const normalizedPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
        return `${parsed.hostname.toLowerCase()}/${normalizedPath}`;
    } catch {
        const scpLikeMatch = sanitized.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
        if (scpLikeMatch) {
            const [, host, remotePath] = scpLikeMatch;
            return `${host.toLowerCase()}/${remotePath.replace(/^\/+/, '').replace(/\.git$/i, '')}`;
        }
    }

    return sanitized;
}

async function getOriginRemoteUrl(workspaceRoot: string): Promise<string> {
    try {
        const remote = await execGit(['remote', 'get-url', 'origin'], workspaceRoot);
        return sanitizeGitRemoteUrl(remote);
    } catch {
        throw new Error(
            'Unable to resolve the current repository on a remote daemon because this repo has no origin remote URL.'
        );
    }
}

async function getRegisteredRemoteDaemon(host: string): Promise<RegisteredRemoteDaemonEntry> {
    const normalizedHost = normalizeDaemonBaseUrl(host);
    const registrations = await listRegisteredRemoteDaemons();
    const registration = registrations.find((entry) => entry.baseUrl === normalizedHost);
    if (!registration) {
        throw new Error(
            `Remote daemon ${normalizedHost} is not registered. Register it first with ` +
            `"lanes daemon register --host ${normalizedHost} --token <token>".`
        );
    }
    return registration;
}

async function resolveRemoteProjectId(
    registration: RegisteredRemoteDaemonEntry,
    workspaceRoot: string
): Promise<string> {
    const localGitRemote = await getOriginRemoteUrl(workspaceRoot);
    const normalizedLocalGitRemote = normalizeGitRemoteForMatching(localGitRemote);
    const rootClient = new DaemonClient({
        baseUrl: registration.baseUrl,
        token: registration.token,
    });
    const { projects } = await rootClient.listProjects();

    const matches: Array<{ projectId: string; projectName: string }> = [];
    const discoveryFailures: Error[] = [];
    await Promise.all(
        projects.map(async (project) => {
            try {
                const projectClient = new DaemonClient({
                    baseUrl: registration.baseUrl,
                    token: registration.token,
                    projectId: project.projectId,
                });
                const discovery = await projectClient.discovery();
                if (discovery.gitRemote) {
                    const normalizedDiscoveryRemote = normalizeGitRemoteForMatching(discovery.gitRemote);
                    if (normalizedDiscoveryRemote === normalizedLocalGitRemote) {
                        matches.push({
                            projectId: project.projectId,
                            projectName: project.projectName,
                        });
                    }
                }
            } catch (err) {
                discoveryFailures.push(err instanceof Error ? err : new Error(String(err)));
            }
        })
    );

    if (matches.length === 1) {
        return matches[0].projectId;
    }
    if (matches.length > 1) {
        throw new Error(
            `Remote daemon ${registration.baseUrl} matched multiple projects for ${localGitRemote}: ` +
            `${matches.map((match) => match.projectName).join(', ')}.`
        );
    }
    if (projects.length > 0 && discoveryFailures.length === projects.length) {
        throw new Error(
            `Failed to inspect projects on remote daemon ${registration.baseUrl}: ${discoveryFailures[0].message}`
        );
    }

    throw new Error(
        `Remote daemon ${registration.baseUrl} does not track a project matching ${localGitRemote}.`
        + (discoveryFailures.length > 0
            ? ` ${discoveryFailures.length} project discovery request(s) failed while resolving the match.`
            : '')
    );
}

export function addDaemonHostOption(command: Command): Command {
    return command.option(
        '--host <url>',
        'Target a registered remote daemon by base URL instead of the local daemon'
    );
}

export async function createCliDaemonClient(
    workspaceRoot: string,
    options: CliDaemonTargetOptions = {}
): Promise<DaemonClient> {
    if (!options.host) {
        return DaemonClient.fromWorkspace(workspaceRoot);
    }

    const registration = await getRegisteredRemoteDaemon(options.host);
    const projectId = await resolveRemoteProjectId(registration, workspaceRoot);
    return new DaemonClient({
        baseUrl: registration.baseUrl,
        token: registration.token,
        projectId,
    });
}

function printRemoteLaunchDetails(host: string | undefined, launch: RemoteSessionLaunch): void {
    if (host) {
        console.log(`Remote daemon: ${host}`);
    }
    console.log(`Worktree: ${launch.worktreePath}`);
    if (launch.attachCommand) {
        console.log(`Attach: ${launch.attachCommand}`);
    } else {
        console.log(`Launch: ${launch.command}`);
    }
}

export async function attachCliToRemoteSession(
    client: DaemonClient,
    sessionName: string,
    launch: RemoteSessionLaunch,
    options: CliDaemonTargetOptions = {}
): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        printRemoteLaunchDetails(options.host, launch);
        return;
    }

    let terminalName = launch.tmuxSessionName;
    if (!terminalName) {
        const terminal = await client.createTerminal({
            sessionName,
            command: launch.command,
        });
        terminalName = terminal.terminalName;
    }

    let lastContent = '';
    let streamClosed = false;
    let settled = false;

    await client.resizeTerminal(
        terminalName,
        process.stdout.columns || 80,
        process.stdout.rows || 24
    ).catch(() => {});

    const restoreRawMode = process.stdin.isTTY ? process.stdin.setRawMode.bind(process.stdin) : undefined;

    await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            if (settled) {
                return;
            }
            settled = true;
            streamClosed = true;
            stream.close();
            process.stdout.off('resize', handleResize);
            process.stdin.off('data', handleInput);
            process.off('SIGINT', handleSigint);
            if (restoreRawMode) {
                restoreRawMode(false);
            }
            process.stdin.pause();
            process.stdout.write('\n');
        };

        const finish = () => {
            cleanup();
            resolve();
        };

        const fail = (err: Error) => {
            cleanup();
            reject(err);
        };

        const handleResize = () => {
            void client.resizeTerminal(
                terminalName!,
                process.stdout.columns || 80,
                process.stdout.rows || 24
            ).catch(() => {});
        };

        const handleInput = (chunk: Buffer) => {
            if (chunk.length === 1 && chunk[0] === 3) {
                finish();
                return;
            }

            void client.sendToTerminal(terminalName!, chunk.toString('utf-8')).catch((err) => {
                fail(err instanceof Error ? err : new Error(String(err)));
            });
        };

        const handleSigint = () => finish();

        const stream = client.streamTerminalOutput(terminalName, {
            onData: (data) => {
                if (streamClosed || data.content === lastContent) {
                    return;
                }
                lastContent = data.content;
                process.stdout.write('\x1bc');
                process.stdout.write(data.content);
            },
            onError: (err) => fail(err),
        });

        process.stdout.on('resize', handleResize);
        process.stdin.on('data', handleInput);
        process.on('SIGINT', handleSigint);
        if (restoreRawMode) {
            restoreRawMode(true);
        }
        process.stdin.resume();
        process.stdout.write('Connected to remote session. Press Ctrl-C to detach.\n');
    });
}

/**
 * Resolve the base repo root from a workspace path.
 * Handles being run from inside a worktree.
 */
export async function resolveRepoRootFromPath(workspacePath: string): Promise<string> {
    const resolvedPath = path.resolve(workspacePath);

    // Find the git toplevel (handles running from subdirectories)
    let toplevel: string;
    if (await fileExists(path.join(resolvedPath, '.git'))) {
        toplevel = resolvedPath;
    } else {
        try {
            const result = await execGit(['rev-parse', '--show-toplevel'], resolvedPath);
            toplevel = result.trim();
        } catch {
            throw new Error('Not a git repository. Run from inside a git repo or run "git init" first.');
        }
    }

    // Always resolve to base repo root (handles worktree paths)
    return SettingsService.getBaseRepoPath(toplevel);
}

/**
 * Resolve the base repo root from the current working directory.
 */
export async function resolveRepoRoot(): Promise<string> {
    return resolveRepoRootFromPath(process.cwd());
}

/**
 * Initialize git path resolution for CLI commands that do not need full config.
 */
export async function initCliGit(): Promise<void> {
    const gitResolver = new CliGitPathResolver();
    const gitPath = await gitResolver.resolveGitPath();
    initializeGitPath(gitPath);
}

/**
 * Resolve the package root directory (parent of `out/` where the bundled CLI lives).
 * Used to locate built-in assets like workflow templates.
 */
export function getPackageRoot(): string {
    return path.resolve(__dirname, '..');
}

/**
 * Initialize the CLI environment: git path, config, session data service.
 * Returns the config provider and repo root for use by commands.
 */
export async function initCli(): Promise<{ config: CliConfigProvider; repoRoot: string }> {
    await initCliGit();

    // Resolve repo root
    const repoRoot = await resolveRepoRoot();

    // Load config
    const config = new CliConfigProvider(repoRoot);
    await config.load();

    // Wire up SessionDataService config callbacks
    setConfigCallbacks({
        getWorktreesFolder: () => config.get('lanes', 'worktreesFolder', '.worktrees'),
        getPromptsFolder: () => config.get('lanes', 'promptsFolder', ''),
    });

    // Initialize storage context (CLI uses repo-local paths)
    initializeGlobalStorageContext(
        path.join(repoRoot, '.lanes'),
        repoRoot,
        undefined  // Agent set per-command
    );

    return { config, repoRoot };
}

// Re-export from core for backward compatibility
export { getBranchesInWorktrees } from '../core/services/BrokenWorktreeService';

/**
 * Print an error message and exit with code 1.
 */
export function exitWithError(message: string): never {
    console.error(`Error: ${message}`);
    process.exit(1);
}
