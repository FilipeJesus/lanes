/**
 * AgentSessionProvider - VS Code TreeDataProvider for agent sessions.
 *
 * This file now serves as a thin VS Code adapter layer:
 * - Re-exports all pure types and functions from core/session
 * - Contains VS Code-specific classes (SessionItem, SessionDetailItem, AgentSessionProvider)
 * - Provides VS Code-aware wrapper functions that read config and delegate to core
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { CodeAgent } from '../../core/codeAgents';
import { fileExists, readDir, isDirectory } from '../../core/services/FileService';

// Re-export everything from core session module
export {
    AgentStatusState,
    AgentSessionStatus,
    AgentSessionData,
    WorkflowStatus,
    VALID_STATUS_VALUES,
    DEFAULTS,
    NON_GLOBAL_SESSION_PATH,
} from '../../core/session/types';

export {
    getSessionNameFromWorktree,
    getSettingsDir,
    getGlobalCodeAgent,
    getBaseRepoPathForStorage,
    saveSessionWorkflow,
    getSessionWorkflow,
    saveSessionPermissionMode,
    getSessionPermissionMode,
    saveSessionTerminalMode,
    getSessionTerminalMode,
    getSessionChimeEnabled,
    setSessionChimeEnabled,
    getAgentStatus,
    getSessionId,
    getSessionAgentName,
    clearSessionId,
    generateTaskListId,
    getTaskListId,
    getOrCreateTaskListId,
    getWorkflowStatus,
    setConfigCallbacks,
    resolveSessionFilePath,
    resolveStatusFilePath,
} from '../../core/session/SessionDataService';

import {
    AgentSessionStatus,
    WorkflowStatus,
} from '../../core/session/types';

import * as SessionDataService from '../../core/session/SessionDataService';

// Track previous icon state per session to detect transitions
const previousIconState = new Map<string, string>();

// ---------------------------------------------------------------------------
// VS Code-aware wrapper functions
// These maintain the original signatures by reading VS Code config internally.
// ---------------------------------------------------------------------------

/** Store the VS Code extension context for workspace state access */
let globalExtensionContext: vscode.ExtensionContext | undefined;

/**
 * Initialize the global storage context.
 * VS Code-aware wrapper that accepts vscode.Uri and delegates to core.
 */
export function initializeGlobalStorageContext(storageUri: vscode.Uri, baseRepoPath?: string, codeAgent?: CodeAgent, context?: vscode.ExtensionContext): void {
    globalExtensionContext = context;
    SessionDataService.initializeGlobalStorageContext(storageUri.fsPath, baseRepoPath, codeAgent);
    // Wire VS Code config reads into the core service
    SessionDataService.setConfigCallbacks({
        getWorktreesFolder: () => vscode.workspace.getConfiguration('lanes').get<string>('worktreesFolder', '.worktrees'),
        getPromptsFolder: () => vscode.workspace.getConfiguration('lanes').get<string>('promptsFolder', ''),
    });
}

/**
 * Get the worktrees folder by reading VS Code configuration.
 */
export function getWorktreesFolder(): string {
    const config = vscode.workspace.getConfiguration('lanes');
    return SessionDataService.getWorktreesFolder(config.get<string>('worktreesFolder', '.worktrees'));
}

/**
 * Get the session file path (always repo-local).
 */
export function getSessionFilePath(worktreePath: string): string {
    return SessionDataService.getSessionFilePath(worktreePath);
}

/**
 * Get the status file path (always repo-local).
 */
export function getStatusFilePath(worktreePath: string): string {
    return SessionDataService.getStatusFilePath(worktreePath);
}

/**
 * Get the prompts path, reading promptsFolder from VS Code config.
 */
export function getPromptsPath(sessionName: string, repoRoot: string): { path: string; needsDir: string } | null {
    const config = vscode.workspace.getConfiguration('lanes');
    return SessionDataService.getPromptsPath(sessionName, repoRoot, config.get<string>('promptsFolder', ''));
}

// ---------------------------------------------------------------------------
// VS Code TreeItem classes
// ---------------------------------------------------------------------------

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
        chimeEnabled?: boolean,
        pinned?: boolean
    ) {
        const storedWorkflowStatus = workflowStatus ?? null;
        const hasWorkflowStepInfo = storedWorkflowStatus?.active && storedWorkflowStatus.step;
        const effectiveCollapsibleState = hasWorkflowStepInfo
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;
        super(label, effectiveCollapsibleState);
        this.workflowStatus = storedWorkflowStatus;
        this.tooltip = pinned ? `[Pinned] Path: ${this.worktreePath}` : `Path: ${this.worktreePath}`;
        this.description = this.getDescriptionForStatus(agentStatus, workflowStatus, pinned);
        this.iconPath = this.getIconForStatus(agentStatus, chimeEnabled);
        this.command = { command: 'lanes.openSession', title: 'Open Session', arguments: [this] };
        this.contextValue = pinned ? 'sessionItemPinned' : 'sessionItem';
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
            if (chimeEnabled) {
                void vscode.commands.executeCommand('lanes.playChime');
                void vscode.window.showInformationMessage(
                    `Session '${this.label}' is waiting for your input`,
                    'Open Session'
                ).then(selection => {
                    if (selection === 'Open Session') {
                        void vscode.commands.executeCommand('lanes.openSession', this);
                    }
                });
            }
        }
        previousIconState.set(this.worktreePath, iconId);
        if (iconId === 'bell') { return new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.yellow')); }
        else if (iconId === 'error') { return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red')); }
        else { return new vscode.ThemeIcon(iconId); }
    }

    private getDescriptionForStatus(agentStatus?: AgentSessionStatus | null, workflowStatus?: WorkflowStatus | null, pinned?: boolean): string {
        const summary = workflowStatus?.summary;
        const withSummary = (base: string): string => summary ? `${base} - ${summary}` : base;
        const withPinned = (base: string): string => pinned ? `Pinned - ${base}` : base;
        if (agentStatus?.status === 'waiting_for_user') { return withPinned(withSummary('Waiting')); }
        if (agentStatus?.status === 'working') { return withPinned(withSummary('Working')); }
        if (summary) { return withPinned(summary); }
        return withPinned("Active");
    }
}

export class AgentSessionProvider implements vscode.TreeDataProvider<SessionItem | SessionDetailItem>, vscode.Disposable {
    private static readonly PINNED_SESSIONS_KEY = 'lanes.pinnedSessions';
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | SessionDetailItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | SessionDetailItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | SessionDetailItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private readonly sessionsRoot: string | undefined;

    constructor(private workspaceRoot: string | undefined, baseRepoPath?: string, private codeAgent?: CodeAgent, private extensionContext?: vscode.ExtensionContext) {
        this.sessionsRoot = baseRepoPath || workspaceRoot;
    }

    dispose(): void { this._onDidChangeTreeData.dispose(); }
    refresh(): void { this._onDidChangeTreeData.fire(); }
    getTreeItem(element: SessionItem | SessionDetailItem): vscode.TreeItem { return element; }

    getPinnedSessions(): string[] {
        if (!this.extensionContext) { return []; }
        return this.extensionContext.workspaceState.get<string[]>(AgentSessionProvider.PINNED_SESSIONS_KEY, []);
    }

    async pinSession(worktreePath: string): Promise<void> {
        if (!this.extensionContext) { return; }
        const pinned = this.getPinnedSessions();
        if (!pinned.includes(worktreePath)) {
            await this.extensionContext.workspaceState.update(AgentSessionProvider.PINNED_SESSIONS_KEY, [...pinned, worktreePath]);
        }
    }

    async unpinSession(worktreePath: string): Promise<void> {
        if (!this.extensionContext) { return; }
        const pinned = this.getPinnedSessions();
        const updated = pinned.filter(p => p !== worktreePath);
        await this.extensionContext.workspaceState.update(AgentSessionProvider.PINNED_SESSIONS_KEY, updated);
    }

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
        const pinnedSet = new Set(this.getPinnedSessions());

        for (const folderName of entries) {
            const fullPath = path.join(dirPath, folderName);
            const isDir = await isDirectory(fullPath);
            if (isDir) {
                const agentStatus = await SessionDataService.getAgentStatus(fullPath);
                const workflowStatus = await SessionDataService.getWorkflowStatus(fullPath);
                const chimeEnabled = await SessionDataService.getSessionChimeEnabled(fullPath);
                const pinned = pinnedSet.has(fullPath);
                items.push(new SessionItem(folderName, fullPath, vscode.TreeItemCollapsibleState.None, agentStatus, workflowStatus, chimeEnabled, pinned));
            }
        }

        // Sort: pinned items first, then unpinned. Maintain relative order within each group.
        const pinnedItems = items.filter(item => pinnedSet.has(item.worktreePath));
        const unpinnedItems = items.filter(item => !pinnedSet.has(item.worktreePath));

        return [...pinnedItems, ...unpinnedItems];
    }
}
