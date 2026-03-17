import { execFile } from 'child_process';
import { promisify } from 'util';
import { CodeAgent } from '../codeAgents/CodeAgent';
import { PrerequisiteError } from '../errors';
import { isTmuxMode } from './TmuxService';

const execFileAsync = promisify(execFile);
const COMMAND_CHECK_TIMEOUT_MS = 5_000;

export interface MissingPrerequisite {
    command: string;
    message: string;
}

export interface SessionPreflightOptions {
    codeAgent: CodeAgent;
    terminalMode?: string;
    requireJq?: boolean;
}

export interface LanesPreflightOptions {
    requireJq?: boolean;
}

async function isCommandAvailable(command: string): Promise<boolean> {
    try {
        await execFileAsync('which', [command], { timeout: COMMAND_CHECK_TIMEOUT_MS });
        return true;
    } catch {
        return false;
    }
}

export const preflightDeps = {
    isCommandAvailable,
};

export async function getMissingLanesPrerequisites(
    options: LanesPreflightOptions = {}
): Promise<MissingPrerequisite[]> {
    const { requireJq = true } = options;
    const missing: MissingPrerequisite[] = [];

    if (requireJq && !await preflightDeps.isCommandAvailable('jq')) {
        missing.push({
            command: 'jq',
            message: 'jq is required for Lanes.',
        });
    }

    return missing;
}

export async function getMissingSessionPrerequisites(
    options: SessionPreflightOptions
): Promise<MissingPrerequisite[]> {
    const { codeAgent, terminalMode, requireJq = true } = options;
    const missing: MissingPrerequisite[] = [];

    if (requireJq && !await preflightDeps.isCommandAvailable('jq')) {
        missing.push({
            command: 'jq',
            message: 'jq is required for session tracking and workflow hooks.',
        });
    }

    if (!await preflightDeps.isCommandAvailable(codeAgent.cliCommand)) {
        missing.push({
            command: codeAgent.cliCommand,
            message: `${codeAgent.displayName} CLI ('${codeAgent.cliCommand}') is not installed.`,
        });
    }

    if (isTmuxMode(terminalMode) && !await preflightDeps.isCommandAvailable('tmux')) {
        missing.push({
            command: 'tmux',
            message: 'tmux is required when lanes.terminalMode is set to tmux.',
        });
    }

    return missing;
}

export function formatMissingPrerequisites(
    missing: MissingPrerequisite[]
): string {
    if (missing.length === 0) {
        return 'All prerequisites are installed.';
    }

    if (missing.length === 1) {
        return `${missing[0].message} Install it and try again.`;
    }

    return `Missing prerequisites: ${missing.map((item) => item.message).join(' ')} Install them and try again.`;
}

function throwIfMissingPrerequisites(missing: MissingPrerequisite[]): void {
    if (missing.length === 0) {
        return;
    }

    throw new PrerequisiteError(
        formatMissingPrerequisites(missing),
        missing.map((item) => item.command)
    );
}

export async function assertLanesPrerequisites(
    options: LanesPreflightOptions = {}
): Promise<void> {
    const missing = await getMissingLanesPrerequisites(options);
    throwIfMissingPrerequisites(missing);
}

export async function assertSessionLaunchPrerequisites(
    options: SessionPreflightOptions
): Promise<void> {
    const missing = await getMissingSessionPrerequisites(options);
    throwIfMissingPrerequisites(missing);
}
