/**
 * SessionDataService - Platform-agnostic session data management.
 *
 * Pure utility functions for managing session files, status files,
 * and session metadata. All VS Code dependencies have been replaced
 * with plain parameters (strings, booleans).
 *
 * Extracted from AgentSessionProvider.ts to enable reuse across
 * different frontends (VS Code, CLI, web).
 */

import * as path from 'path';
import * as crypto from 'crypto';
import { CodeAgent, DEFAULT_AGENT_NAME, getAgent } from '../codeAgents';
import { validateWorktreesFolder } from '../validation';
import { fileExists, readJson, readFile, writeJson, ensureDir, readDir, isDirectory, atomicWrite } from '../services/FileService';
import {
    AgentStatusState,
    AgentSessionStatus,
    AgentSessionData,
    WorkflowStatus,
    VALID_STATUS_VALUES,
    DEFAULTS,
    NON_GLOBAL_SESSION_PATH,
} from './types';

// Re-export DEFAULTS for external consumers
export { DEFAULTS } from './types';

// ---------------------------------------------------------------------------
// Global storage context – set during extension activation
// ---------------------------------------------------------------------------

let globalStoragePath: string | undefined;
let baseRepoPathForStorage: string | undefined;
let globalCodeAgent: CodeAgent | undefined;

// Configuration callbacks - set by the platform adapter (VS Code, CLI, etc.)
// These allow the core to read current config values without depending on any platform.
let configGetWorktreesFolder: () => string = () => '.worktrees';
let configGetPromptsFolder: () => string = () => '';

/**
 * Set configuration callbacks for platform-specific config reading.
 * Must be called during initialization by the platform adapter.
 */
export function setConfigCallbacks(callbacks: {
    getWorktreesFolder?: () => string;
    getPromptsFolder?: () => string;
}): void {
    if (callbacks.getWorktreesFolder) { configGetWorktreesFolder = callbacks.getWorktreesFolder; }
    if (callbacks.getPromptsFolder) { configGetPromptsFolder = callbacks.getPromptsFolder; }
}

/**
 * Initialize the global storage context.
 *
 * @param storagePath - Absolute filesystem path for global storage (e.g. context.globalStorageUri.fsPath)
 * @param baseRepoPath - Absolute path to the base repository
 * @param codeAgent - The global CodeAgent instance
 */
export function initializeGlobalStorageContext(storagePath: string, baseRepoPath?: string, codeAgent?: CodeAgent): void {
    globalStoragePath = storagePath;
    baseRepoPathForStorage = baseRepoPath;
    globalCodeAgent = codeAgent;

    // Ensure .lanes/.gitignore exists so runtime data is never committed
    if (baseRepoPath) {
        ensureLanesGitignore(baseRepoPath).catch(err => {
            console.warn('Lanes: Failed to ensure .lanes/.gitignore:', err);
        });
    }
}

function getGlobalStoragePath(): string | undefined {
    return globalStoragePath;
}

export function getBaseRepoPathForStorage(): string | undefined {
    return baseRepoPathForStorage;
}

export function getGlobalCodeAgent(): CodeAgent | undefined {
    return globalCodeAgent;
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function getRepoIdentifier(repoPath: string): string {
    const normalizedPath = path.normalize(repoPath).toLowerCase();
    const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 8);
    const repoName = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${repoName}-${hash}`;
}

export function getSessionNameFromWorktree(worktreePath: string): string {
    return path.basename(worktreePath);
}

/**
 * Get the repo-local settings directory for a session.
 * Settings files (claude-settings.json, register-artefact.sh, mcp-config.json)
 * are co-located with session/status files under: <baseRepo>/.lanes/current-sessions/<sessionName>/
 */
export function getSettingsDir(worktreePath: string): string {
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || path.dirname(path.dirname(worktreePath));
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName);
}

/**
 * Ensure a .gitignore file exists inside <repoRoot>/.lanes/ so that
 * runtime directories are never committed.
 */
export async function ensureLanesGitignore(repoRoot: string): Promise<void> {
    const lanesDir = path.join(repoRoot, '.lanes');
    const gitignorePath = path.join(lanesDir, '.gitignore');

    const entries = [
        'clear-requests',
        'current-sessions',
        'pending-sessions',
        'prompts',
    ];

    try {
        await ensureDir(lanesDir);

        let existing = '';
        try { existing = await readFile(gitignorePath); } catch { /* file doesn't exist yet */ }

        const existingLines = new Set(existing.split('\n').map(l => l.trim()));
        const missing = entries.filter(e => !existingLines.has(e));
        if (missing.length === 0) { return; }

        const suffix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
        const content = existing + suffix + missing.join('\n') + '\n';
        await atomicWrite(gitignorePath, content);
    } catch (err) {
        console.warn('Lanes: Failed to ensure .lanes/.gitignore:', err);
    }
}

/**
 * Get the prompts path for a session.
 *
 * @param sessionName - The session name
 * @param repoRoot - The repository root path
 * @param promptsFolder - The configured promptsFolder setting value. If not provided, reads from config callback.
 */
export function getPromptsPath(sessionName: string, repoRoot: string, promptsFolder?: string): { path: string; needsDir: string } | null {
    if (promptsFolder === undefined) { promptsFolder = configGetPromptsFolder(); }
    if (!sessionName || sessionName.includes('..') || sessionName.includes('/') || sessionName.includes('\\')) {
        console.warn('Lanes: Invalid session name for prompts path');
        return null;
    }
    if (promptsFolder && promptsFolder.trim()) {
        const trimmedFolder = promptsFolder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
        if (!trimmedFolder) { /* fall through */ }
        else if (path.isAbsolute(trimmedFolder)) { console.warn('Lanes: Absolute paths not allowed in promptsFolder. Using .lanes/prompts.'); }
        else if (trimmedFolder.includes('..')) { console.warn('Lanes: Invalid promptsFolder path (contains ..). Using .lanes/prompts.'); }
        else {
            const promptsDir = path.join(repoRoot, trimmedFolder);
            return { path: path.join(promptsDir, `${sessionName}.txt`), needsDir: promptsDir };
        }
    }
    // Default: use repo-local .lanes/prompts/ directory
    const promptsDir = path.join(repoRoot, '.lanes', 'prompts');
    return { path: path.join(promptsDir, `${sessionName}.txt`), needsDir: promptsDir };
}

/**
 * Build a global storage path for a worktree file.
 * Used internally by fallback resolvers for backward-compatible reads.
 */
function getGlobalStorageFilePath(worktreePath: string, filename: string): string | null {
    if (!globalStoragePath || !baseRepoPathForStorage) { return null; }
    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const sessionName = getSessionNameFromWorktree(worktreePath);
    return path.join(globalStoragePath, repoIdentifier, sessionName, filename);
}

/**
 * Get the worktrees folder name.
 *
 * @param worktreesFolderSetting - The configured lanes.worktreesFolder setting value. If not provided, reads from config callback.
 */
export function getWorktreesFolder(worktreesFolderSetting?: string): string {
    if (worktreesFolderSetting === undefined) { worktreesFolderSetting = configGetWorktreesFolder(); }
    const validation = validateWorktreesFolder(worktreesFolderSetting);
    if (!validation.valid) {
        console.warn(`Lanes: Invalid worktreesFolder configuration: ${validation.error}. Using default.`);
        return '.worktrees';
    }
    const trimmedFolder = worktreesFolderSetting.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!trimmedFolder) { return '.worktrees'; }
    return trimmedFolder;
}

/**
 * Get the session file path for a worktree.
 * Always returns the repo-local .lanes/current-sessions/ path (write target).
 *
 * @param worktreePath - Path to the worktree
 */
export function getSessionFilePath(worktreePath: string): string {
    const sessionFileName = globalCodeAgent?.getSessionFileName() || DEFAULTS.sessionFileName;
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, sessionFileName);
}

/**
 * Get the status file path for a worktree.
 * Always returns the repo-local .lanes/current-sessions/ path (write target).
 *
 * @param worktreePath - Path to the worktree
 */
export function getStatusFilePath(worktreePath: string): string {
    const statusFileName = globalCodeAgent?.getStatusFileName() || DEFAULTS.statusFileName;
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, statusFileName);
}

/**
 * Resolve the session file path for reading, with backward-compatible fallback.
 * Checks the repo-local path first; if not found, checks the old global storage path.
 *
 * @param worktreePath - Path to the worktree
 * @returns The path where the session file exists, or the repo-local path if neither exists
 */
export async function resolveSessionFilePath(worktreePath: string): Promise<string> {
    const localPath = getSessionFilePath(worktreePath);
    if (await fileExists(localPath)) { return localPath; }
    const sessionFileName = globalCodeAgent?.getSessionFileName() || DEFAULTS.sessionFileName;
    const globalPath = getGlobalStorageFilePath(worktreePath, sessionFileName);
    if (globalPath && await fileExists(globalPath)) { return globalPath; }
    return localPath;
}

/**
 * Resolve the status file path for reading, with backward-compatible fallback.
 * Checks the repo-local path first; if not found, checks the old global storage path.
 *
 * @param worktreePath - Path to the worktree
 * @returns The path where the status file exists, or the repo-local path if neither exists
 */
export async function resolveStatusFilePath(worktreePath: string): Promise<string> {
    const localPath = getStatusFilePath(worktreePath);
    if (await fileExists(localPath)) { return localPath; }
    const statusFileName = globalCodeAgent?.getStatusFileName() || DEFAULTS.statusFileName;
    const globalPath = getGlobalStorageFilePath(worktreePath, statusFileName);
    if (globalPath && await fileExists(globalPath)) { return globalPath; }
    return localPath;
}

// ---------------------------------------------------------------------------
// Session data read/write functions
// ---------------------------------------------------------------------------

export async function saveSessionWorkflow(worktreePath: string, workflow: string): Promise<void> {
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        await ensureDir(path.dirname(sessionPath));
        let existingData: Record<string, unknown> = {};
        const parsed = await readJson<Record<string, unknown>>(sessionPath);
        if (parsed) { existingData = parsed; }
        await writeJson(sessionPath, { ...existingData, workflow });
    } catch (err) {
        console.warn('Lanes: Failed to save session workflow:', err);
    }
}

export async function getSessionWorkflow(worktreePath: string): Promise<string | null> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return null; }
        if (typeof data.workflow === 'string' && (data.workflow as string).trim() !== '') {
            return data.workflow as string;
        }
        return null;
    } catch { return null; }
}

export async function saveSessionPermissionMode(worktreePath: string, permissionMode: string): Promise<void> {
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        await ensureDir(path.dirname(sessionPath));
        let existingData: Record<string, unknown> = {};
        const parsed = await readJson<Record<string, unknown>>(sessionPath);
        if (parsed) { existingData = parsed; }
        await writeJson(sessionPath, { ...existingData, permissionMode });
    } catch (err) {
        console.warn('Lanes: Failed to save session permission mode:', err);
    }
}

export async function getSessionPermissionMode(worktreePath: string): Promise<string | null> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return null; }
        if (typeof data.permissionMode === 'string' && (data.permissionMode as string).trim() !== '') {
            return data.permissionMode as string;
        }
        return null;
    } catch { return null; }
}

export async function saveSessionTerminalMode(worktreePath: string, terminal: 'code' | 'vscode' | 'tmux'): Promise<void> {
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        await ensureDir(path.dirname(sessionPath));
        let existingData: Record<string, unknown> = {};
        const parsed = await readJson<Record<string, unknown>>(sessionPath);
        if (parsed) { existingData = parsed; }
        await writeJson(sessionPath, { ...existingData, terminal });
    } catch (err) {
        console.warn('Lanes: Failed to save session terminal mode:', err);
    }
}

export async function getSessionTerminalMode(worktreePath: string): Promise<'code' | 'tmux' | null> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return null; }
        if (data.terminal === 'tmux') { return 'tmux'; }
        if (data.terminal === 'code') { return 'code'; }
        return null;
    } catch { return null; }
}

export async function getSessionChimeEnabled(worktreePath: string): Promise<boolean> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return false; }
        if (typeof data.isChimeEnabled === 'boolean') { return data.isChimeEnabled; }
        return false;
    } catch { return false; }
}

export async function setSessionChimeEnabled(worktreePath: string, enabled: boolean): Promise<void> {
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        await ensureDir(path.dirname(sessionPath));
        let existingData: Record<string, unknown> = {};
        const parsed = await readJson<Record<string, unknown>>(sessionPath);
        if (parsed) { existingData = parsed; }
        await writeJson(sessionPath, { ...existingData, isChimeEnabled: enabled });
    } catch (err) {
        console.warn('Lanes: Failed to set session chime preference:', err);
    }
}

export async function getAgentStatus(worktreePath: string): Promise<AgentSessionStatus | null> {
    const statusPath = await resolveStatusFilePath(worktreePath);
    try {
        const exists = await fileExists(statusPath);
        if (!exists) { return null; }
        const content = await readFile(statusPath);
        if (globalCodeAgent) {
            const agentStatus = globalCodeAgent.parseStatus(content);
            if (!agentStatus) { return null; }
            const validStates = globalCodeAgent.getValidStatusStates();
            if (!validStates.includes(agentStatus.status)) { return null; }
            return { status: agentStatus.status as AgentStatusState, timestamp: agentStatus.timestamp, message: agentStatus.message };
        }
        const data = JSON.parse(content);
        if (!data.status || !VALID_STATUS_VALUES.includes(data.status)) { return null; }
        return { status: data.status as AgentStatusState, timestamp: data.timestamp, message: data.message };
    } catch { return null; }
}

export async function getSessionId(worktreePath: string, codeAgent?: CodeAgent): Promise<AgentSessionData | null> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const exists = await fileExists(sessionPath);
        if (!exists) { return null; }
        const content = await readFile(sessionPath);

        let agent = codeAgent || globalCodeAgent;
        if (!codeAgent && !agent) {
            // No agent available at all - use legacy fallback below
        } else if (!codeAgent) {
            try {
                const rawData = JSON.parse(content);
                if (rawData.agentName && typeof rawData.agentName === 'string' && rawData.agentName !== agent?.name) {
                    const sessionAgent = getAgent(rawData.agentName);
                    if (sessionAgent) { agent = sessionAgent; }
                }
            } catch { /* fall through to current agent */ }
        }

        let rawLogPath: string | undefined;
        try {
            const rawData = JSON.parse(content);
            if (typeof rawData.logPath === 'string') { rawLogPath = rawData.logPath; }
        } catch { /* ignore parse errors - agent parser handles validation */ }

        if (agent) {
            const sessionData = agent.parseSessionData(content);
            if (!sessionData) { return null; }
            return { sessionId: sessionData.sessionId, timestamp: sessionData.timestamp, workflow: sessionData.workflow, agentName: sessionData.agentName, isChimeEnabled: sessionData.isChimeEnabled, logPath: rawLogPath };
        }
        const data = JSON.parse(content);
        if (!data.sessionId || typeof data.sessionId !== 'string' || data.sessionId.trim() === '') { return null; }
        const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
        if (!SESSION_ID_PATTERN.test(data.sessionId)) { return null; }
        return { sessionId: data.sessionId, timestamp: data.timestamp, workflow: data.workflow, agentName: data.agentName || DEFAULT_AGENT_NAME, isChimeEnabled: data.isChimeEnabled, logPath: rawLogPath };
    } catch { return null; }
}

export async function getSessionAgentName(worktreePath: string): Promise<string> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return DEFAULT_AGENT_NAME; }
        if (typeof data.agentName === 'string' && data.agentName.trim() !== '') {
            return data.agentName;
        }
        return DEFAULT_AGENT_NAME;
    } catch { return DEFAULT_AGENT_NAME; }
}

export async function clearSessionId(worktreePath: string): Promise<void> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return; }
        delete data.sessionId;
        if (!data.timestamp) { data.timestamp = new Date().toISOString(); }
        await writeJson(sessionPath, data);
    } catch (err) {
        console.warn(`Lanes: Failed to clear session ID from ${sessionPath}:`, err);
    }
}

export function generateTaskListId(sessionName: string): string {
    const randomSuffix = crypto.randomBytes(3).toString('base64').replace(/[+/=]/g, '').substring(0, 6);
    return `${sessionName}-${randomSuffix}`;
}

export async function getTaskListId(worktreePath: string): Promise<string | null> {
    const sessionPath = await resolveSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return null; }
        if (data.taskListId && typeof data.taskListId === 'string' && (data.taskListId as string).trim() !== '') {
            return data.taskListId as string;
        }
        return null;
    } catch { return null; }
}

export async function getOrCreateTaskListId(worktreePath: string, sessionName: string): Promise<string> {
    const existingId = await getTaskListId(worktreePath);
    if (existingId) { return existingId; }
    const newId = generateTaskListId(sessionName);
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        await ensureDir(path.dirname(sessionPath));
        let data: Record<string, unknown> = {};
        const parsed = await readJson<Record<string, unknown>>(sessionPath);
        if (parsed) { data = parsed; }
        data.taskListId = newId;
        await writeJson(sessionPath, data);
    } catch (err) {
        console.warn(`Lanes: Failed to save task list ID to ${sessionPath}:`, err);
    }
    return newId;
}

export async function getWorkflowStatus(worktreePath: string): Promise<WorkflowStatus | null> {
    const statePath = path.join(worktreePath, 'workflow-state.json');
    try {
        const state = await readJson<Record<string, unknown>>(statePath);
        if (!state) { return null; }
        if (!state.status || typeof state.status !== 'string') { return null; }
        const isActive = state.status === 'running';
        const workflow = (state.workflow as string) || undefined;
        const step = (state.step as string) || undefined;
        let progress: string | undefined;
        const task = state.task as Record<string, unknown> | undefined;
        if (task && typeof task.index === 'number') { progress = `Task ${task.index + 1}`; }
        const summary = typeof state.summary === 'string' && (state.summary as string).trim() !== '' ? state.summary as string : undefined;
        return { active: isActive, workflow, step, progress, summary };
    } catch { return null; }
}
