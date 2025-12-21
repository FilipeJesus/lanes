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
        featureStatus?: FeatureStatus
    ) {
        super(label, collapsibleState);

        // Tooltip shown on hover
        this.tooltip = `Path: ${this.worktreePath}`;

        // The description is the lighter text next to the label
        // Display logic: feature ID > "Complete" > "Active"
        if (featureStatus?.currentFeature) {
            this.description = featureStatus.currentFeature.id;
        } else if (featureStatus?.allComplete) {
            this.description = "Complete";
        } else {
            this.description = "Active";
        }

        // Set the icon (Built-in VS Code icons)
        this.iconPath = new vscode.ThemeIcon('git-branch');

        // This command runs when you CLICK the item
        this.command = {
            command: 'claudeWorktrees.openSession',
            title: 'Open Session',
            arguments: [this] // Pass itself so the command knows which session to open
        };

        this.contextValue = 'sessionItem';
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
                return new SessionItem(
                    folderName,
                    fullPath,
                    vscode.TreeItemCollapsibleState.None, // No nested items
                    featureStatus
                );
            }
        }).filter(item => item !== undefined) as SessionItem[];
    }
}
