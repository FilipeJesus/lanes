/**
 * Workflow state machine for tracking and advancing through workflow execution.
 */

import type {
  WorkflowTemplate,
  WorkflowState,
  WorkflowStep,
  LoopStep,
  Task,
  WorkflowStatusResponse,
  AgentConfig,
  WorkflowProgress,
} from './types';

/**
 * State machine for managing workflow execution.
 * Tracks current position in the workflow and handles advancement logic.
 */
export class WorkflowStateMachine {
  private template: WorkflowTemplate;
  private state: WorkflowState;

  /**
   * Creates a new WorkflowStateMachine.
   * @param template - The workflow template defining the structure
   */
  constructor(template: WorkflowTemplate) {
    this.template = template;
    this.state = this.createInitialState();
  }

  /**
   * Creates the initial workflow state.
   */
  private createInitialState(): WorkflowState {
    const firstStep = this.template.steps[0];
    return {
      status: 'running',
      step: firstStep.id,
      stepType: firstStep.type,
      tasks: {},
      outputs: {},
    };
  }

  /**
   * Gets the current workflow step.
   */
  private getCurrentStep(): WorkflowStep {
    const step = this.template.steps.find(s => s.id === this.state.step);
    if (!step) {
      throw new Error(`Step '${this.state.step}' not found in template`);
    }
    return step;
  }

  /**
   * Gets the index of the current step in the template.
   */
  private getCurrentStepIndex(): number {
    return this.template.steps.findIndex(s => s.id === this.state.step);
  }

  /**
   * Gets the loop definition for a loop step.
   */
  private getLoopSteps(stepId: string): LoopStep[] {
    const loopSteps = this.template.loops[stepId];
    if (!loopSteps) {
      throw new Error(`Loop '${stepId}' not found in template`);
    }
    return loopSteps;
  }

  /**
   * Gets the current loop step definition.
   */
  private getCurrentLoopStep(): LoopStep | null {
    if (this.state.stepType !== 'loop' || !this.state.subStep) {
      return null;
    }

    const loopSteps = this.getLoopSteps(this.state.step);
    return loopSteps.find(s => s.id === this.state.subStep) || null;
  }

  /**
   * Gets the index of the current sub-step within the loop.
   */
  private getCurrentSubStepIndex(): number {
    if (!this.state.subStep) {
      return -1;
    }

    const loopSteps = this.getLoopSteps(this.state.step);
    return loopSteps.findIndex(s => s.id === this.state.subStep);
  }

  /**
   * Gets the current tasks for the active loop.
   */
  private getCurrentTasks(): Task[] {
    return this.state.tasks[this.state.step] || [];
  }

  /**
   * Gets the agent configuration for a given agent ID.
   */
  private getAgentConfig(agentId: string | undefined): AgentConfig | undefined {
    if (!agentId) {
      return undefined;
    }
    return this.template.agents[agentId];
  }

  /**
   * Gets the agent for the current step.
   */
  private getCurrentAgent(): string | null {
    const step = this.getCurrentStep();

    if (step.type === 'loop' && this.state.subStep) {
      const loopStep = this.getCurrentLoopStep();
      return loopStep?.agent || step.agent || null;
    }

    return step.agent || null;
  }

  /**
   * Gets the instructions for the current step.
   */
  private getCurrentInstructions(): string {
    const step = this.getCurrentStep();

    if (step.type === 'action') {
      return step.instructions || '';
    }

    // Loop step - get instructions from current sub-step
    const loopStep = this.getCurrentLoopStep();
    if (loopStep) {
      // Interpolate task information into instructions
      const task = this.state.task;
      if (task) {
        return loopStep.instructions
          .replace(/\{task\.id\}/g, task.id)
          .replace(/\{task\.title\}/g, task.title);
      }
      return loopStep.instructions;
    }

    return '';
  }

  /**
   * Builds the progress information for the current state.
   */
  private buildProgress(): WorkflowProgress {
    const currentStepIndex = this.getCurrentStepIndex();
    const totalSteps = this.template.steps.length;

    const progress: WorkflowProgress = {
      currentStep: currentStepIndex + 1,
      totalSteps,
    };

    if (this.state.stepType === 'loop') {
      const tasks = this.getCurrentTasks();
      const completedTasks = tasks.filter(t => t.status === 'done').length;

      progress.completedTasks = completedTasks;
      progress.totalTasks = tasks.length;

      if (this.state.task) {
        const loopSteps = this.getLoopSteps(this.state.step);
        const subStepIndex = this.getCurrentSubStepIndex();
        progress.currentTaskProgress = `Task ${this.state.task.index + 1}/${tasks.length}, Sub-step ${subStepIndex + 1}/${loopSteps.length}`;
      }
    }

    return progress;
  }

  /**
   * Initializes the workflow and returns the first step status.
   * @returns The status response for the first step
   */
  start(): WorkflowStatusResponse {
    // Reset state to initial
    this.state = this.createInitialState();

    // If first step is a loop, we need to wait for tasks to be set
    // Return status indicating we're at the first step
    return this.getStatus();
  }

  /**
   * Gets the current workflow status with full context.
   * @returns Complete status information for Claude
   */
  getStatus(): WorkflowStatusResponse {
    if (this.state.status === 'complete') {
      return {
        status: 'complete',
        step: this.state.step,
        stepType: this.state.stepType,
        agent: null,
        instructions: 'Workflow complete.',
        progress: this.buildProgress(),
      };
    }

    if (this.state.status === 'failed') {
      return {
        status: 'failed',
        step: this.state.step,
        stepType: this.state.stepType,
        agent: null,
        instructions: 'Workflow failed.',
        progress: this.buildProgress(),
      };
    }

    const agent = this.getCurrentAgent();
    const agentConfig = this.getAgentConfig(agent || undefined);
    const instructions = this.getCurrentInstructions();
    const progress = this.buildProgress();

    const response: WorkflowStatusResponse = {
      status: 'running',
      step: this.state.step,
      stepType: this.state.stepType,
      agent,
      instructions,
      progress,
    };

    if (agentConfig) {
      response.agentConfig = agentConfig;
    }

    // Add loop-specific information
    if (this.state.stepType === 'loop') {
      const tasks = this.getCurrentTasks();
      const loopSteps = this.getLoopSteps(this.state.step);

      if (this.state.task) {
        response.task = {
          ...this.state.task,
          total: tasks.length,
        };
      }

      if (this.state.subStep) {
        response.subStep = this.state.subStep;
        response.subStepIndex = this.getCurrentSubStepIndex();
        response.totalSubSteps = loopSteps.length;
      }
    }

    return response;
  }

  /**
   * Sets tasks for a loop step.
   * @param loopId - The ID of the loop to set tasks for
   * @param tasks - The tasks to iterate over
   */
  setTasks(loopId: string, tasks: Task[]): void {
    // Validate the loop exists
    if (!this.template.loops[loopId]) {
      throw new Error(`Loop '${loopId}' not found in template`);
    }

    // Store tasks
    this.state.tasks[loopId] = tasks;

    // If we're currently at this loop step and haven't started iterating,
    // initialize the loop iteration
    if (this.state.step === loopId && this.state.stepType === 'loop' && !this.state.task) {
      this.initializeLoopIteration();
    }
  }

  /**
   * Initializes iteration for the current loop step.
   */
  private initializeLoopIteration(): void {
    const tasks = this.getCurrentTasks();

    if (tasks.length === 0) {
      // No tasks - advance to next step
      this.advanceToNextStep();
      return;
    }

    // Set up first task and first sub-step
    const loopSteps = this.getLoopSteps(this.state.step);

    this.state.task = {
      index: 0,
      id: tasks[0].id,
      title: tasks[0].title,
    };

    if (loopSteps.length > 0) {
      this.state.subStep = loopSteps[0].id;
    }

    // Mark first task as in progress
    tasks[0].status = 'in_progress';
  }

  /**
   * Generates the output key for the current step.
   */
  private getOutputKey(): string {
    if (this.state.stepType === 'action') {
      return this.state.step;
    }

    // Loop step
    const parts = [this.state.step];
    if (this.state.task) {
      parts.push(this.state.task.id);
    }
    if (this.state.subStep) {
      parts.push(this.state.subStep);
    }

    return parts.join('.');
  }

  /**
   * Advances to the next main step.
   */
  private advanceToNextStep(): void {
    const currentIndex = this.getCurrentStepIndex();
    const nextIndex = currentIndex + 1;

    if (nextIndex >= this.template.steps.length) {
      // Workflow complete
      this.state.status = 'complete';
      return;
    }

    const nextStep = this.template.steps[nextIndex];
    this.state.step = nextStep.id;
    this.state.stepType = nextStep.type;
    this.state.task = undefined;
    this.state.subStep = undefined;

    // If next step is a loop, check if tasks are already set
    if (nextStep.type === 'loop' && this.state.tasks[nextStep.id]?.length > 0) {
      this.initializeLoopIteration();
    }
  }

  /**
   * Advances within the current loop (next sub-step or next task).
   */
  private advanceWithinLoop(): void {
    const loopSteps = this.getLoopSteps(this.state.step);
    const tasks = this.getCurrentTasks();
    const currentSubStepIndex = this.getCurrentSubStepIndex();

    // Try to advance to next sub-step
    if (currentSubStepIndex < loopSteps.length - 1) {
      this.state.subStep = loopSteps[currentSubStepIndex + 1].id;
      return;
    }

    // Completed all sub-steps for current task
    // Mark current task as done
    if (this.state.task) {
      const currentTask = tasks[this.state.task.index];
      if (currentTask) {
        currentTask.status = 'done';
      }
    }

    // Try to advance to next task
    const currentTaskIndex = this.state.task?.index ?? -1;
    if (currentTaskIndex < tasks.length - 1) {
      const nextTaskIndex = currentTaskIndex + 1;
      const nextTask = tasks[nextTaskIndex];

      this.state.task = {
        index: nextTaskIndex,
        id: nextTask.id,
        title: nextTask.title,
      };

      // Reset to first sub-step
      this.state.subStep = loopSteps[0].id;

      // Mark next task as in progress
      nextTask.status = 'in_progress';
      return;
    }

    // Completed all tasks in this loop - advance to next step
    this.advanceToNextStep();
  }

  /**
   * Completes the current step/sub-step and advances to the next.
   * @param output - The output from completing the current step
   * @returns Updated status response
   */
  advance(output: string): WorkflowStatusResponse {
    if (this.state.status !== 'running') {
      return this.getStatus();
    }

    // Store output
    const outputKey = this.getOutputKey();
    this.state.outputs[outputKey] = output;

    // Advance based on step type
    if (this.state.stepType === 'action') {
      this.advanceToNextStep();
    } else {
      // Loop step
      if (this.state.task && this.state.subStep) {
        this.advanceWithinLoop();
      } else {
        // Loop not initialized - this shouldn't happen if tasks were set
        this.advanceToNextStep();
      }
    }

    return this.getStatus();
  }

  /**
   * Gets outputs from previous steps.
   * @returns Record of outputs keyed by step/task/sub-step path
   */
  getContext(): Record<string, string> {
    return { ...this.state.outputs };
  }

  /**
   * Gets the current state for persistence.
   * @returns The current workflow state
   */
  getState(): WorkflowState {
    return JSON.parse(JSON.stringify(this.state));
  }

  /**
   * Creates a WorkflowStateMachine from persisted state.
   * @param template - The workflow template
   * @param state - The persisted state to restore
   * @returns A new WorkflowStateMachine at the restored position
   */
  static fromState(template: WorkflowTemplate, state: WorkflowState): WorkflowStateMachine {
    const machine = new WorkflowStateMachine(template);
    machine.state = JSON.parse(JSON.stringify(state));
    return machine;
  }
}
