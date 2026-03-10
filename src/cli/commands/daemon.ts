/**
 * `lanes daemon` — Manage the background Lanes daemon process.
 */

import { Command } from 'commander';
import * as path from 'path';
import { initCli, initCliGit, resolveRepoRootFromPath, exitWithError } from '../utils';
import {
    startDaemon,
    stopDaemon,
    isDaemonRunning,
    getDaemonPort,
    getDaemonPid,
} from '../../daemon/lifecycle';
import {
    registerProject,
    deregisterProject,
    listRegisteredProjects,
} from '../../daemon/registry';
import { getErrorMessage } from '../../core/utils';

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
                const { repoRoot } = await initCli();
                const port = parseInt(options.port, 10);

                if (isNaN(port) || port < 0 || port > 65535) {
                    exitWithError(`Invalid port: ${options.port}. Must be a number between 0 and 65535.`);
                }

                // Resolve the daemon server path relative to this bundled CLI.
                // Both CLI and daemon bundle to the same out/ directory:
                //   CLI    -> out/cli.js
                //   Daemon -> out/daemon.js
                // At runtime __dirname is the out/ directory.
                const serverPath = path.resolve(__dirname, 'daemon.js');

                await startDaemon({ workspaceRoot: repoRoot, port, serverPath });

                // Wait briefly for the daemon to start up and write its port file
                await new Promise<void>((resolve) => setTimeout(resolve, 500));

                const running = await isDaemonRunning(repoRoot);
                if (running) {
                    const actualPort = await getDaemonPort(repoRoot);
                    console.log(`Daemon started successfully on port ${actualPort}.`);
                } else {
                    console.error('Daemon did not start within the expected time. Check daemon logs for details.');
                }
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    daemon
        .command('register')
        .description('Register a project with the machine-wide Lanes gateway')
        .argument('[workspace]', 'Workspace to register (default: current directory)', '.')
        .action(async (workspaceArg: string) => {
            try {
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
                exitWithError(getErrorMessage(err));
            }
        });

    daemon
        .command('unregister')
        .description('Remove a project from the machine-wide Lanes gateway')
        .argument('[workspace]', 'Workspace to unregister (default: current directory)', '.')
        .action(async (workspaceArg: string) => {
            try {
                await initCliGit();
                const workspaceRoot = await resolveRepoRootFromPath(workspaceArg);

                await deregisterProject(workspaceRoot);

                console.log(`Unregistered project at ${workspaceRoot}.`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    daemon
        .command('registered')
        .description('List projects registered with the machine-wide Lanes gateway')
        .action(async () => {
            try {
                const projects = await listRegisteredProjects();

                if (projects.length === 0) {
                    console.log('No projects registered.');
                    return;
                }

                for (const project of projects.sort((a, b) => a.projectName.localeCompare(b.projectName))) {
                    console.log(`${project.projectName}\t${project.workspaceRoot}`);
                }
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    daemon
        .command('stop')
        .description('Stop the running daemon process')
        .action(async () => {
            try {
                const { repoRoot } = await initCli();

                const running = await isDaemonRunning(repoRoot);
                if (!running) {
                    console.log('Daemon is not running.');
                    return;
                }

                await stopDaemon(repoRoot);
                console.log('Daemon stopped successfully.');
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    daemon
        .command('status')
        .description('Show daemon status')
        .action(async () => {
            try {
                const { repoRoot } = await initCli();

                const running = await isDaemonRunning(repoRoot);
                if (!running) {
                    console.log('Daemon status: stopped');
                    return;
                }

                const pid = await getDaemonPid(repoRoot);
                const port = await getDaemonPort(repoRoot);
                console.log('Daemon status: running');
                if (pid !== undefined) {
                    console.log(`  PID:  ${pid}`);
                }
                if (port !== undefined) {
                    console.log(`  Port: ${port}`);
                }
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    daemon
        .command('logs')
        .description('Show information about daemon logs')
        .action(() => {
            console.log('Daemon logs are written to stderr of the daemon process.');
            console.log('To capture logs, start the daemon with output redirection.');
        });
}
