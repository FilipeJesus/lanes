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
// Expected: node server.js --worktree <path> --workflow-path <path>
const args = process.argv.slice(2);
let worktreePath = '';
let workflowPath = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--worktree' && args[i + 1]) {
    worktreePath = args[i + 1];
    i++;
  } else if (args[i] === '--workflow-path' && args[i + 1]) {
    workflowPath = args[i + 1];
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

// Validate workflowPath - must end with .yaml
if (!workflowPath.endsWith('.yaml')) {
  console.error('Error: --workflow-path must end with .yaml');
  process.exit(1);
}

// Global state
let machine: WorkflowStateMachine | null = null;

/**
 * Initializes or restores the workflow state machine.
 * Uses the workflow path provided via --workflow-path argument.
 * @param summary - Optional brief summary of the user's request (max 10 words)
 */
async function initializeMachine(summary?: string): Promise<WorkflowStateMachine> {
  // Try to load existing state
  const existingState = await tools.loadState(worktreePath);

  if (existingState) {
    // Restore from existing state - use the workflow path directly
    const template = await loadWorkflowTemplate(workflowPath);
    return WorkflowStateMachine.fromState(template, existingState);
  }

  // Start fresh - use the workflow path directly
  const result = await tools.workflowStartFromPath(worktreePath, workflowPath, summary);
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
          machine = await initializeMachine(summary);
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

        const result = await tools.createSession(sessionName, sourceBranch, prompt, workflow);
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
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
