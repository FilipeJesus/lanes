/**
 * `lanes uninstall` — Remove globally installed Lanes CLI packages.
 */

import { Command } from 'commander';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getErrorMessage } from '../../core/utils';
import { exitWithError } from '../utils';

const execFileAsync = promisify(execFile);

export interface CommandExecutionResult {
    stdout: string;
    stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandExecutionResult>;

export interface InstalledLanesVersion {
    name: string;
    version: string;
}

export interface UninstallResult {
    removedVersions: InstalledLanesVersion[];
    remainingVersions: InstalledLanesVersion[];
}

interface NpmLsDependency {
    version?: string;
}

interface NpmLsResult {
    dependencies?: Record<string, NpmLsDependency | undefined>;
}

interface CommandErrorWithOutput extends Error {
    stdout?: string | Buffer;
}

function getNpmCommand(): string {
    return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export const defaultCommandRunner: CommandRunner = async (command, args) => {
    const result = await execFileAsync(command, args, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
    });

    return {
        stdout: result.stdout,
        stderr: result.stderr,
    };
};

function parseInstalledVersionsFromNpmLsOutput(stdout: string): InstalledLanesVersion[] {
    const parsed = JSON.parse(stdout || '{}') as NpmLsResult;
    const dependency = parsed.dependencies?.lanes;

    if (!dependency?.version) {
        return [];
    }

    return [{ name: 'lanes', version: dependency.version }];
}

async function runIgnoringFailure(
    runCommand: CommandRunner,
    command: string,
    args: string[]
): Promise<void> {
    try {
        await runCommand(command, args);
    } catch {
        // Best-effort cleanup. Detection after the command determines success.
    }
}

export async function listInstalledGlobalLanesVersions(
    runCommand: CommandRunner = defaultCommandRunner
): Promise<InstalledLanesVersion[]> {
    const npmCommand = getNpmCommand();
    try {
        const { stdout } = await runCommand(npmCommand, ['ls', '-g', 'lanes', '--depth=0', '--json']);
        return parseInstalledVersionsFromNpmLsOutput(stdout);
    } catch (err) {
        const stdout = (err as CommandErrorWithOutput).stdout;
        if (typeof stdout === 'string') {
            return parseInstalledVersionsFromNpmLsOutput(stdout);
        }
        if (Buffer.isBuffer(stdout)) {
            return parseInstalledVersionsFromNpmLsOutput(stdout.toString('utf-8'));
        }
        throw err;
    }
}

export async function uninstallAllGlobalLanesVersions(
    runCommand: CommandRunner = defaultCommandRunner
): Promise<UninstallResult> {
    const npmCommand = getNpmCommand();
    const removedVersions: InstalledLanesVersion[] = [];
    let previousSignature = '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const installed = await listInstalledGlobalLanesVersions(runCommand);
        if (installed.length === 0) {
            return { removedVersions, remainingVersions: [] };
        }

        const signature = installed.map((entry) => `${entry.name}@${entry.version}`).join(',');
        if (signature === previousSignature) {
            return { removedVersions, remainingVersions: installed };
        }

        removedVersions.push(...installed);
        previousSignature = signature;

        await runIgnoringFailure(runCommand, npmCommand, ['unlink', '-g', 'lanes']);
        await runIgnoringFailure(runCommand, npmCommand, ['uninstall', '-g', 'lanes']);
    }

    return {
        removedVersions,
        remainingVersions: await listInstalledGlobalLanesVersions(runCommand),
    };
}

export function registerUninstallCommand(program: Command): void {
    program
        .command('uninstall')
        .description('Uninstall all globally installed Lanes CLI versions')
        .action(async () => {
            try {
                const result = await uninstallAllGlobalLanesVersions();

                if (result.removedVersions.length === 0) {
                    console.log('No global Lanes CLI installation found.');
                    return;
                }

                for (const entry of result.removedVersions) {
                    console.log(`Removed ${entry.name}@${entry.version}`);
                }

                if (result.remainingVersions.length > 0) {
                    const remaining = result.remainingVersions
                        .map((entry) => `${entry.name}@${entry.version}`)
                        .join(', ');
                    exitWithError(`Some global Lanes installations could not be removed: ${remaining}`);
                }

                console.log('Lanes CLI uninstalled successfully.');
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });
}
