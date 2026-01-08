/**
 * Workflow module exports.
 * Provides the core workflow engine for MCP-based workflow management.
 */

// Export all types
export type {
  AgentConfig,
  LoopStep,
  WorkflowStep,
  WorkflowTemplate,
  Task,
  TaskContext,
  WorkflowState,
  WorkflowProgress,
  TaskStatusContext,
  WorkflowStatusResponse,
} from './types';

// Export loader functions and error
export {
  loadWorkflowTemplate,
  loadWorkflowTemplateFromString,
  validateTemplate,
  WorkflowValidationError,
} from './loader';

// Export state machine
export { WorkflowStateMachine } from './state';
