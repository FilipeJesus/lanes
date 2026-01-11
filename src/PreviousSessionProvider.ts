import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getWorktreesFolder, getGlobalStorageUri, getRepoIdentifier, getBaseRepoPathForStorage } from './ClaudeSessionProvider';

/**
 * Get the prompts directory path based on configuration.
 * Matches the logic in getPromptsPath from ClaudeSessionProvider.
 *
 * @param repoRoot The repository root path
 * @returns The absolute path to the prompts directory, or null if not determinable
 */
export function getPromptsDir(repoRoot: string): string | null {
    const config = vscode.workspace.getConfiguration('lanes');
    const promptsFolder = config.get<string>('promptsFolder', '');

    // If user has specified a promptsFolder, use repo-relative storage
    if (promptsFolder && promptsFolder.trim()) {
        const trimmedFolder = promptsFolder.trim()
            .replace(/\\/g, '/') // Normalize backslashes
            .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

        // Security: Reject empty result after normalization
        if (!trimmedFolder) {
            // Fall through to global storage
        }
        // Security: Reject absolute paths
        else if (path.isAbsolute(trimmedFolder)) {
            console.warn('Lanes: Absolute paths not allowed in promptsFolder. Using global storage.');
            // Fall through to global storage
        }
        // Security: Reject parent directory traversal
        else if (trimmedFolder.includes('..')) {
            console.warn('Lanes: Invalid promptsFolder path (contains ..). Using global storage.');
            // Fall through to global storage
        }
        else {
            // Valid user-specified path - use repo-relative storage
            return path.join(repoRoot, trimmedFolder);
        }
    }

    // Default: Use global storage
    const globalStorageUri = getGlobalStorageUri();
    const baseRepoPath = getBaseRepoPathForStorage();

    if (!globalStorageUri || !baseRepoPath) {
        // Global storage not initialized - fall back to legacy default
        console.warn('Lanes: Global storage not initialized. Using legacy prompts location (.lanes).');
        return path.join(repoRoot, '.lanes');
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPath);
    return path.join(globalStorageUri.fsPath, repoIdentifier, 'prompts');
}

/**
 * Represents a previous (inactive) session in the tree view.
 * These are sessions that have a prompt file but no active worktree.
 */
export class PreviousSessionItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly promptFilePath: string
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);

        // Tooltip shown on hover
        this.tooltip = `Previous session: ${label}`;

        // Set the history icon
        this.iconPath = new vscode.ThemeIcon('history');

        // Command to run when clicking the item
        this.command = {
            command: 'claudeWorktrees.openPreviousSessionPrompt',
            title: 'Open Previous Session Prompt',
            arguments: [this]
        };

        this.contextValue = 'previousSessionItem';
    }
}

/**
 * Provides data for the Previous Sessions tree view.
 * Shows sessions that have prompt files but no active worktree.
 */
export class PreviousSessionProvider implements vscode.TreeDataProvider<PreviousSessionItem>, vscode.Disposable {

    // Event Emitter to notify VS Code when the tree changes
    private _onDidChangeTreeData: vscode.EventEmitter<PreviousSessionItem | undefined | null | void> = new vscode.EventEmitter<PreviousSessionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<PreviousSessionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // The effective root for finding sessions - either baseRepoPath (if in worktree) or workspaceRoot
    private readonly sessionsRoot: string | undefined;

    /**
     * Create a new PreviousSessionProvider.
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

    /**
     * Refresh the tree view.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get the visual representation of the item.
     */
    getTreeItem(element: PreviousSessionItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get the children (previous sessions).
     * Returns sessions that have prompt files but no active worktree.
     */
    getChildren(element?: PreviousSessionItem): Thenable<PreviousSessionItem[]> {
        if (!this.sessionsRoot) {
            return Promise.resolve([]);
        }

        // We only have a flat list, so if element exists, it has no children
        if (element) {
            return Promise.resolve([]);
        }

        // Get the prompts directory path (respects global storage vs repo-relative config)
        const promptsDir = getPromptsDir(this.sessionsRoot);

        // Check if prompts directory is determinable and exists
        if (!promptsDir || !fs.existsSync(promptsDir)) {
            return Promise.resolve([]);
        }

        // Get active session names (directories in .worktrees/)
        const activeSessions = this.getActiveSessionNames();

        // Get all .txt files from the prompts folder
        return Promise.resolve(this.getPreviousSessionItems(promptsDir, activeSessions));
    }

    /**
     * Get the names of currently active sessions.
     * Active sessions are directories in the worktrees folder.
     */
    private getActiveSessionNames(): Set<string> {
        const activeSessions = new Set<string>();

        if (!this.sessionsRoot) {
            return activeSessions;
        }

        const worktreesDir = path.join(this.sessionsRoot, getWorktreesFolder());

        // Check if worktrees folder exists
        if (!fs.existsSync(worktreesDir)) {
            return activeSessions;
        }

        try {
            const entries = fs.readdirSync(worktreesDir);
            for (const entry of entries) {
                const fullPath = path.join(worktreesDir, entry);
                if (fs.statSync(fullPath).isDirectory()) {
                    activeSessions.add(entry);
                }
            }
        } catch (err) {
            console.warn('Lanes: Failed to read worktrees directory:', err);
        }

        return activeSessions;
    }

    /**
     * Get PreviousSessionItems for prompts that don't have active sessions.
     */
    private getPreviousSessionItems(promptsDir: string, activeSessions: Set<string>): PreviousSessionItem[] {
        const items: PreviousSessionItem[] = [];

        try {
            const entries = fs.readdirSync(promptsDir);

            for (const entry of entries) {
                // Only process .txt files
                if (!entry.endsWith('.txt')) {
                    continue;
                }

                const fullPath = path.join(promptsDir, entry);

                // Ensure it's a file, not a directory
                if (!fs.statSync(fullPath).isFile()) {
                    continue;
                }

                // Extract session name (filename without .txt extension)
                const sessionName = entry.slice(0, -4); // Remove '.txt'

                // Skip if this session is currently active
                if (activeSessions.has(sessionName)) {
                    continue;
                }

                // Create the item
                items.push(new PreviousSessionItem(sessionName, fullPath));
            }
        } catch (err) {
            console.warn('Lanes: Failed to read prompts directory:', err);
        }

        return items;
    }
}
