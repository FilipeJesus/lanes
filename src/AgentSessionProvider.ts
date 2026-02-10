import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { CodeAgent } from './codeAgents';
import { validateWorktreesFolder } from './validation';
import { fileExists, readJson, readFile, writeJson, ensureDir, readDir, isDirectory } from './services/FileService';

// Valid agent status states
export type AgentStatusState = 'working' | 'waiting_for_user' | 'active' | 'idle' | 'error';

// Agent status (file name determined by CodeAgent)
export interface AgentSessionStatus {
    status: AgentStatusState;
    timestamp?: string;
    message?: string;
}

// Valid status values for validation
const VALID_STATUS_VALUES: AgentStatusState[] = ['working', 'waiting_for_user', 'active', 'idle', 'error'];

/**
 * Default file names used when no CodeAgent is configured.
 * These are Claude-specific defaults for backward compatibility.
 */
export const DEFAULTS = {
    sessionFileName: '.claude-session',
    statusFileName: '.claude-status',
};

/**
 * Fixed path for non-global session storage (relative to repo root)
 */
const NON_GLOBAL_SESSION_PATH = '.lanes/session_management';

// Global storage context - set during extension activation
let globalStorageUri: vscode.Uri | undefined;
let baseRepoPathForStorage: string | undefined;
let globalCodeAgent: CodeAgent | undefined;
let globalExtensionContext: vscode.ExtensionContext | undefined;

// Track previous icon state per session to detect transitions
const previousIconState = new Map<string, string>();

export function initializeGlobalStorageContext(storageUri: vscode.Uri, baseRepoPath?: string, codeAgent?: CodeAgent, context?: vscode.ExtensionContext): void {
    globalStorageUri = storageUri;
    baseRepoPathForStorage = baseRepoPath;
    globalCodeAgent = codeAgent;
    globalExtensionContext = context;
}

export function getGlobalStorageUri(): vscode.Uri | undefined {
    return globalStorageUri;
}

export function getBaseRepoPathForStorage(): string | undefined {
    return baseRepoPathForStorage;
}

export function getGlobalCodeAgent(): CodeAgent | undefined {
    return globalCodeAgent;
}

export function getRepoIdentifier(repoPath: string): string {
    const normalizedPath = path.normalize(repoPath).toLowerCase();
    const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 8);
    const repoName = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${repoName}-${hash}`;
}

export function getSessionNameFromWorktree(worktreePath: string): string {
    return path.basename(worktreePath);
}

export function getPromptsPath(sessionName: string, repoRoot: string): { path: string; needsDir: string } | null {
    if (!sessionName || sessionName.includes('..') || sessionName.includes('/') || sessionName.includes('\\')) {
        console.warn('Lanes: Invalid session name for prompts path');
        return null;
    }
    const config = vscode.workspace.getConfiguration('lanes');
    const promptsFolder = config.get<string>('promptsFolder', '');
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
    if (!globalStorageUri || !baseRepoPathForStorage) {
        console.warn('Lanes: Global storage not initialized. Using legacy prompts location (.lanes).');
        const legacyDir = path.join(repoRoot, '.lanes');
        return { path: path.join(legacyDir, `${sessionName}.txt`), needsDir: legacyDir };
    }
    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const promptsDir = path.join(globalStorageUri.fsPath, repoIdentifier, 'prompts');
    return { path: path.join(promptsDir, `${sessionName}.txt`), needsDir: promptsDir };
}

export function getGlobalStoragePath(worktreePath: string, filename: string): string | null {
    if (!globalStorageUri || !baseRepoPathForStorage) { return null; }
    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const sessionName = getSessionNameFromWorktree(worktreePath);
    return path.join(globalStorageUri.fsPath, repoIdentifier, sessionName, filename);
}

export function isGlobalStorageEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('lanes');
    return config.get<boolean>('useGlobalStorage', true);
}

export function getWorktreesFolder(): string {
    const config = vscode.workspace.getConfiguration('lanes');
    const folder = config.get<string>('worktreesFolder', '.worktrees');
    const validation = validateWorktreesFolder(folder);
    if (!validation.valid) {
        console.warn(`Lanes: Invalid worktreesFolder configuration: ${validation.error}. Using default.`);
        return '.worktrees';
    }
    const trimmedFolder = folder.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!trimmedFolder) { return '.worktrees'; }
    return trimmedFolder;
}

export function getSessionFilePath(worktreePath: string): string {
    const sessionFileName = globalCodeAgent?.getSessionFileName() || DEFAULTS.sessionFileName;
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, sessionFileName);
        if (globalPath) { return globalPath; }
    }
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, sessionFileName);
}

export function getStatusFilePath(worktreePath: string): string {
    const statusFileName = globalCodeAgent?.getStatusFileName() || DEFAULTS.statusFileName;
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, statusFileName);
        if (globalPath) { return globalPath; }
    }
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, statusFileName);
}

export interface AgentSessionData {
    sessionId: string;
    timestamp?: string;
    workflow?: string;
    permissionMode?: string;
    agentName?: string;
    isChimeEnabled?: boolean;
    taskListId?: string;
    terminal?: 'code' | 'tmux';
}

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

export async function saveSessionTerminalMode(worktreePath: string, terminal: 'code' | 'tmux'): Promise<void> {
    const sessionPath = getClaudeSessionPath(worktreePath);
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
    const sessionPath = getClaudeSessionPath(worktreePath);
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
        // Legacy fallback: parse status directly when no CodeAgent is configured.
        // Uses hardcoded VALID_STATUS_VALUES for backward compatibility with Claude-specific status format.
        const data = JSON.parse(content);
        if (!data.status || !VALID_STATUS_VALUES.includes(data.status)) { return null; }
        return { status: data.status as AgentStatusState, timestamp: data.timestamp, message: data.message };
    } catch { return null; }
}

export async function getSessionId(worktreePath: string): Promise<AgentSessionData | null> {
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        const exists = await fileExists(sessionPath);
        if (!exists) { return null; }
        const content = await readFile(sessionPath);
        if (globalCodeAgent) {
            const sessionData = globalCodeAgent.parseSessionData(content);
            if (!sessionData) { return null; }
            return { sessionId: sessionData.sessionId, timestamp: sessionData.timestamp, workflow: sessionData.workflow, agentName: sessionData.agentName, isChimeEnabled: sessionData.isChimeEnabled };
        }
        const data = JSON.parse(content);
        if (!data.sessionId || typeof data.sessionId !== 'string' || data.sessionId.trim() === '') { return null; }
        const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
        if (!SESSION_ID_PATTERN.test(data.sessionId)) { return null; }
        return { sessionId: data.sessionId, timestamp: data.timestamp, workflow: data.workflow, agentName: data.agentName || 'claude', isChimeEnabled: data.isChimeEnabled };
    } catch { return null; }
}

export async function getSessionAgentName(worktreePath: string): Promise<string> {
    const sessionPath = getSessionFilePath(worktreePath);
    try {
        const data = await readJson<Record<string, unknown>>(sessionPath);
        if (!data) { return 'claude'; }
        if (typeof data.agentName === 'string' && data.agentName.trim() !== '') {
            return data.agentName;
        }
        return 'claude';
    } catch { return 'claude'; }
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

export interface WorkflowStatus {
    active: boolean;
    workflow?: string;
    step?: string;
    progress?: string;
    summary?: string;
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

export class SessionDetailItem extends vscode.TreeItem {
    constructor(public readonly worktreePath: string, step: string, progress?: string) {
        const label = progress ? `${step} (${progress})` : step;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('arrow-small-right');
        this.tooltip = `Workflow step: ${step}${progress ? ` - ${progress}` : ''}`;
        this.command = undefined;
        this.contextValue = 'sessionDetailItem';
    }
}

export class SessionItem extends vscode.TreeItem {
    public readonly workflowStatus: WorkflowStatus | null;

    constructor(
        public readonly label: string,
        public readonly worktreePath: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        agentStatus?: AgentSessionStatus | null,
        workflowStatus?: WorkflowStatus | null,
        chimeEnabled?: boolean
    ) {
        const storedWorkflowStatus = workflowStatus ?? null;
        const hasWorkflowStepInfo = storedWorkflowStatus?.active && storedWorkflowStatus.step;
        const effectiveCollapsibleState = hasWorkflowStepInfo
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        super(label, effectiveCollapsibleState);
        this.workflowStatus = storedWorkflowStatus;
        this.tooltip = `Path: ${this.worktreePath}`;
        this.description = this.getDescriptionForStatus(agentStatus, workflowStatus);
        this.iconPath = this.getIconForStatus(agentStatus, chimeEnabled);
        this.command = { command: 'lanes.openSession', title: 'Open Session', arguments: [this] };
        this.contextValue = 'sessionItem';
    }

    private getIconForStatus(agentStatus?: AgentSessionStatus | null, chimeEnabled?: boolean): vscode.ThemeIcon {
        let iconId: string;
        if (!agentStatus) { iconId = 'git-branch'; }
        else {
            switch (agentStatus.status) {
                case 'waiting_for_user': iconId = 'bell'; break;
                case 'working': iconId = 'sync~spin'; break;
                case 'error': iconId = 'error'; break;
                case 'idle': default: iconId = 'git-branch';
            }
        }
        const previousIcon = previousIconState.get(this.worktreePath);
        if (iconId === 'bell' && previousIcon !== 'bell') {
            if (chimeEnabled) { void vscode.commands.executeCommand('lanes.playChime'); }
        }
        previousIconState.set(this.worktreePath, iconId);
        if (iconId === 'bell') { return new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.yellow')); }
        else if (iconId === 'error') { return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')); }
        else { return new vscode.ThemeIcon(iconId); }
    }

    private getDescriptionForStatus(agentStatus?: AgentSessionStatus | null, workflowStatus?: WorkflowStatus | null): string {
        const summary = workflowStatus?.summary;
        const withSummary = (base: string): string => summary ? `${base} - ${summary}` : base;
        if (agentStatus?.status === 'waiting_for_user') { return withSummary('Waiting'); }
        if (agentStatus?.status === 'working') { return withSummary('Working'); }
        if (summary) { return summary; }
        return "Active";
    }
}

export class AgentSessionProvider implements vscode.TreeDataProvider<SessionItem | SessionDetailItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | SessionDetailItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | SessionDetailItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | SessionDetailItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private readonly sessionsRoot: string | undefined;

    constructor(private workspaceRoot: string | undefined, baseRepoPath?: string, private codeAgent?: CodeAgent) {
        this.sessionsRoot = baseRepoPath || workspaceRoot;
    }

    dispose(): void { this._onDidChangeTreeData.dispose(); }
    refresh(): void { this._onDidChangeTreeData.fire(); }
    getTreeItem(element: SessionItem | SessionDetailItem): vscode.TreeItem { return element; }

    async getChildren(element?: SessionItem | SessionDetailItem): Promise<(SessionItem | SessionDetailItem)[]> {
        if (!this.sessionsRoot) { return []; }
        if (element) {
            if (element instanceof SessionItem && element.workflowStatus?.active && element.workflowStatus.step) {
                return [new SessionDetailItem(element.worktreePath, element.workflowStatus.step, element.workflowStatus.progress)];
            }
            return [];
        }
        const worktreesDir = path.join(this.sessionsRoot, getWorktreesFolder());
        const exists = await fileExists(worktreesDir);
        if (!exists) { return []; }
        return this.getSessionsInDir(worktreesDir);
    }

    private async getSessionsInDir(dirPath: string): Promise<SessionItem[]> {
        const entries = await readDir(dirPath);
        const items: SessionItem[] = [];
        for (const folderName of entries) {
            const fullPath = path.join(dirPath, folderName);
            const isDir = await isDirectory(fullPath);
            if (isDir) {
                const agentStatus = await getAgentStatus(fullPath);
                const workflowStatus = await getWorkflowStatus(fullPath);
                const chimeEnabled = await getSessionChimeEnabled(fullPath);
                items.push(new SessionItem(folderName, fullPath, vscode.TreeItemCollapsibleState.None, agentStatus, workflowStatus, chimeEnabled));
            }
        }
        return items;
    }
}
