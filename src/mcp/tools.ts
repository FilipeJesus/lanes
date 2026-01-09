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
import * as os from 'os';
import { sanitizeSessionName } from '../utils';

/**
 * Interface for features.json file structure.
 */
interface FeaturesFile {
  features: Array<{
    id: string;
    description: string;
    passes: boolean;
  }>;
}

/**
 * Result from workflowStart containing the machine and initial status.
 */
export interface WorkflowStartResult {
  machine: WorkflowStateMachine;
  status: WorkflowStatusResponse;
}

/**
 * Gets the path to the features.json file in a worktree.
 * @param worktreePath - The worktree root path
 * @returns The absolute path to features.json
 */
function getFeaturesPath(worktreePath: string): string {
  return path.join(worktreePath, 'features.json');
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
 * Reads the current features.json file.
 * @param worktreePath - The worktree root path
 * @returns The parsed features file, or default empty structure
 * @throws If file exists but cannot be read (permissions) or parsed (invalid JSON)
 */
async function readFeaturesFile(worktreePath: string): Promise<FeaturesFile> {
  const featuresPath = getFeaturesPath(worktreePath);
  try {
    const content = await fs.promises.readFile(featuresPath, 'utf-8');
    return JSON.parse(content) as FeaturesFile;
  } catch (error) {
    // File not found is acceptable - return default
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { features: [] };
    }
    // Re-throw other errors (permissions, parse errors, etc.)
    throw error;
  }
}

/**
 * Writes the features.json file atomically.
 * Uses write-to-temp-then-rename pattern to prevent corruption.
 * @param worktreePath - The worktree root path
 * @param features - The features file to write
 */
async function writeFeaturesFile(worktreePath: string, features: FeaturesFile): Promise<void> {
  const featuresPath = getFeaturesPath(worktreePath);
  const tempPath = `${featuresPath}.tmp.${process.pid}`;

  // Write to temp file first
  await fs.promises.writeFile(tempPath, JSON.stringify(features, null, 2));

  // Atomically rename to target path
  await fs.promises.rename(tempPath, featuresPath);
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
 * Also syncs tasks to features.json in the worktree.
 *
 * @param machine - The workflow state machine
 * @param loopId - The ID of the loop step to associate tasks with
 * @param tasks - The tasks to iterate over in the loop
 * @param worktreePath - The worktree root path for features.json sync
 */
export async function workflowSetTasks(
  machine: WorkflowStateMachine,
  loopId: string,
  tasks: Task[],
  worktreePath: string
): Promise<void> {
  // Set tasks on the state machine
  machine.setTasks(loopId, tasks);

  // Sync to features.json
  const features = await readFeaturesFile(worktreePath);

  // Convert tasks to features format
  const newFeatures = tasks.map(task => ({
    id: task.id,
    description: task.title,
    passes: false,
  }));

  // Merge with existing features (avoid duplicates by id)
  const existingIds = new Set(features.features.map(f => f.id));
  for (const feature of newFeatures) {
    if (!existingIds.has(feature.id)) {
      features.features.push(feature);
    }
  }

  await writeFeaturesFile(worktreePath, features);

  // Save state after setting tasks
  await saveState(worktreePath, machine.getState());
}

/**
 * Get current workflow position with full context.
 *
 * @param machine - The workflow state machine
 * @returns Complete status information including step, agent, instructions, and progress
 */
export function workflowStatus(machine: WorkflowStateMachine): WorkflowStatusResponse {
  return machine.getStatus();
}

/**
 * Complete current step/sub-step and advance.
 * Also updates features.json when tasks complete (all sub-steps done for a task).
 *
 * @param machine - The workflow state machine
 * @param output - The output/summary from completing the current step
 * @param worktreePath - The worktree root path for features.json sync
 * @returns Updated status response
 */
export async function workflowAdvance(
  machine: WorkflowStateMachine,
  output: string,
  worktreePath: string
): Promise<WorkflowStatusResponse> {
  // Get state before advancing to detect task completion
  const stateBefore = machine.getState();
  const taskBefore = stateBefore.task;

  // Advance the workflow
  const status = machine.advance(output);

  // Get state after advancing
  const stateAfter = machine.getState();
  const taskAfter = stateAfter.task;

  // Check if a task was completed (task changed or we moved to next step)
  if (taskBefore && stateBefore.stepType === 'loop') {
    const taskCompleted =
      // Task index changed (moved to next task)
      (taskAfter && taskAfter.index !== taskBefore.index) ||
      // Or we moved out of the loop (no more tasks)
      (!taskAfter && stateAfter.step !== stateBefore.step) ||
      // Or workflow completed while in loop
      stateAfter.status === 'complete';

    if (taskCompleted) {
      // Update features.json to mark the completed task as passes: true
      const features = await readFeaturesFile(worktreePath);
      const feature = features.features.find(f => f.id === taskBefore.id);
      if (feature) {
        feature.passes = true;
        await writeFeaturesFile(worktreePath, features);
      }
    }
  }

  // Save state after advancing
  await saveState(worktreePath, machine.getState());

  return status;
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
 * Directory where pending session configs are written.
 * The VS Code extension monitors this directory and processes the configs.
 */
const PENDING_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'lanes', 'pending-sessions');

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
 * @returns Result object with success status, config path, or error
 */
export async function createSession(
  name: string,
  sourceBranch: string,
  prompt?: string,
  workflow?: string
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

    // 3. Ensure pending sessions directory exists
    if (!fs.existsSync(PENDING_SESSIONS_DIR)) {
      fs.mkdirSync(PENDING_SESSIONS_DIR, { recursive: true });
    }

    // 4. Create config object
    const config: PendingSessionConfig = {
      name: sanitizedName,
      sourceBranch,
      prompt: prompt?.trim() || undefined,
      workflow: workflow?.trim() || undefined,
      requestedAt: new Date().toISOString()
    };

    // 5. Write config file with unique name
    const configId = `${sanitizedName}-${Date.now()}`;
    const configPath = path.join(PENDING_SESSIONS_DIR, `${configId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // 6. Return success
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
