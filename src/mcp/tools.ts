/**
 * MCP tool handlers for workflow control.
 * These functions are called by the MCP server to manage workflow execution.
 */

import {
  WorkflowStateMachine,
  loadWorkflowTemplate,
  Task,
  WorkflowStatusResponse,
  WorkflowState,
} from '../workflow';
import * as fs from 'fs';
import * as path from 'path';
import { sanitizeSessionName } from '../utils';

/**
 * Result from workflowStart containing the machine and initial status.
 */
export interface WorkflowStartResult {
  machine: WorkflowStateMachine;
  status: WorkflowStatusResponse;
}

/**
 * Gets the path to the workflow state file in a worktree.
 * @param worktreePath - The worktree root path
 * @returns The absolute path to workflow-state.json
 */
export function getStatePath(worktreePath: string): string {
  return path.join(worktreePath, 'workflow-state.json');
}

/**
 * Saves the workflow state to a file atomically.
 * Uses write-to-temp-then-rename pattern to prevent corruption.
 * @param worktreePath - The worktree root path
 * @param state - The workflow state to save
 */
export async function saveState(worktreePath: string, state: WorkflowState): Promise<void> {
  const statePath = getStatePath(worktreePath);
  const tempPath = `${statePath}.tmp.${process.pid}`;

  // Write to temp file first
  await fs.promises.writeFile(tempPath, JSON.stringify(state, null, 2));

  // Atomically rename to target path
  await fs.promises.rename(tempPath, statePath);
}

/**
 * Loads the workflow state from a file.
 * @param worktreePath - The worktree root path
 * @returns The loaded state, or null if not found
 * @throws If file exists but cannot be read (permissions) or parsed (invalid JSON)
 */
export async function loadState(worktreePath: string): Promise<WorkflowState | null> {
  const statePath = getStatePath(worktreePath);
  try {
    const content = await fs.promises.readFile(statePath, 'utf-8');
    return JSON.parse(content) as WorkflowState;
  } catch (error) {
    // File not found is acceptable - return null
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    // Re-throw other errors (permissions, parse errors, etc.)
    throw error;
  }
}

/**
 * Initialize workflow and return first step instructions.
 * Creates a new WorkflowStateMachine from the specified template.
 *
 * @param worktreePath - The worktree root path for state persistence
 * @param workflowName - Name of the workflow template (without .yaml extension)
 * @param templatesDir - Directory containing workflow templates
 * @param summary - Optional brief summary of the user's request (max 10 words)
 * @returns The created state machine and initial status
 * @deprecated Use workflowStartFromPath instead for explicit path handling
 */
export async function workflowStart(
  worktreePath: string,
  workflowName: string,
  templatesDir: string,
  summary?: string
): Promise<WorkflowStartResult> {
  // Load the workflow template
  const templatePath = path.join(templatesDir, `${workflowName}.yaml`);
  const template = await loadWorkflowTemplate(templatePath);

  // Create new state machine
  const machine = new WorkflowStateMachine(template);

  // Start the workflow
  const status = machine.start();

  // Set summary if provided and non-empty
  if (summary && summary.trim()) {
    machine.setSummary(summary.trim());
  }

  // Save initial state
  await saveState(worktreePath, machine.getState());

  return { machine, status };
}

/**
 * Initialize workflow from a direct file path.
 * Creates a new WorkflowStateMachine from the specified template path.
 *
 * @param worktreePath - The worktree root path for state persistence
 * @param workflowPath - Absolute path to the workflow YAML file
 * @param summary - Optional brief summary of the user's request (max 10 words)
 * @returns The created state machine and initial status
 */
export async function workflowStartFromPath(
  worktreePath: string,
  workflowPath: string,
  summary?: string
): Promise<WorkflowStartResult> {
  // Load the workflow template directly from the path
  const template = await loadWorkflowTemplate(workflowPath);

  // Create new state machine
  const machine = new WorkflowStateMachine(template);

  // Start the workflow
  const status = machine.start();

  // Set summary if provided and non-empty
  if (summary && summary.trim()) {
    machine.setSummary(summary.trim());
  }

  // Save initial state
  await saveState(worktreePath, machine.getState());

  return { machine, status };
}

/**
 * Associate tasks with a loop step.
 *
 * @param machine - The workflow state machine
 * @param loopId - The ID of the loop step to associate tasks with
 * @param tasks - The tasks to iterate over in the loop
 * @param worktreePath - The worktree root path for state persistence
 */
export async function workflowSetTasks(
  machine: WorkflowStateMachine,
  loopId: string,
  tasks: Task[],
  worktreePath: string
): Promise<void> {
  // Set tasks on the state machine
  machine.setTasks(loopId, tasks);

  // Save state after setting tasks
  await saveState(worktreePath, machine.getState());
}

/**
 * Appends a reminder to call workflow_advance to the instructions.
 * This helps prevent Claude from stopping prematurely before completing steps.
 */
function appendAdvanceReminder(status: WorkflowStatusResponse): WorkflowStatusResponse {
  if (status.status !== 'running') {
    return status; // Don't add reminder if workflow is complete or failed
  }

  const reminder = '\n\nIMPORTANT: When you have completed this step, you MUST call workflow_advance with a summary of what you accomplished.';

  return {
    ...status,
    instructions: status.instructions + reminder,
  };
}

/**
 * Get current workflow position with full context.
 *
 * @param machine - The workflow state machine
 * @returns Complete status information including step, agent, instructions, and progress
 */
export function workflowStatus(machine: WorkflowStateMachine): WorkflowStatusResponse {
  return appendAdvanceReminder(machine.getStatus());
}

/**
 * Complete current step/sub-step and advance.
 *
 * @param machine - The workflow state machine
 * @param output - The output/summary from completing the current step
 * @param worktreePath - The worktree root path for state persistence
 * @returns Updated status response
 */
export async function workflowAdvance(
  machine: WorkflowStateMachine,
  output: string,
  worktreePath: string
): Promise<WorkflowStatusResponse> {
  // Advance the workflow
  const status = machine.advance(output);

  // Save state after advancing
  await saveState(worktreePath, machine.getState());

  return appendAdvanceReminder(status);
}

/**
 * Get outputs from previous steps.
 *
 * @param machine - The workflow state machine
 * @returns Record of outputs keyed by step/task/sub-step path
 */
export function workflowContext(machine: WorkflowStateMachine): Record<string, string> {
  return machine.getContext();
}

// =============================================================================
// Session Creation Tools
// =============================================================================

/**
 * Get the directory where pending session configs are written.
 * Uses the workspace's .lanes directory instead of the home directory.
 * @param repoRoot The root directory of the repository
 * @returns The path to the pending sessions directory
 */
export function getPendingSessionsDir(repoRoot: string): string {
  return path.join(repoRoot, '.lanes', 'pending-sessions');
}

/**
 * Result of a session creation request.
 */
export interface CreateSessionResult {
  success: boolean;
  configPath?: string;
  error?: string;
}

/**
 * Configuration for a pending session.
 * Written to a JSON file for the VS Code extension to process.
 */
export interface PendingSessionConfig {
  name: string;
  sourceBranch: string;
  prompt?: string;
  workflow?: string;
  requestedAt: string;
}

/**
 * Request creation of a new Lanes session.
 * Writes a config file that the VS Code extension will process.
 *
 * @param name Session name (will be sanitized for git branch)
 * @param sourceBranch Source branch to create worktree from
 * @param prompt Optional starting prompt for Claude
 * @param workflow Optional workflow template name to use
 * @param repoRoot Root directory of the repository (where .claude directory lives)
 * @returns Result object with success status, config path, or error
 */
export async function createSession(
  name: string,
  sourceBranch: string,
  prompt?: string,
  workflow?: string,
  repoRoot?: string
): Promise<CreateSessionResult> {
  try {
    // 1. Validate and sanitize the session name
    const sanitizedName = sanitizeSessionName(name);
    if (!sanitizedName) {
      return {
        success: false,
        error: 'Session name contains no valid characters after sanitization. Use letters, numbers, hyphens, underscores, dots, or slashes.'
      };
    }

    // 2. Validate source branch format
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
    if (!branchNameRegex.test(sourceBranch)) {
      return {
        success: false,
        error: 'Source branch name contains invalid characters. Use only letters, numbers, hyphens, underscores, dots, or slashes.'
      };
    }

    // 3. Validate repoRoot is provided
    if (!repoRoot) {
      return {
        success: false,
        error: 'Repository root path is required for session creation.'
      };
    }

    // 4. Ensure pending sessions directory exists
    const pendingSessionsDir = getPendingSessionsDir(repoRoot);
    if (!fs.existsSync(pendingSessionsDir)) {
      fs.mkdirSync(pendingSessionsDir, { recursive: true });
    }

    // 5. Create config object
    const config: PendingSessionConfig = {
      name: sanitizedName,
      sourceBranch,
      prompt: prompt?.trim() || undefined,
      workflow: workflow?.trim() || undefined,
      requestedAt: new Date().toISOString()
    };

    // 6. Write config file with unique name
    const configId = `${sanitizedName}-${Date.now()}`;
    const configPath = path.join(pendingSessionsDir, `${configId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // 7. Return success
    return {
      success: true,
      configPath
    };

  } catch (err) {
    return {
      success: false,
      error: `Failed to create session request: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
