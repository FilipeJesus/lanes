/**
 * `lanes daemon` — Manage the background Lanes daemon process.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCliGit, resolveRepoRoot, resolveRepoRootFromPath, exitWithError } from '../utils';
import { DaemonClient } from '../../daemon/client';
import {
    startDaemon,
    stopDaemon,
    isDaemonRunning,
    getDaemonPort,
    getDaemonPid,
    getDaemonLogPath,
    readDaemonLogTail,
    getDaemonErrorSummary,
} from '../../daemon/lifecycle';
import {
    deregisterRemoteDaemon,
    registerProject,
    registerRemoteDaemon,
    deregisterProject,
    listRegisteredProjects,
    listRegisteredRemoteDaemons,
} from '../../daemon/registry';

function isRemoteRegistration(options: { host?: string; token?: string }): boolean {
    return typeof options.host === 'string' && options.host.trim().length > 0;
}

export function registerDaemonCommand(program: Command): void {
    const daemon = program
        .command('daemon')
        .description('Manage the background Lanes daemon process');

    daemon
        .command('start')
        .description('Start the daemon process')
        .option('--port <port>', 'Port for the daemon to listen on (default: OS-assigned)', '0')
        .action(async (options) => {
            try {
                await initCliGit();
                const port = parseInt(options.port, 10);
                let repoRoot: string | undefined;

                try {
                    repoRoot = await resolveRepoRoot();
                } catch {
                    repoRoot = undefined;
                }

                if (isNaN(port) || port < 0 || port > 65535) {
                    exitWithError(`Invalid port: ${options.port}. Must be a number between 0 and 65535.`);
                }

                const serverPath = path.resolve(__dirname, 'daemon.js');
                const result = await startDaemon({ workspaceRoot: repoRoot, port, serverPath });
                const action = result.reusedExisting ? 'Daemon already running' : 'Daemon started successfully';
                console.log(`${action} on port ${result.port}.`);
                console.log(`Log: ${result.logPath}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });

    daemon
        .command('register')
        .description('Register a project with the machine-wide Lanes gateway')
        .argument('[workspace]', 'Workspace to register (default: current directory)', '.')
        .option('--host <url>', 'Register a remote daemon by base URL instead of a local workspace')
        .option('--token <token>', 'Bearer token for the remote daemon when using --host')
        .option('--verbose', 'Show verbose daemon API tracing output')
        .action(async (workspaceArg: string, options: { host?: string; token?: string; verbose?: boolean }) => {
            try {
                if (isRemoteRegistration(options)) {
                    if (!options.token) {
                        exitWithError('Remote daemon registration requires --token.');
                    }
                    const client = new DaemonClient({
                        baseUrl: options.host!,
                        token: options.token,
                        verbose: options.verbose,
                    });
                    const { projects } = await client.listProjects();
                    await registerRemoteDaemon({
                        registrationId: '',
                        baseUrl: options.host!,
                        token: options.token,
                        registeredAt: new Date().toISOString(),
                        discoveredProjects: projects,
                        lastSeenAt: new Date().toISOString(),
                    });
                    console.log(`Registered remote daemon ${options.host!}.`);
                    return;
                }

                await initCliGit();
                const workspaceRoot = await resolveRepoRootFromPath(workspaceArg);
                const projectName = path.basename(workspaceRoot);
                await registerProject({
                    projectId: '',
                    workspaceRoot,
                    projectName,
                    registeredAt: new Date().toISOString(),
                });

                console.log(`Registered project "${projectName}" at ${workspaceRoot}.`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });

    daemon
        .command('unregister')
        .description('Remove a project from the machine-wide Lanes gateway')
        .argument('[workspace]', 'Workspace to unregister (default: current directory)', '.')
        .option('--host <url>', 'Unregister a remote daemon by base URL instead of a local workspace')
        .action(async (workspaceArg: string, options: { host?: string }) => {
            try {
                if (isRemoteRegistration(options)) {
                    await deregisterRemoteDaemon(options.host!);
                    console.log(`Unregistered remote daemon ${options.host!}.`);
                    return;
                }

                await initCliGit();
                const workspaceRoot = await resolveRepoRootFromPath(workspaceArg);

                await deregisterProject(workspaceRoot);

                console.log(`Unregistered project at ${workspaceRoot}.`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });

    daemon
        .command('registered')
        .description('List projects registered with the machine-wide Lanes gateway')
        .action(async () => {
            try {
                const [projects, remoteDaemons] = await Promise.all([
                    listRegisteredProjects(),
                    listRegisteredRemoteDaemons(),
                ]);

                if (projects.length === 0 && remoteDaemons.length === 0) {
                    console.log('No projects or remote daemons registered.');
                    return;
                }

                for (const project of projects.sort((a, b) => a.projectName.localeCompare(b.projectName))) {
                    console.log(`project\t${project.projectName}\t${project.workspaceRoot}`);
                }

                for (const remoteDaemon of remoteDaemons.sort((a, b) => a.baseUrl.localeCompare(b.baseUrl))) {
                    console.log(`remote\t${remoteDaemon.baseUrl}`);
                }
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });

    daemon
        .command('stop')
        .description('Stop the running daemon process')
        .action(async () => {
            try {
                const running = await isDaemonRunning();
                if (!running) {
                    console.log('Daemon is not running.');
                    return;
                }

                await stopDaemon();
                console.log('Daemon stopped successfully.');
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });

    daemon
        .command('status')
        .description('Show daemon status')
        .action(async () => {
            try {
                const running = await isDaemonRunning();
                if (!running) {
                    console.log('Daemon status: stopped');
                    console.log(`  Log:  ${getDaemonLogPath()}`);
                    return;
                }

                const pid = await getDaemonPid();
                const port = await getDaemonPort();
                const logPath = getDaemonLogPath();
                console.log('Daemon status: running');
                if (pid !== undefined) {
                    console.log(`  PID:  ${pid}`);
                }
                if (port !== undefined) {
                    console.log(`  Port: ${port}`);
                }
                console.log(`  Log:  ${logPath}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });

    daemon
        .command('logs')
        .description('Show the daemon log path and recent log lines')
        .option('--lines <count>', 'Number of log lines to show', '50')
        .action(async (options) => {
            try {
                const lines = parseInt(options.lines, 10);
                if (isNaN(lines) || lines <= 0) {
                    exitWithError(`Invalid line count: ${options.lines}. Must be a positive number.`);
                }

                const logPath = getDaemonLogPath();
                const tail = await readDaemonLogTail(lines);
                console.log(`Daemon log: ${logPath}`);
                if (tail.length === 0) {
                    console.log('No daemon log output is available yet.');
                    return;
                }

                for (const line of tail) {
                    console.log(line);
                }
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getDaemonErrorSummary(err));
            }
        });
}
