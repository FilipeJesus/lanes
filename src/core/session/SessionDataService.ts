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
import { fileExists, readJson, readFile, writeJson, ensureDir, readDir, isDirectory } from '../services/FileService';
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
let configGetUseGlobalStorage: () => boolean = () => true;
let configGetWorktreesFolder: () => string = () => '.worktrees';
let configGetPromptsFolder: () => string = () => '';

/**
 * Set configuration callbacks for platform-specific config reading.
 * Must be called during initialization by the platform adapter.
 */
export function setConfigCallbacks(callbacks: {
    getUseGlobalStorage?: () => boolean;
    getWorktreesFolder?: () => string;
    getPromptsFolder?: () => string;
}): void {
    if (callbacks.getUseGlobalStorage) { configGetUseGlobalStorage = callbacks.getUseGlobalStorage; }
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
}

export function getGlobalStoragePath(): string | undefined {
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

export function getRepoIdentifier(repoPath: string): string {
    const normalizedPath = path.normalize(repoPath).toLowerCase();
    const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 8);
    const repoName = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${repoName}-${hash}`;
}

export function getSessionNameFromWorktree(worktreePath: string): string {
    return path.basename(worktreePath);
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
        else if (path.isAbsolute(trimmedFolder)) { console.warn('Lanes: Absolute paths not allowed in promptsFolder. Using global storage.'); }
        else if (trimmedFolder.includes('..')) { console.warn('Lanes: Invalid promptsFolder path (contains ..). Using global storage.'); }
        else {
            const promptsDir = path.join(repoRoot, trimmedFolder);
            return { path: path.join(promptsDir, `${sessionName}.txt`), needsDir: promptsDir };
        }
    }
    if (!globalStoragePath || !baseRepoPathForStorage) {
        console.warn('Lanes: Global storage not initialized. Using legacy prompts location (.lanes).');
        const legacyDir = path.join(repoRoot, '.lanes');
        return { path: path.join(legacyDir, `${sessionName}.txt`), needsDir: legacyDir };
    }
    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const promptsDir = path.join(globalStoragePath, repoIdentifier, 'prompts');
    return { path: path.join(promptsDir, `${sessionName}.txt`), needsDir: promptsDir };
}

/**
 * Build a global storage path for a worktree file.
 */
export function getGlobalStorageFilePath(worktreePath: string, filename: string): string | null {
    if (!globalStoragePath || !baseRepoPathForStorage) { return null; }
    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const sessionName = getSessionNameFromWorktree(worktreePath);
    return path.join(globalStoragePath, repoIdentifier, sessionName, filename);
}

/**
 * Check if global storage is enabled.
 *
 * @param useGlobalStorage - The configured lanes.useGlobalStorage setting value. If not provided, reads from config callback.
 */
export function isGlobalStorageEnabled(useGlobalStorage?: boolean): boolean {
    if (useGlobalStorage === undefined) { return configGetUseGlobalStorage(); }
    return useGlobalStorage;
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
 *
 * @param worktreePath - Path to the worktree
 * @param useGlobalStorage - Whether global storage is enabled. If not provided, reads from config callback.
 */
export function getSessionFilePath(worktreePath: string, useGlobalStorage?: boolean): string {
    const sessionFileName = globalCodeAgent?.getSessionFileName() || DEFAULTS.sessionFileName;
    if (isGlobalStorageEnabled(useGlobalStorage)) {
        const globalPath = getGlobalStorageFilePath(worktreePath, sessionFileName);
        if (globalPath) { return globalPath; }
    }
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, sessionFileName);
}

/**
 * Get the status file path for a worktree.
 *
 * @param worktreePath - Path to the worktree
 * @param useGlobalStorage - Whether global storage is enabled. If not provided, reads from config callback.
 */
export function getStatusFilePath(worktreePath: string, useGlobalStorage?: boolean): string {
    const statusFileName = globalCodeAgent?.getStatusFileName() || DEFAULTS.statusFileName;
    if (isGlobalStorageEnabled(useGlobalStorage)) {
        const globalPath = getGlobalStorageFilePath(worktreePath, statusFileName);
        if (globalPath) { return globalPath; }
    }
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, statusFileName);
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
    const sessionPath = getSessionFilePath(worktreePath);
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
    const sessionPath = getSessionFilePath(worktreePath);
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
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return null; }
        if (data.terminal === 'tmux') { return 'tmux'; }
        if (data.terminal === 'code') { return 'code'; }
        return null;
    } catch { return null; }
}

export async function getSessionChimeEnabled(worktreePath: string): Promise<boolean> {
    const sessionPath = getSessionFilePath(worktreePath);
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
    const statusPath = getStatusFilePath(worktreePath);
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
    const sessionPath = getSessionFilePath(worktreePath);
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
    const sessionPath = getSessionFilePath(worktreePath);
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
    const sessionPath = getSessionFilePath(worktreePath);
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
    const sessionPath = getSessionFilePath(worktreePath);
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
