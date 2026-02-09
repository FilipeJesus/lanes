import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import type { ServiceContainer } from '../types/serviceContainer';
import { discoverWorkflows, WorkflowMetadata, loadWorkflowTemplateFromString, WorkflowValidationError } from '../workflow';
import { getErrorMessage } from '../utils';
import { GitError, ValidationError, LanesError } from '../errors';

/**
 * Blank workflow template for "Start from scratch" option.
 */
const BLANK_WORKFLOW_TEMPLATE = `name: my-workflow
description: Custom workflow description

agents:
  orchestrator:
    description: Plans work and coordinates
    tools:
      - Read
      - Glob
      - Grep
      - Task
    cannot:
      - Write
      - Edit
      - Bash
      - commit

loops: {}

steps:
  - id: plan
    type: action
    agent: orchestrator
    instructions: |
      Analyze the goal and create a plan.
`;

/**
 * Register all workflow-related commands.
 * Workflow commands handle creating and validating workflow templates.
 *
 * @param context - VS Code extension context
 * @param services - Service container with all dependencies
 * @param refreshWorkflows - Callback to refresh workflow views
 */
export function registerWorkflowCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer,
    refreshWorkflows: () => Promise<void>
): void {
    const { extensionPath, workspaceRoot } = services;

    /**
     * Creates a new workflow template by copying from an existing template or creating from scratch.
     *
     * Flow:
     * 1. Show quick pick to select base template (built-in templates or start from scratch)
     * 2. Prompt for new workflow name
     * 3. Copy selected template to custom workflows folder
     * 4. Open the new file for editing
     */
    async function createWorkflow(): Promise<void> {
        // 1. Check workspace root
        if (!workspaceRoot) {
            vscode.window.showErrorMessage('Please open a workspace folder first.');
            return;
        }

        // 2. Discover available templates for selection
        const config = vscode.workspace.getConfiguration('lanes');
        const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.lanes/workflows');

        let templates: WorkflowMetadata[] = [];
        try {
            templates = await discoverWorkflows({
                extensionPath,
                workspaceRoot,
                customWorkflowsFolder
            });
        } catch (err) {
            console.warn('Lanes: Failed to discover workflows:', err);
            // Continue with empty list - user can still create from scratch
        }

        // 3. Build quick pick items
        interface WorkflowQuickPickItem extends vscode.QuickPickItem {
            action: 'scratch' | 'template';
            template?: WorkflowMetadata;
        }

        const quickPickItems: WorkflowQuickPickItem[] = [
            {
                label: '$(file-add) Start from scratch',
                description: 'Create a blank workflow template',
                action: 'scratch'
            }
        ];

        // Add built-in templates first
        const builtInTemplates = templates.filter(t => t.isBuiltIn);
        if (builtInTemplates.length > 0) {
            quickPickItems.push({
                label: 'Built-in Templates',
                kind: vscode.QuickPickItemKind.Separator,
                action: 'scratch' // Won't be selected
            });
            for (const template of builtInTemplates) {
                quickPickItems.push({
                    label: `$(symbol-event) ${template.name}`,
                    description: template.description,
                    action: 'template',
                    template
                });
            }
        }

        // Add custom templates if any
        const customTemplates = templates.filter(t => !t.isBuiltIn);
        if (customTemplates.length > 0) {
            quickPickItems.push({
                label: 'Custom Templates',
                kind: vscode.QuickPickItemKind.Separator,
                action: 'scratch' // Won't be selected
            });
            for (const template of customTemplates) {
                quickPickItems.push({
                    label: `$(file-code) ${template.name}`,
                    description: template.description,
                    action: 'template',
                    template
                });
            }
        }

        // 4. Show quick pick
        const selected = await vscode.window.showQuickPick(quickPickItems, {
            placeHolder: 'Select a base template or start from scratch',
            title: 'Create Workflow Template'
        });

        if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
            return;
        }

        // 5. Prompt for new workflow name
        const workflowName = await vscode.window.showInputBox({
            prompt: 'Enter a name for your workflow',
            placeHolder: 'my-custom-workflow',
            validateInput: (value) => {
                if (!value || !value.trim()) {
                    return 'Workflow name is required';
                }
                const trimmed = value.trim();
                // Only allow alphanumeric, hyphens, and underscores
                if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                    return 'Use only letters, numbers, hyphens, and underscores';
                }
                // Check for reserved names
                if (trimmed === 'default' || trimmed === 'feature' || trimmed === 'bugfix' || trimmed === 'refactor') {
                    return `'${trimmed}' is a built-in workflow name. Please choose a different name.`;
                }
                return null;
            }
        });

        if (!workflowName) {
            return;
        }

        const trimmedName = workflowName.trim();

        // 6. Validate custom workflows folder and create if needed
        // Security: Reject path traversal
        if (customWorkflowsFolder.includes('..')) {
            vscode.window.showErrorMessage('Invalid custom workflows folder path (contains parent directory traversal).');
            return;
        }

        const customPath = path.join(workspaceRoot, customWorkflowsFolder);

        // Verify resolved path is within workspace
        const normalizedWorkspace = path.normalize(workspaceRoot + path.sep);
        const normalizedCustomPath = path.normalize(customPath + path.sep);
        if (!normalizedCustomPath.startsWith(normalizedWorkspace)) {
            vscode.window.showErrorMessage('Custom workflows folder resolves outside the workspace.');
            return;
        }

        try {
            await fsPromises.mkdir(customPath, { recursive: true });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to create custom workflows folder: ${getErrorMessage(err)}`);
            return;
        }

        // 7. Create the target file path
        const targetPath = path.join(customPath, `${trimmedName}.yaml`);

        // Check if file already exists
        try {
            await fsPromises.access(targetPath);
            // File exists
            const overwrite = await vscode.window.showWarningMessage(
                `A workflow named '${trimmedName}' already exists. Overwrite?`,
                { modal: true },
                'Overwrite'
            );
            if (overwrite !== 'Overwrite') {
                return;
            }
        } catch {
            // File doesn't exist - good
        }

        // 8. Create the workflow file
        try {
            let content: string;
            if (selected.action === 'scratch') {
                // Create blank template with the user's name
                content = BLANK_WORKFLOW_TEMPLATE.replace('name: my-workflow', `name: ${trimmedName}`);
            } else if (selected.template) {
                // Copy from existing template
                const sourceContent = await fsPromises.readFile(selected.template.path, 'utf-8');
                // Replace the name in the content
                content = sourceContent.replace(/^name:\s*.+$/m, `name: ${trimmedName}`);
            } else {
                vscode.window.showErrorMessage('Invalid template selection.');
                return;
            }

            await fsPromises.writeFile(targetPath, content, 'utf-8');
        } catch (err) {
            let userMessage = 'Failed to create workflow file.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to create workflow file: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
            return;
        }

        // 9. Refresh the workflows view
        services.workflowsProvider.refresh();

        // 10. Open the file for editing
        try {
            const doc = await vscode.workspace.openTextDocument(targetPath);
            await vscode.window.showTextDocument(doc, { preview: false });
            vscode.window.showInformationMessage(`Created workflow template: ${trimmedName}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open workflow file: ${getErrorMessage(err)}`);
        }
    }

    // Command: Create a new workflow template
    const createWorkflowDisposable = vscode.commands.registerCommand('lanes.createWorkflow', async () => {
        await createWorkflow();
        // Refresh workflows in both the tree view and the session form dropdown
        await refreshWorkflows();
    });

    // Command: Validate the current workflow file
    const validateWorkflowDisposable = vscode.commands.registerCommand('lanes.validateWorkflow', async () => {
        // 1. Get the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No file is open');
            return;
        }

        // 2. Check if it's a YAML file
        const document = editor.document;
        const fileName = document.fileName;
        if (!fileName.endsWith('.yaml') && !fileName.endsWith('.yml')) {
            vscode.window.showWarningMessage('Current file is not a YAML file');
            return;
        }

        // 3. Get the file content
        const content = document.getText();

        // 4. Try to validate using loadWorkflowTemplateFromString
        try {
            const template = loadWorkflowTemplateFromString(content);
            vscode.window.showInformationMessage(`Workflow "${template.name}" is valid!`);
        } catch (error) {
            if (error instanceof WorkflowValidationError) {
                vscode.window.showErrorMessage(`Workflow validation failed: ${error.message}`);
            } else {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Invalid YAML: ${errorMessage}`);
            }
        }
    });

    // Register all disposables
    context.subscriptions.push(createWorkflowDisposable, validateWorkflowDisposable);
}
