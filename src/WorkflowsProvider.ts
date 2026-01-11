/**
 * Tree data provider for the Workflows view in the sidebar.
 * Displays discovered workflow templates from built-in and custom locations.
 */

import * as vscode from 'vscode';
import { discoverWorkflows, WorkflowMetadata } from './workflow/discovery';

/**
 * Tree item representing a workflow template.
 */
export class WorkflowItem extends vscode.TreeItem {
    constructor(
        public readonly workflowMetadata: WorkflowMetadata
    ) {
        super(workflowMetadata.name, vscode.TreeItemCollapsibleState.None);

        // Show description from YAML
        this.description = workflowMetadata.isBuiltIn ? 'Built-in' : 'Custom';

        // Tooltip with full description
        this.tooltip = new vscode.MarkdownString();
        this.tooltip.appendMarkdown(`**${workflowMetadata.name}**\n\n`);
        this.tooltip.appendMarkdown(`${workflowMetadata.description}\n\n`);
        this.tooltip.appendMarkdown(`*${workflowMetadata.isBuiltIn ? 'Built-in template' : 'Custom template'}*`);

        // Icon based on type
        this.iconPath = workflowMetadata.isBuiltIn
            ? new vscode.ThemeIcon('symbol-event')
            : new vscode.ThemeIcon('file-code');

        // Open the file when clicked
        this.command = {
            command: 'vscode.open',
            title: 'Open Workflow',
            arguments: [vscode.Uri.file(workflowMetadata.path)]
        };

        this.contextValue = workflowMetadata.isBuiltIn ? 'builtInWorkflow' : 'customWorkflow';
    }
}

/**
 * Tree data provider for workflows.
 */
export class WorkflowsProvider implements vscode.TreeDataProvider<WorkflowItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<WorkflowItem | undefined | null | void> =
        new vscode.EventEmitter<WorkflowItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<WorkflowItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private workflows: WorkflowMetadata[] = [];

    constructor(
        private readonly extensionPath: string,
        private readonly workspaceRoot: string | undefined
    ) {}

    /**
     * Dispose of resources.
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Refresh the workflows list.
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * Get a tree item for display.
     */
    getTreeItem(element: WorkflowItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children (workflow items).
     */
    async getChildren(element?: WorkflowItem): Promise<WorkflowItem[]> {
        // We have a flat list - no children for items
        if (element) {
            return [];
        }

        if (!this.workspaceRoot) {
            return [];
        }

        // Get custom workflows folder from config
        const config = vscode.workspace.getConfiguration('lanes');
        const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.lanes/workflows');

        try {
            this.workflows = await discoverWorkflows({
                extensionPath: this.extensionPath,
                workspaceRoot: this.workspaceRoot,
                customWorkflowsFolder
            });

            return this.workflows.filter(wf => !wf.isBuiltIn).map(wf => new WorkflowItem(wf));
        } catch (err) {
            console.error('Lanes: Failed to discover workflows:', err);
            return [];
        }
    }

    /**
     * Get the list of discovered workflows.
     */
    getWorkflows(): WorkflowMetadata[] {
        return this.workflows;
    }
}
