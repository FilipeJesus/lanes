import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Feature interface representing a feature in features.json
export interface Feature {
    id: string;
    description: string;
    passes: boolean;
}

// Result of checking features.json for a worktree
export interface FeatureStatus {
    currentFeature: Feature | null;
    allComplete: boolean;
}

// Valid Claude status states
export type ClaudeStatusState = 'working' | 'waiting_for_user' | 'idle' | 'error';

// Status from .claude-status file
export interface ClaudeStatus {
    status: ClaudeStatusState;
    timestamp?: string;
    message?: string;
}

// Valid status values for validation
const VALID_STATUS_VALUES: ClaudeStatusState[] = ['working', 'waiting_for_user', 'idle', 'error'];

// Session data from .claude-session file
export interface ClaudeSessionData {
    sessionId: string;
    timestamp?: string;
}

/**
 * Get the Claude status from a worktree's .claude-status file
 * @param worktreePath Path to the worktree directory
 * @returns ClaudeStatus if valid file exists, null otherwise
 */
export function getClaudeStatus(worktreePath: string): ClaudeStatus | null {
    const statusPath = path.join(worktreePath, '.claude-status');

    try {
        if (!fs.existsSync(statusPath)) {
            return null;
        }

        const content = fs.readFileSync(statusPath, 'utf-8');
        const data = JSON.parse(content);

        // Validate status field exists and is a valid value
        if (!data.status || !VALID_STATUS_VALUES.includes(data.status)) {
            return null;
        }

        return {
            status: data.status as ClaudeStatusState,
            timestamp: data.timestamp,
            message: data.message
        };
    } catch {
        // Graceful fallback for any error (invalid JSON, read error, etc.)
        return null;
    }
}

/**
 * Get the Claude session ID from a worktree's .claude-session file
 * @param worktreePath Path to the worktree directory
 * @returns ClaudeSessionData if valid file exists, null otherwise
 */
export function getSessionId(worktreePath: string): ClaudeSessionData | null {
    const sessionPath = path.join(worktreePath, '.claude-session');

    try {
        if (!fs.existsSync(sessionPath)) {
            return null;
        }

        const content = fs.readFileSync(sessionPath, 'utf-8');
        const data = JSON.parse(content);

        // Validate sessionId field exists and is a non-empty string
        if (!data.sessionId || typeof data.sessionId !== 'string' || data.sessionId.trim() === '') {
            return null;
        }

        // Validate session ID format to prevent command injection
        // Claude session IDs are alphanumeric with hyphens and underscores
        const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
        if (!SESSION_ID_PATTERN.test(data.sessionId)) {
            return null;
        }

        return {
            sessionId: data.sessionId,
            timestamp: data.timestamp
        };
    } catch {
        // Graceful fallback for any error (invalid JSON, read error, etc.)
        return null;
    }
}

/**
 * Get the current feature being worked on from a worktree's features.json
 * @param worktreePath Path to the worktree directory
 * @returns FeatureStatus with current feature and completion status
 */
export function getFeatureStatus(worktreePath: string): FeatureStatus {
    const featuresPath = path.join(worktreePath, 'features.json');

    try {
        if (!fs.existsSync(featuresPath)) {
            return { currentFeature: null, allComplete: false };
        }

        const content = fs.readFileSync(featuresPath, 'utf-8');
        const data = JSON.parse(content);

        if (!data.features || !Array.isArray(data.features)) {
            return { currentFeature: null, allComplete: false };
        }

        const features: Feature[] = data.features;

        if (features.length === 0) {
            return { currentFeature: null, allComplete: false };
        }

        // Find first incomplete feature
        const currentFeature = features.find(f => f.passes === false) || null;

        // All complete if no current feature and we have features
        const allComplete = currentFeature === null && features.length > 0;

        return { currentFeature, allComplete };
    } catch {
        // Graceful fallback for any error (invalid JSON, read error, etc.)
        return { currentFeature: null, allComplete: false };
    }
}

// Define the shape of our Tree Item
export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly worktreePath: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        featureStatus?: FeatureStatus,
        claudeStatus?: ClaudeStatus | null
    ) {
        super(label, collapsibleState);

        // Tooltip shown on hover
        this.tooltip = `Path: ${this.worktreePath}`;

        // Set description based on Claude status and feature status
        this.description = this.getDescriptionForStatus(claudeStatus, featureStatus);

        // Set the icon based on Claude status
        this.iconPath = this.getIconForStatus(claudeStatus);

        // This command runs when you CLICK the item
        this.command = {
            command: 'claudeWorktrees.openSession',
            title: 'Open Session',
            arguments: [this] // Pass itself so the command knows which session to open
        };

        this.contextValue = 'sessionItem';
    }

    /**
     * Get the appropriate icon based on Claude status
     */
    private getIconForStatus(claudeStatus?: ClaudeStatus | null): vscode.ThemeIcon {
        if (!claudeStatus) {
            return new vscode.ThemeIcon('git-branch');
        }

        switch (claudeStatus.status) {
            case 'waiting_for_user':
                return new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.yellow'));
            case 'working':
                return new vscode.ThemeIcon('sync~spin');
            case 'error':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
            case 'idle':
            default:
                return new vscode.ThemeIcon('git-branch');
        }
    }

    /**
     * Get the description text based on Claude status and feature status
     * Priority: waiting_for_user > working > feature ID > "Complete" > "Active"
     */
    private getDescriptionForStatus(
        claudeStatus?: ClaudeStatus | null,
        featureStatus?: FeatureStatus
    ): string {
        const featureId = featureStatus?.currentFeature?.id;

        if (claudeStatus?.status === 'waiting_for_user') {
            return featureId ? `Waiting - ${featureId}` : 'Waiting for input';
        }

        if (claudeStatus?.status === 'working') {
            return featureId ? `Working - ${featureId}` : 'Working...';
        }

        // Fall back to feature-based description (original behavior)
        if (featureId) {
            return featureId;
        } else if (featureStatus?.allComplete) {
            return "Complete";
        } else {
            return "Active";
        }
    }
}

export class ClaudeSessionProvider implements vscode.TreeDataProvider<SessionItem> {
    
    // Event Emitter to notify VS Code when the tree changes (e.g. new session added)
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string | undefined) {}

    // 1. Refresh Method: Call this after creating a new session
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // 2. Get the visual representation of the item
    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    // 3. Get the data (Scan the .worktrees folder)
    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (!this.workspaceRoot) {
            return Promise.resolve([]);
        }

        // We only have a flat list, so if element exists, it has no children
        if (element) {
            return Promise.resolve([]);
        }

        const worktreesDir = path.join(this.workspaceRoot, '.worktrees');

        // Check if folder exists
        if (!fs.existsSync(worktreesDir)) {
            return Promise.resolve([]); 
        }

        return Promise.resolve(this.getSessionsInDir(worktreesDir));
    }

    private getSessionsInDir(dirPath: string): SessionItem[] {
        return fs.readdirSync(dirPath).map(folderName => {
            const fullPath = path.join(dirPath, folderName);

            // Filter: Ensure it's actually a directory
            if (fs.statSync(fullPath).isDirectory()) {
                const featureStatus = getFeatureStatus(fullPath);
                const claudeStatus = getClaudeStatus(fullPath);
                return new SessionItem(
                    folderName,
                    fullPath,
                    vscode.TreeItemCollapsibleState.None, // No nested items
                    featureStatus,
                    claudeStatus
                );
            }
        }).filter(item => item !== undefined) as SessionItem[];
    }
}
