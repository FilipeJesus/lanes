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
  loadWorkflowTemplate,
  WorkflowState,
  Task,
} from '../workflow';
import * as path from 'path';

// Parse command-line arguments
// Expected: node server.js --worktree <path> --workflow <name>
const args = process.argv.slice(2);
let worktreePath = '';
let workflowName = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--worktree' && args[i + 1]) {
    worktreePath = args[i + 1];
    i++;
  } else if (args[i] === '--workflow' && args[i + 1]) {
    workflowName = args[i + 1];
    i++;
  }
}

if (!worktreePath) {
  console.error('Error: --worktree <path> is required');
  process.exit(1);
}

if (!workflowName) {
  console.error('Error: --workflow <name> is required');
  process.exit(1);
}

// Validate worktreePath - must be an absolute path
if (!path.isAbsolute(worktreePath)) {
  console.error('Error: --worktree must be an absolute path');
  process.exit(1);
}

// Validate workflowName - must be a simple name without path separators
if (
  workflowName.includes('/') ||
  workflowName.includes('\\') ||
  workflowName.includes('..') ||
  workflowName.includes('\0')
) {
  console.error('Error: --workflow must be a simple name without path separators');
  process.exit(1);
}

// Global state
let machine: WorkflowStateMachine | null = null;

// Determine templates directory (relative to server location)
// In production, this will be in the out/ directory, so we need to go up one level
const templatesDir = path.join(__dirname, '../../workflows');

/**
 * Initializes or restores the workflow state machine.
 */
async function initializeMachine(): Promise<WorkflowStateMachine> {
  // Try to load existing state
  const existingState = await tools.loadState(worktreePath);

  if (existingState) {
    // Restore from existing state
    const templatePath = path.join(templatesDir, `${workflowName}.yaml`);
    const template = await loadWorkflowTemplate(templatePath);
    return WorkflowStateMachine.fromState(template, existingState);
  }

  // Start fresh
  const result = await tools.workflowStart(worktreePath, workflowName, templatesDir);
  return result.machine;
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
        properties: {},
        required: [],
      },
    },
    {
      name: 'workflow_set_tasks',
      description:
        'Associate tasks with a loop step. Each task will be iterated through ' +
        'the loop sub-steps. Also syncs tasks to features.json for tracking.',
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
        'Returns step, sub-step (if in loop), agent, instructions, and progress.',
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
        'When a task completes (all sub-steps done), updates features.json.',
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
          machine = await initializeMachine();
        }
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
        if (!machine) {
          throw new Error('Workflow not started. Call workflow_start first.');
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
  console.error(`  Workflow: ${workflowName}`);
  console.error(`  Templates: ${templatesDir}`);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
