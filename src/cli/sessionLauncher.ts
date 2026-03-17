import type { DaemonClient } from '../daemon/client';
import type { DaemonSessionCreateResponse, DaemonSessionOpenResponse } from '../daemon/contracts';
import type { CliDaemonTarget } from './targeting';

type DaemonSessionLaunch = DaemonSessionCreateResponse | DaemonSessionOpenResponse;

export interface CliDaemonSessionLaunchRequest {
    kind: 'daemon';
    sessionName: string;
    client: DaemonClient;
    launch: DaemonSessionLaunch;
    target: CliDaemonTarget;
}

export type CliSessionLaunchRequest = CliDaemonSessionLaunchRequest;

function describeDaemonTarget(target: CliDaemonTarget): string {
    return target.kind === 'remote' ? `Remote daemon: ${target.host}` : 'Local daemon';
}

function printDaemonLaunchDetails(target: CliDaemonTarget, launch: DaemonSessionLaunch): void {
    console.log(describeDaemonTarget(target));
    console.log(`Worktree: ${launch.worktreePath}`);
    if (launch.attachCommand) {
        console.log(`Attach: ${launch.attachCommand}`);
        return;
    }
    console.log(`Launch: ${launch.command}`);
}

export async function attachCliToDaemonSession(
    client: DaemonClient,
    sessionName: string,
    launch: DaemonSessionLaunch,
    target: CliDaemonTarget
): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        printDaemonLaunchDetails(target, launch);
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
        process.stdout.write(
            `Connected to ${target.kind === 'remote' ? 'remote daemon' : 'local daemon'} session. Press Ctrl-C to detach.\n`
        );
    });
}

export async function launchCliSession(request: CliSessionLaunchRequest): Promise<void> {
    await attachCliToDaemonSession(
        request.client,
        request.sessionName,
        request.launch,
        request.target
    );
}
