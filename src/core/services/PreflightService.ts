import { execFile } from 'child_process';
import { promisify } from 'util';
import { CodeAgent } from '../codeAgents/CodeAgent';
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

export async function assertSessionLaunchPrerequisites(
    options: SessionPreflightOptions
): Promise<void> {
    const missing = await getMissingSessionPrerequisites(options);
    if (missing.length > 0) {
        throw new Error(formatMissingPrerequisites(missing));
    }
}
