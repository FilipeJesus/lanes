/**
 * MCP server entry point for workflow control.
 * Uses stdio transport to communicate with Claude.
 *
 * Usage: node server.js --worktree <path> --workflow <name>
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as tools from './tools';
import {
  WorkflowStateMachine,
  WorkflowState,
  Task,
  loadWorkflowTemplate,
} from '../workflow';
import * as path from 'path';

// Parse command-line arguments
// Expected: node server.js --worktree <path> --workflow-path <path> --repo-root <path>
const args = process.argv.slice(2);
let worktreePath = '';
let workflowPath = '';
let repoRoot = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--worktree' && args[i + 1]) {
    worktreePath = args[i + 1];
    i++;
  } else if (args[i] === '--workflow-path' && args[i + 1]) {
    workflowPath = args[i + 1];
    i++;
  } else if (args[i] === '--repo-root' && args[i + 1]) {
    repoRoot = args[i + 1];
    i++;
  }
}

if (!worktreePath) {
  console.error('Error: --worktree <path> is required');
  process.exit(1);
}

if (!workflowPath) {
  console.error('Error: --workflow-path <path> is required');
  process.exit(1);
}

if (!repoRoot) {
  console.error('Error: --repo-root <path> is required');
  process.exit(1);
}

// Validate worktreePath - must be an absolute path
if (!path.isAbsolute(worktreePath)) {
  console.error('Error: --worktree must be an absolute path');
  process.exit(1);
}

// Validate workflowPath - must be an absolute path
if (!path.isAbsolute(workflowPath)) {
  console.error('Error: --workflow-path must be an absolute path');
  process.exit(1);
}

// Validate repoRoot - must be an absolute path
if (!path.isAbsolute(repoRoot)) {
  console.error('Error: --repo-root must be an absolute path');
  process.exit(1);
}

// Validate workflowPath - must end with .yaml
if (!workflowPath.endsWith('.yaml')) {
  console.error('Error: --workflow-path must end with .yaml');
  process.exit(1);
}

// Global state
let machine: WorkflowStateMachine | null = null;

/**
 * Ensures the machine is loaded, either from memory or from disk.
 * Returns null if no workflow state exists anywhere.
 *
 * Prioritizes the workflow_definition snapshot from the saved state to ensure
 * consistent resumption even if the YAML file has changed. Falls back to loading
 * from YAML for backwards compatibility with old state files.
 */
async function ensureMachineLoaded(): Promise<WorkflowStateMachine | null> {
  // Return existing machine if already in memory
  if (machine) {
    return machine;
  }

  // Try to load from disk
  try {
    const existingState = await tools.loadState(worktreePath);
    if (existingState) {
      // Use the saved workflow_definition if available (ensures consistent resumption)
      if (existingState.workflow_definition) {
        console.error(`Resuming workflow from saved definition (workflow-state.json)`);
        machine = WorkflowStateMachine.fromState(existingState.workflow_definition, existingState);
        return machine;
      }

      // Backwards compatibility: load from YAML if no workflow_definition in state
      try {
        console.error(`Loading workflow template from ${workflowPath}`);
        const template = await loadWorkflowTemplate(workflowPath);
        machine = WorkflowStateMachine.fromState(template, existingState);
        return machine;
      } catch (error) {
        // Template loading failed (missing/corrupted template)
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to load workflow template from ${workflowPath}: ${message}`);
        return null;
      }
    }
  } catch (error) {
    // State loading failed (file system errors)
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to load workflow state from ${worktreePath}: ${message}`);
    return null;
  }

  // No state exists in memory or on disk
  return null;
}

// Create MCP server
const server = new Server(
  { name: 'lanes-workflow', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'workflow_start',
      description:
        'Initialize the workflow and return the first step instructions. ' +
        'If the workflow was previously started, returns the current status.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          summary: {
            type: 'string',
            description: 'Brief summary of the user\'s request (max 10 words). Displayed in the VS Code sidebar.',
          },
        },
        required: [],
      },
    },
    {
      name: 'workflow_set_tasks',
      description:
        'Associate tasks with a loop step. Each task will be iterated through ' +
        'the loop sub-steps.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          loop_id: {
            type: 'string',
            description: 'The loop ID to associate tasks with (must match a loop step id)',
          },
          tasks: {
            type: 'array',
            description: 'Array of tasks to iterate over in the loop',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Unique task identifier' },
                title: { type: 'string', description: 'Human-readable task title' },
                description: { type: 'string', description: 'Optional detailed description' },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['loop_id', 'tasks'],
      },
    },
    {
      name: 'workflow_status',
      description:
        'Get current workflow position with full context. ' +
        'Returns step, sub-step (if in loop), agent, instructions, and progress. ' +
        'For ralph steps, includes ralphIteration and ralphTotal fields indicating which iteration (1-N) you are on.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'workflow_advance',
      description:
        'Complete the current step/sub-step and advance to the next. ' +
        'Provide output summarizing what was accomplished. ' +
        'For ralph steps (iterative refinement), advancing may return the SAME step again ' +
        'with incremented iteration number - this is intentional and you should work on it again to improve quality.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          output: {
            type: 'string',
            description: 'Output/summary from the completed step',
          },
        },
        required: ['output'],
      },
    },
    {
      name: 'workflow_context',
      description:
        'Get outputs from previous steps. ' +
        'Returns a record keyed by step path (e.g., "plan" or "implement.task-1.code").',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
    {
      name: 'register_artefacts',
      description:
        'Register output files (artefacts) created during the current workflow step. ' +
        'These files will be tracked in the workflow state and visible in status responses.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          paths: {
            type: 'array',
            description: 'List of file paths (absolute or relative to workspace) to register as artefacts',
            items: { type: 'string' },
          },
        },
        required: ['paths'],
      },
    },
    {
      name: 'session_create',
      description:
        'Request creation of a new Lanes session. Writes a config file that the ' +
        'VS Code extension will process to create the worktree and open the terminal.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          name: {
            type: 'string',
            description: 'Session name (will be sanitized for git branch)',
          },
          sourceBranch: {
            type: 'string',
            description: 'Source branch to create worktree from',
          },
          prompt: {
            type: 'string',
            description: 'Optional starting prompt for Claude',
          },
          workflow: {
            type: 'string',
            description:
              'Workflow template to use for this session. Ask the user which workflow they want. ' +
              'IMPORTANT: Must be an exact match of one of: feature, bugfix, refactor, default. ' +
              'If the workflow name is incorrect, session creation will fail.',
          },
        },
        required: ['name', 'sourceBranch'],
      },
    },
    {
      name: 'session_clear',
      description:
        'Clear the current Claude session by starting a fresh one. ' +
        'The existing terminal will be closed and a new one created with no conversation history. ' +
        'Workflow state is preserved and will be restored via the SessionStart hook.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    },
  ],
}));

// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: toolArgs } = request.params;

  try {
    switch (name) {
      case 'workflow_start': {
        // Initialize or restore workflow
        if (!machine) {
          // Extract optional summary from args, enforce max length
          let summary: string | undefined;
          if (typeof toolArgs?.summary === 'string' && toolArgs.summary.trim()) {
            const trimmed = toolArgs.summary.trim();
            // Truncate to approximately 10 words (max ~100 chars)
            summary = trimmed.length > 100 ? trimmed.substring(0, 97) + '...' : trimmed;
          }

          // Use ensureMachineLoaded to resume from disk
          machine = await ensureMachineLoaded();

          // If no machine exists, create a new one
          if (!machine) {
            const result = await tools.workflowStartFromPath(worktreePath, workflowPath, summary);
            machine = result.machine;
          }
        }

        // Check for pending context action
        const contextAction = machine.getContextActionIfNeeded();
        if (contextAction) {
          machine.markContextActionExecuted();
          await tools.saveState(worktreePath, machine.getState());

          if (contextAction === 'clear') {
            // Call session_clear tool to start fresh session
            const result = await tools.clearSession(worktreePath);
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  sessionCleared: true,
                  message: result.message || 'Session cleared. A fresh session will start.',
                  result
                }, null, 2)
              }]
            };
          }

          // contextAction === 'compact' - use /compact slash command
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                contextAction: '/compact',
                message: `Please run \`/compact\` first, then call workflow_status again.`
              }, null, 2)
            }]
          };
        }

        // Normal path: return status
        const status = tools.workflowStatus(machine);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      }

      case 'workflow_set_tasks': {
        if (!machine) {
          throw new Error('Workflow not started. Call workflow_start first.');
        }

        // Validate loop_id
        if (typeof toolArgs?.loop_id !== 'string' || !toolArgs.loop_id) {
          throw new Error('loop_id must be a non-empty string');
        }
        const loopId = toolArgs.loop_id;

        // Validate tasks array
        if (!Array.isArray(toolArgs?.tasks)) {
          throw new Error('tasks must be an array');
        }

        // Validate each task
        const taskInputs: Array<{ id: string; title: string; description?: string }> = [];
        for (const task of toolArgs.tasks) {
          if (typeof task !== 'object' || task === null) {
            throw new Error('Each task must be an object');
          }
          if (typeof task.id !== 'string' || !task.id) {
            throw new Error('Each task must have a non-empty id string');
          }
          if (typeof task.title !== 'string' || !task.title) {
            throw new Error('Each task must have a non-empty title string');
          }
          taskInputs.push({
            id: task.id,
            title: task.title,
            description: typeof task.description === 'string' ? task.description : undefined,
          });
        }

        // Convert to Task format (adding status)
        const tasks: Task[] = taskInputs.map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          status: 'pending' as const,
        }));

        await tools.workflowSetTasks(machine, loopId, tasks, worktreePath);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, tasksSet: tasks.length }),
            },
          ],
        };
      }

      case 'workflow_status': {
        // Try to load machine from memory or disk
        machine = await ensureMachineLoaded();

        if (!machine) {
          throw new Error('Workflow not started. Call workflow_start first.');
        }

        // Check for pending context action
        const contextAction = machine.getContextActionIfNeeded();
        if (contextAction) {
          const command = contextAction === 'compact' ? '/compact' : '/clear';
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                contextAction: command,
                message: `Please run \`${command}\` first, then call workflow_status again.`
              }, null, 2)
            }]
          };
        }

        const status = tools.workflowStatus(machine);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      }

      case 'workflow_advance': {
        if (!machine) {
          throw new Error('Workflow not started. Call workflow_start first.');
        }
        // Validate output
        if (toolArgs?.output !== undefined && typeof toolArgs.output !== 'string') {
          throw new Error('output must be a string');
        }
        const output = (toolArgs?.output as string) || '';
        const status = await tools.workflowAdvance(machine, output, worktreePath);

        // Check for pending context action on the NEW step
        const contextAction = machine.getContextActionIfNeeded();
        if (contextAction) {
          machine.markContextActionExecuted();
          await tools.saveState(worktreePath, machine.getState());

          if (contextAction === 'clear') {
            // Call session_clear tool to start fresh session
            const result = await tools.clearSession(worktreePath);
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({
                  sessionCleared: true,
                  message: result.message || 'Session cleared. A fresh session will start.',
                  result
                }, null, 2)
              }]
            };
          }

          // contextAction === 'compact' - use /compact slash command
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                contextAction: '/compact',
                message: `Please run \`/compact\` first, then call workflow_status again.`
              }, null, 2)
            }]
          };
        }

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
        };
      }

      case 'workflow_context': {
        if (!machine) {
          throw new Error('Workflow not started. Call workflow_start first.');
        }
        const context = tools.workflowContext(machine);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
        };
      }

      case 'register_artefacts': {
        if (!machine) {
          throw new Error('Workflow not started. Call workflow_start first.');
        }

        if (!Array.isArray(toolArgs?.paths)) {
          throw new Error('paths must be an array');
        }

        const paths: string[] = toolArgs.paths.map((p: unknown) => {
          if (typeof p !== 'string') {
            throw new Error('Each path must be a string');
          }
          return p;
        });

        const result = await tools.workflowRegisterArtefacts(machine, paths, worktreePath);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'session_create': {
        const { name: sessionName, sourceBranch, prompt, workflow } = toolArgs as {
          name: string;
          sourceBranch: string;
          prompt?: string;
          workflow?: string;
        };

        if (!sessionName || !sourceBranch) {
          throw new Error('name and sourceBranch are required');
        }

        const result = await tools.createSession(sessionName, sourceBranch, prompt, workflow, repoRoot);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'session_clear': {
        // Write a clear request file that the VS Code extension will process
        const result = await tools.clearSession(worktreePath);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Use stderr for logging so it doesn't interfere with stdio protocol
  console.error(`Lanes workflow MCP server started`);
  console.error(`  Worktree: ${worktreePath}`);
  console.error(`  Workflow: ${workflowPath}`);
  console.error(`  Repo root: ${repoRoot}`);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
