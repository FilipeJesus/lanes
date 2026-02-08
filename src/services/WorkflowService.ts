/**
 * WorkflowService - Workflow template validation and creation operations
 *
 * This service handles workflow template operations including:
 * - Validating workflow names/paths
 * - Creating new workflow templates from built-in or custom templates
 * - Combining prompts with acceptance criteria for workflow sessions
 * - Generating orchestrator instructions for workflow sessions
 *
 * Workflows are YAML files that define structured agent collaboration patterns.
 * They can be built-in (bundled with the extension) or custom (user-created).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { constants } from 'fs';
import { discoverWorkflows, WorkflowMetadata, loadWorkflowTemplateFromString, WorkflowValidationError } from '../workflow';
import { getErrorMessage } from '../utils';
import { LanesError, GitError, ValidationError } from '../errors';

/**
 * Directory containing bundled workflow templates.
 * Located at extension root/workflows/ (from compiled code in out/, go up one level)
 */
export const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

/**
 * Validate that a workflow exists and resolve it to a full path.
 * Accepts either a workflow name (e.g., 'copy-writer') or a full path to a YAML file.
 * Checks both built-in workflows (in WORKFLOWS_DIR) and custom workflows (in .lanes/workflows/).
 *
 * @param workflow The workflow name or path to validate
 * @param extensionPath The extension root path (for built-in workflows)
 * @param workspaceRoot The workspace root path (for custom workflows)
 * @returns Object with isValid flag, resolved path if valid, and available workflows if invalid
 */
export async function validateWorkflow(
    workflow: string,
    extensionPath: string,
    workspaceRoot: string
): Promise<{ isValid: boolean; resolvedPath?: string; availableWorkflows: string[] }> {
    // If workflow is already an absolute path ending in .yaml, check if it exists
    if (path.isAbsolute(workflow) && workflow.endsWith('.yaml')) {
        try {
            await fsPromises.access(workflow, constants.R_OK);
            return { isValid: true, resolvedPath: workflow, availableWorkflows: [] };
        } catch {
            // Path doesn't exist, fall through to name-based lookup
        }
    }

    // Discover all available workflows (built-in and custom)
    const allWorkflows = await discoverWorkflows({
        extensionPath,
        workspaceRoot
    });

    // Try to find the workflow by name (case-insensitive for convenience)
    const workflowLower = workflow.toLowerCase();
    const matchedWorkflow = allWorkflows.find(w => w.name.toLowerCase() === workflowLower);

    if (matchedWorkflow) {
        return { isValid: true, resolvedPath: matchedWorkflow.path, availableWorkflows: [] };
    }

    // Not found - return available workflow names for error message
    const availableWorkflows = allWorkflows.map(w => w.name);
    return { isValid: false, availableWorkflows };
}

/**
 * Blank workflow template used when creating a workflow from scratch.
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
 * Creates a new workflow template by copying from an existing template or creating from scratch.
 *
 * Flow:
 * 1. Show quick pick to select base template (built-in templates or start from scratch)
 * 2. Prompt for new workflow name
 * 3. Copy selected template to custom workflows folder
 * 4. Open the new file for editing
 *
 * @param extensionPath Path to the extension directory (for built-in templates)
 * @param workspaceRoot Path to the workspace root
 * @param workflowsProvider The workflows provider to refresh after creation
 */
export async function createWorkflow(
    extensionPath: string,
    workspaceRoot: string | undefined,
    workflowsProvider: any
): Promise<void> {
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
    workflowsProvider.refresh();

    // 10. Open the file for editing
    try {
        const doc = await vscode.workspace.openTextDocument(targetPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(`Created workflow template: ${trimmedName}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to open workflow file: ${getErrorMessage(err)}`);
    }
}

/**
 * Combines a prompt with acceptance criteria into a single string.
 *
 * Format rules:
 * - If both are provided: "request: <prompt>\nacceptance criteria: <criteria>"
 * - If only one is provided: use that value as-is
 * - If neither is provided: returns empty string
 */
export function combinePromptAndCriteria(prompt?: string, acceptanceCriteria?: string): string {
    const trimmedPrompt = prompt?.trim() || '';
    const trimmedCriteria = acceptanceCriteria?.trim() || '';

    if (trimmedPrompt && trimmedCriteria) {
        return `request: ${trimmedPrompt}\nacceptance criteria: ${trimmedCriteria}`;
    } else if (trimmedPrompt) {
        return trimmedPrompt;
    } else if (trimmedCriteria) {
        return trimmedCriteria;
    }
    return '';
}

/**
 * Generates the workflow orchestrator instructions to prepend to a prompt.
 * These instructions guide Claude through the structured workflow phases.
 */
export function getWorkflowOrchestratorInstructions(workflow?: string | null): string {
    return `You are the main agent following a structured workflow. Your goal is to successfully complete the workflow which guides you through the work requested by your user.
To be successfull you must follow the workflow and follow these instructions carefully.

## CRITICAL RULES

1. **Always check workflow_status first** to see your current step
2. **For tasks/steps which specify a agent or subagent**, spawn sub-agents using the Task tool to do the task even if you think you can do it yourself
3. **Call workflow_advance** after completing each step
4. **Never skip steps** - complete each one before advancing
5. **Only perform actions for the CURRENT step** - do NOT call workflow tools that belong to future steps. If you are unsure about a parameter value (like a loop name), read the workflow file (${workflow}) or wait for the step that provides that information instead of guessing.
6. **Do NOT call workflow_set_tasks unless instructed to do so in the step instructions**
7. **Do not play the role of a specified agent** - always spawn the required agent using the Task tool

## Workflow

1. Call workflow_start to begin the workflow
2. In workflow: follow instructions for each step and only that step at the end of each step call workflow_advance to move to the next step
3. When complete: review all work and commit if approved

## Sub-Agent Spawning

When the current step requires an agent/subagent other than orchestrator:
- Use the Task tool to spawn a sub-agent, make sure it knows it should NOT call workflow_advance
- Wait for the sub-agent to complete
- YOU should call workflow_advance with a summary

---

## User Request

`;
}
