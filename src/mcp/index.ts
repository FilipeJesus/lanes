/**
 * MCP module exports.
 * Provides tool handlers for workflow control via MCP.
 *
 * Note: The server (server.ts) is an entry point and not exported here.
 * It should be compiled and run separately.
 */

// Export tool handlers
export {
  workflowStart,
  workflowSetTasks,
  workflowStatus,
  workflowAdvance,
  workflowContext,
  saveState,
  loadState,
  getStatePath,
  type WorkflowStartResult,
} from './tools';
