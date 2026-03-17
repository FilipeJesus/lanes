import { Command } from 'commander';
import { DaemonClient } from '../daemon/client';
import {
    listRegisteredRemoteDaemons,
    normalizeDaemonBaseUrl,
    type RegisteredRemoteDaemonEntry,
} from '../daemon/registry';
import { execGit } from '../core/gitService';

export interface CliDaemonTargetOptions {
    host?: string;
    verbose?: boolean;
    trace?: (message: string) => void;
}

export interface CliLocalDaemonTarget {
    kind: 'local';
    client: DaemonClient;
}

export interface CliRemoteDaemonTarget {
    kind: 'remote';
    host: string;
    client: DaemonClient;
}

export type CliDaemonTarget = CliLocalDaemonTarget | CliRemoteDaemonTarget;

const DAEMON_TARGET_COMMAND_PATHS = [
    ['list'],
    ['status'],
    ['create'],
    ['open'],
    ['delete'],
    ['clear'],
    ['diff'],
    ['insights'],
    ['repair'],
    ['config'],
    ['workflow', 'list'],
    ['workflow', 'create'],
    ['workflow', 'validate'],
] as const;

function createVerboseTraceWriter(options: CliDaemonTargetOptions) {
    if (options.trace) {
        return options.trace;
    }

    if (!options.verbose) {
        return undefined;
    }

    return (message: string) => {
        console.error(`[lanes verbose] ${message}`);
    };
}

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
        const scpLikeMatch = trimmed.match(/^([^@]+)@([^:]+):(.+)$/);
        if (scpLikeMatch) {
            const [, , host, remotePath] = scpLikeMatch;
            return `${host}:${remotePath}`;
        }
    }
    return trimmed;
}

function normalizeGitRemoteForMatching(remote: string): string {
    const sanitized = sanitizeGitRemoteUrl(remote);

    const scpLikeMatch = !sanitized.includes('://')
        ? sanitized.match(/^(?:[^@]+@)?([^:]+):(.+)$/)
        : null;
    if (scpLikeMatch) {
        const [, host, remotePath] = scpLikeMatch;
        return `${host.toLowerCase()}/${remotePath.replace(/^\/+/, '').replace(/\.git$/i, '')}`;
    }

    try {
        const parsed = new URL(sanitized);
        const normalizedPath = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '');
        return `${parsed.hostname.toLowerCase()}/${normalizedPath}`;
    } catch {
        // Fall through to the sanitized string for unknown remote formats.
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
    workspaceRoot: string,
    options: CliDaemonTargetOptions = {}
): Promise<string> {
    const trace = createVerboseTraceWriter(options);
    trace?.(`Resolving remote daemon project on ${registration.baseUrl} for workspace ${workspaceRoot}`);
    const localGitRemote = await getOriginRemoteUrl(workspaceRoot);
    const normalizedLocalGitRemote = normalizeGitRemoteForMatching(localGitRemote);
    trace?.(`Local git remote for matching: ${localGitRemote}`);
    const rootClient = new DaemonClient({
        baseUrl: registration.baseUrl,
        token: registration.token,
        verbose: options.verbose,
        trace,
    });
    const { projects } = await rootClient.listProjects();
    trace?.(`Inspecting ${projects.length} project(s) exposed by ${registration.baseUrl}`);

    const matches: Array<{ projectId: string; projectName: string }> = [];
    const discoveryFailures: Error[] = [];
    await Promise.all(
        projects.map(async (project) => {
            try {
                trace?.(`Checking remote project ${project.projectName} (${project.projectId})`);
                const projectClient = new DaemonClient({
                    baseUrl: registration.baseUrl,
                    token: registration.token,
                    projectId: project.projectId,
                    verbose: options.verbose,
                    trace,
                });
                const discovery = await projectClient.discovery();
                if (discovery.gitRemote) {
                    const normalizedDiscoveryRemote = normalizeGitRemoteForMatching(discovery.gitRemote);
                    if (normalizedDiscoveryRemote === normalizedLocalGitRemote) {
                        matches.push({
                            projectId: project.projectId,
                            projectName: project.projectName,
                        });
                        trace?.(`Matched remote project ${project.projectName} (${project.projectId})`);
                    }
                }
            } catch (err) {
                trace?.(
                    `Remote project discovery failed for ${project.projectName} (${project.projectId}): ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
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

function resolveCommandPath(root: Command, path: readonly string[]): Command {
    let command = root;
    for (const segment of path) {
        const next = command.commands.find((entry) => entry.name() === segment);
        if (!next) {
            throw new Error(`Unable to apply daemon targeting: command path ${path.join(' ')} was not registered.`);
        }
        command = next;
    }
    return command;
}

export function applyCliDaemonTargeting(program: Command): void {
    for (const commandPath of DAEMON_TARGET_COMMAND_PATHS) {
        const command = resolveCommandPath(program, commandPath);
        const hasHostOption = command.options.some((option) => option.long === '--host');
        if (!hasHostOption) {
            command.option(
                '--host <url>',
                'Target a registered remote daemon by base URL instead of the local daemon'
            );
        }

        const hasVerboseOption = command.options.some((option) => option.long === '--verbose');
        if (!hasVerboseOption) {
            command.option(
                '--verbose',
                'Show verbose daemon API tracing output'
            );
        }
    }
}

export async function createCliDaemonClient(
    workspaceRoot: string,
    options: CliDaemonTargetOptions = {}
): Promise<DaemonClient> {
    const trace = createVerboseTraceWriter(options);
    if (!options.host) {
        trace?.(`Using local daemon target for ${workspaceRoot}`);
        if (!options.verbose && !options.trace) {
            return DaemonClient.fromWorkspace(workspaceRoot);
        }
        return DaemonClient.fromWorkspace(workspaceRoot, { verbose: options.verbose, trace });
    }

    trace?.(`Using remote daemon target ${options.host}`);
    const registration = await getRegisteredRemoteDaemon(options.host);
    const projectId = await resolveRemoteProjectId(registration, workspaceRoot, options);
    return new DaemonClient({
        baseUrl: registration.baseUrl,
        token: registration.token,
        projectId,
        verbose: options.verbose,
        trace,
    });
}

export async function resolveCliDaemonTarget(
    workspaceRoot: string,
    options: CliDaemonTargetOptions = {}
): Promise<CliDaemonTarget> {
    if (!options.host) {
        return {
            kind: 'local',
            client: await createCliDaemonClient(workspaceRoot, options),
        };
    }

    return {
        kind: 'remote',
        host: normalizeDaemonBaseUrl(options.host),
        client: await createCliDaemonClient(workspaceRoot, options),
    };
}

export async function withCliDaemonTarget<T>(
    workspaceRoot: string,
    options: CliDaemonTargetOptions,
    handlers: {
        local: (target: CliLocalDaemonTarget) => Promise<T>;
        daemon: (target: CliRemoteDaemonTarget) => Promise<T>;
    }
): Promise<T> {
    const target = await resolveCliDaemonTarget(workspaceRoot, options);
    if (target.kind === 'remote') {
        return handlers.daemon(target);
    }
    return handlers.local(target);
}
