import * as path from 'path';
import { ensureDir, readJson, writeJson } from '../services/FileService';
import { AgentSessionData, NON_GLOBAL_SESSION_PATH } from './types';

export interface QuickSessionData extends Partial<AgentSessionData> {
    kind: 'quick';
    workingDirectory: string;
    agentName: string;
}

/** Quick sessions use their storage directory as a stable identity, without a worktree. */
export function isQuickSessionPath(sessionPath: string): boolean {
    return path.basename(path.dirname(sessionPath)) === 'current-sessions'
        && path.basename(path.dirname(path.dirname(sessionPath))) === '.lanes';
}

export async function getQuickSession(sessionPath: string): Promise<QuickSessionData | null> {
    if (!isQuickSessionPath(sessionPath)) { return null; }
    const data = await readJson<QuickSessionData>(path.join(sessionPath, 'session.json'));
    return data?.kind === 'quick' && typeof data.workingDirectory === 'string' && path.isAbsolute(data.workingDirectory)
        && typeof data.agentName === 'string' ? data : null;
}

export async function ensureQuickSession(repoRoot: string, sessionName: string, agentName: string): Promise<string> {
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
        throw new Error('Invalid quick session name.');
    }
    const sessionPath = path.join(repoRoot, NON_GLOBAL_SESSION_PATH, sessionName);
    if (!await getQuickSession(sessionPath)) {
        await ensureDir(sessionPath);
        await writeJson(path.join(sessionPath, 'session.json'), {
            kind: 'quick', workingDirectory: repoRoot, agentName,
            alias: `Quick Start (${agentName}) ${sessionName.slice(-8)}`,
        } satisfies QuickSessionData);
    }
    return sessionPath;
}
