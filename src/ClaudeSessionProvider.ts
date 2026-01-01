import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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

// Global storage context - set during extension activation
let globalStorageUri: vscode.Uri | undefined;
let baseRepoPathForStorage: string | undefined;

/**
 * Initialize the global storage context.
 * Must be called during extension activation.
 * @param storageUri The globalStorageUri from the extension context
 * @param baseRepoPath The base repository path for generating unique identifiers
 */
export function initializeGlobalStorageContext(storageUri: vscode.Uri, baseRepoPath?: string): void {
    globalStorageUri = storageUri;
    baseRepoPathForStorage = baseRepoPath;
}

/**
 * Get the global storage URI. Returns undefined if not initialized.
 */
export function getGlobalStorageUri(): vscode.Uri | undefined {
    return globalStorageUri;
}

/**
 * Get the base repo path for storage. Returns undefined if not set.
 */
export function getBaseRepoPathForStorage(): string | undefined {
    return baseRepoPathForStorage;
}

/**
 * Generate a unique identifier for a repository.
 * Uses a hash of the normalized absolute path to ensure uniqueness across repos.
 * @param repoPath The absolute path to the repository
 * @returns A unique identifier string (8-character hash + repo name)
 */
export function getRepoIdentifier(repoPath: string): string {
    // Normalize the path for cross-platform consistency
    const normalizedPath = path.normalize(repoPath).toLowerCase();

    // Create a short hash of the full path for uniqueness
    const hash = crypto.createHash('sha256')
        .update(normalizedPath)
        .digest('hex')
        .substring(0, 8);

    // Get the repo folder name (sanitized)
    const repoName = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '_');

    // Combine for a readable yet unique identifier
    return `${repoName}-${hash}`;
}

/**
 * Get the session name from a worktree path.
 * The session name is the last component of the worktree path.
 * @param worktreePath Path to the worktree
 * @returns The session name
 */
export function getSessionNameFromWorktree(worktreePath: string): string {
    return path.basename(worktreePath);
}

/**
 * Get the global storage path for a specific file.
 * Structure: globalStorageUri/<repo-identifier>/<session-name>/<filename>
 * @param worktreePath The worktree path (used to derive session name and repo path)
 * @param filename The filename (e.g., '.claude-status', 'features.json')
 * @returns The absolute path to the file in global storage, or null if global storage not initialized
 */
export function getGlobalStoragePath(worktreePath: string, filename: string): string | null {
    if (!globalStorageUri || !baseRepoPathForStorage) {
        return null;
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const sessionName = getSessionNameFromWorktree(worktreePath);

    return path.join(globalStorageUri.fsPath, repoIdentifier, sessionName, filename);
}

/**
 * Check if global storage is enabled in configuration.
 * @returns true if useGlobalStorage is enabled, false otherwise
 */
export function isGlobalStorageEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('claudeLanes');
    return config.get<boolean>('useGlobalStorage', false);
}

/**
 * Validates and sanitizes a relative path for security.
 * Rejects absolute paths and parent directory traversal attempts.
 * @param relativePath The user-provided relative path
 * @param worktreePath The base worktree path
 * @param filename The filename to append (e.g., 'features.json')
 * @returns The validated full path, or the default path if validation fails
 */
function validateAndBuildPath(relativePath: string, worktreePath: string, filename: string): string {
    const defaultPath = path.join(worktreePath, filename);

    if (!relativePath || !relativePath.trim()) {
        return defaultPath;
    }

    const trimmedPath = relativePath.trim()
        .replace(/\\/g, '/'); // Normalize backslashes to forward slashes

    // Security: Reject absolute paths
    if (path.isAbsolute(trimmedPath)) {
        console.warn(`Claude Lanes: Absolute paths not allowed in configuration: ${trimmedPath}. Using default.`);
        return defaultPath;
    }

    // Security: Reject parent directory traversal
    if (trimmedPath.includes('..')) {
        console.warn(`Claude Lanes: Parent directory traversal not allowed: ${trimmedPath}. Using default.`);
        return defaultPath;
    }

    const resolvedPath = path.join(worktreePath, trimmedPath, filename);

    // Security: Verify the resolved path is within worktree (belt and suspenders)
    const normalizedWorktree = path.normalize(worktreePath + path.sep);
    const normalizedResolved = path.normalize(resolvedPath);
    if (!normalizedResolved.startsWith(normalizedWorktree)) {
        console.warn(`Claude Lanes: Path traversal detected. Using default.`);
        return defaultPath;
    }

    return resolvedPath;
}

/**
 * Get the configured path for features.json relative to a worktree.
 * Returns the full path to the features.json file.
 * Note: features.json is NOT stored in global storage as it's a development workflow file.
 * Security: Validates path to prevent directory traversal attacks.
 * @param worktreePath Path to the worktree directory
 * @returns Full path to features.json based on configuration
 */
export function getFeaturesJsonPath(worktreePath: string): string {
    const config = vscode.workspace.getConfiguration('claudeLanes');
    const relativePath = config.get<string>('featuresJsonPath', '');
    return validateAndBuildPath(relativePath, worktreePath, 'features.json');
}

/**
 * Get the configured path for tests.json relative to a worktree.
 * Returns the full path to the tests.json file.
 * Note: tests.json is NOT stored in global storage as it's a development workflow file.
 * Security: Validates path to prevent directory traversal attacks.
 * @param worktreePath Path to the worktree directory
 * @returns Full path to tests.json based on configuration
 */
export function getTestsJsonPath(worktreePath: string): string {
    const config = vscode.workspace.getConfiguration('claudeLanes');
    const relativePath = config.get<string>('testsJsonPath', '');
    return validateAndBuildPath(relativePath, worktreePath, 'tests.json');
}

/**
 * Get the configured path for .claude-session file relative to a worktree.
 * Returns the full path to the .claude-session file.
 * If global storage is enabled, returns the path in global storage.
 * Security: Validates path to prevent directory traversal attacks.
 * @param worktreePath Path to the worktree directory
 * @returns Full path to .claude-session based on configuration
 */
export function getClaudeSessionPath(worktreePath: string): string {
    // Check if global storage is enabled
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, '.claude-session');
        if (globalPath) {
            return globalPath;
        }
        // Fall back to worktree path if global storage not initialized
    }

    const config = vscode.workspace.getConfiguration('claudeLanes');
    const relativePath = config.get<string>('claudeSessionPath', '');
    return validateAndBuildPath(relativePath, worktreePath, '.claude-session');
}

/**
 * Get the configured path for .claude-status file relative to a worktree.
 * Returns the full path to the .claude-status file.
 * If global storage is enabled, returns the path in global storage.
 * Security: Validates path to prevent directory traversal attacks.
 * @param worktreePath Path to the worktree directory
 * @returns Full path to .claude-status based on configuration
 */
export function getClaudeStatusPath(worktreePath: string): string {
    // Check if global storage is enabled
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, '.claude-status');
        if (globalPath) {
            return globalPath;
        }
        // Fall back to worktree path if global storage not initialized
    }

    const config = vscode.workspace.getConfiguration('claudeLanes');
    const relativePath = config.get<string>('claudeStatusPath', '');
    return validateAndBuildPath(relativePath, worktreePath, '.claude-status');
}

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
    const statusPath = getClaudeStatusPath(worktreePath);

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
    const sessionPath = getClaudeSessionPath(worktreePath);

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
    const featuresPath = getFeaturesJsonPath(worktreePath);

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

export class ClaudeSessionProvider implements vscode.TreeDataProvider<SessionItem>, vscode.Disposable {

    // Event Emitter to notify VS Code when the tree changes (e.g. new session added)
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // The effective root for finding sessions - either baseRepoPath (if in worktree) or workspaceRoot
    private readonly sessionsRoot: string | undefined;

    /**
     * Create a new ClaudeSessionProvider.
     * @param workspaceRoot The current workspace root (may be a worktree)
     * @param baseRepoPath Optional base repository path (used when workspaceRoot is a worktree)
     */
    constructor(
        private workspaceRoot: string | undefined,
        baseRepoPath?: string
    ) {
        // Use baseRepoPath for finding sessions if provided, otherwise fall back to workspaceRoot
        this.sessionsRoot = baseRepoPath || workspaceRoot;
    }

    /**
     * Dispose of resources held by this provider.
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    // 1. Refresh Method: Call this after creating a new session
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // 2. Get the visual representation of the item
    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }

    // 3. Get the data (Scan the .worktrees folder)
    // Uses sessionsRoot (base repo path) to ensure sessions are found even when in a worktree
    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (!this.sessionsRoot) {
            return Promise.resolve([]);
        }

        // We only have a flat list, so if element exists, it has no children
        if (element) {
            return Promise.resolve([]);
        }

        const worktreesDir = path.join(this.sessionsRoot, '.worktrees');

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
