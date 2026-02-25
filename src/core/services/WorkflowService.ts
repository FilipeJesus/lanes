/**
 * WorkflowService - Pure workflow validation and utility operations
 *
 * This service provides pure functions for workflow operations:
 * - Validating workflow names/paths
 * - Providing blank workflow template constant
 * - Generating orchestrator instructions for workflow sessions
 *
 * This service is decoupled from VS Code - all UI operations (creating workflows)
 * are handled in the commands layer.
 *
 * Workflows are YAML files that define structured agent collaboration patterns.
 * They can be built-in (bundled with the extension) or custom (user-created).
 */

import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { constants } from 'fs';
import { discoverWorkflows } from '../workflow';

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
export const BLANK_WORKFLOW_TEMPLATE = `name: my-workflow
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
