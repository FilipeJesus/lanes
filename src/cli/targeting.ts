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
    }
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
