/**
 * Workflow type definitions for the MCP-based workflow system.
 * These interfaces define the structure of workflow templates and runtime state.
 */

/**
 * Configuration for an agent that can execute workflow steps.
 */
export interface AgentConfig {
  /** Human-readable description of the agent's role */
  description: string;
}

/**
 * A step within a reusable loop (sub-workflow).
 */
export interface LoopStep {
  /** Unique identifier for this sub-step within the loop */
  id: string;
  /** Agent to execute this step (omit to use main agent) */
  agent?: string;
  /** Instructions for what to do in this step */
  instructions: string;
  /** Action to take if this step fails */
  on_fail?: 'retry' | 'skip' | 'abort';
}

/**
 * A step in the main workflow sequence.
 */
export interface WorkflowStep {
  /** Unique identifier for this step */
  id: string;
  /** Type of step: 'action' for single steps, 'loop' for iterating over tasks, 'ralph' for n iterations */
  type: 'action' | 'loop' | 'ralph';
  /** Agent to execute this step (omit for main agent) */
  agent?: string;
  /** Instructions for action steps */
  instructions?: string;
  /** Number of iterations for ralph steps */
  n?: number;
}

/**
 * Workflow template loaded from YAML file.
 * Defines the structure and flow of a workflow.
 */
export interface WorkflowTemplate {
  /** Name of the workflow */
  name: string;
  /** Human-readable description of what this workflow accomplishes */
  description: string;
  /** Available agents and their configurations */
  agents?: Record<string, AgentConfig>;
  /** Reusable sub-workflows (loops) */
  loops?: Record<string, LoopStep[]>;
  /** Main workflow steps */
  steps: WorkflowStep[];
}

/**
 * A task that can be iterated over in a loop step.
 */
export interface Task {
  /** Unique identifier for the task */
  id: string;
  /** Human-readable title of the task */
  title: string;
  /** Optional detailed description */
  description?: string;
  /** IDs of tasks that must complete before this one */
  depends_on?: string[];
  /** Current status of the task */
  status: 'pending' | 'in_progress' | 'done' | 'failed';
}

/**
 * Current task context within a loop.
 */
export interface TaskContext {
  /** 0-based index of the current task */
  index: number;
  /** Task ID */
  id: string;
  /** Task title */
  title: string;
}

/**
 * Runtime state of a workflow execution.
 * This is persisted and can be restored to resume workflows.
 */
export interface WorkflowState {
  /** Overall workflow status */
  status: 'running' | 'complete' | 'failed';
  /** Current main step ID */
  step: string;
  /** Type of the current step */
  stepType: 'action' | 'loop' | 'ralph';
  /** Current task context (only for loop steps) */
  task?: TaskContext;
  /** Current sub-step ID within a loop (only for loop steps) */
  subStep?: string;
  /** Current iteration for ralph steps (1-based) */
  ralphIteration?: number;
  /** Tasks organized by loop ID */
  tasks: Record<string, Task[]>;
  /** Outputs from completed steps, keyed by "step.task.subStep", "step", or "step.iteration" for ralph steps */
  outputs: Record<string, string>;
  /** Brief summary of the user's request (recommended: keep under 100 characters) */
  summary?: string;
}

/**
 * Progress information included in status responses.
 */
export interface WorkflowProgress {
  /** Index of current step (1-based for display) */
  currentStep: number;
  /** Total number of main steps */
  totalSteps: number;
  /** Number of completed tasks in current loop */
  completedTasks?: number;
  /** Total tasks in current loop */
  totalTasks?: number;
  /** Human-readable progress string for current task */
  currentTaskProgress?: string;
}

/**
 * Extended task context for status responses (includes total count).
 */
export interface TaskStatusContext extends TaskContext {
  /** Total number of tasks in the loop */
  total: number;
}

/**
 * Complete status response returned to Claude.
 * Contains all information needed to continue the workflow.
 */
export interface WorkflowStatusResponse {
  /** Overall workflow status */
  status: 'running' | 'complete' | 'failed';
  /** Current main step ID */
  step: string;
  /** Type of the current step */
  stepType: 'action' | 'loop' | 'ralph';
  /** Current task context (only for loop steps) */
  task?: TaskStatusContext;
  /** Current sub-step ID (only for loop steps) */
  subStep?: string;
  /** Index of current sub-step within the loop (0-based) */
  subStepIndex?: number;
  /** Total number of sub-steps in the loop */
  totalSubSteps?: number;
  /** Current ralph iteration (only for ralph steps) */
  ralphIteration?: number;
  /** Total number of ralph iterations (only for ralph steps) */
  ralphTotal?: number;
  /** Agent assigned to current step (null for main agent) */
  agent: string | null;
  /** Instructions for the current step */
  instructions: string;
  /** Progress information */
  progress: WorkflowProgress;
}
