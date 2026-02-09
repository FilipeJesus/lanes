/**
 * MCP Workflow Control Tests
 *
 * Tests for the MCP tool handlers that control workflow execution:
 * - workflowStart
 * - workflowSetTasks
 * - workflowAdvance
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	workflowStart,
	workflowSetTasks,
	workflowAdvance,
} from '../../mcp/tools';
import { Task } from '../../workflow';

const TEST_WORKFLOW_YAML = `
name: test-workflow
description: A test workflow for MCP tools

agents:
  implementer:
    description: Code implementer
    tools: [read, write, edit]
    cannot: [commit]
  reviewer:
    description: Code reviewer
    tools: [read]
    cannot: [write]

loops:
  task_loop:
    - id: implement
      agent: implementer
      instructions: Implement the feature
    - id: review
      agent: reviewer
      instructions: Review the implementation

steps:
  - id: plan
    type: action
    instructions: Plan the work
  - id: task_loop
    type: loop
  - id: cleanup
    type: action
    instructions: Clean up and finalize
`;

const SIMPLE_WORKFLOW_YAML = `
name: simple-workflow
description: A simple workflow without loops

agents:
  default:
    description: Default agent
    tools: [read]
    cannot: []

loops: {}

steps:
  - id: step1
    type: action
    instructions: First step
  - id: step2
    type: action
    instructions: Second step
`;

suite('MCP Workflow Control', () => {
	let tempDir: string;
	let templatesDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-control-test-'));
		templatesDir = path.join(tempDir, 'workflows');
		fs.mkdirSync(templatesDir, { recursive: true });

		fs.writeFileSync(
			path.join(templatesDir, 'test-workflow.yaml'),
			TEST_WORKFLOW_YAML
		);
		fs.writeFileSync(
			path.join(templatesDir, 'simple-workflow.yaml'),
			SIMPLE_WORKFLOW_YAML
		);
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('workflowStart', () => {
		test('workflowStart loads template and returns status', async () => {
			const result = await workflowStart(tempDir, 'test-workflow', templatesDir);

			assert.ok(result.machine);
			assert.ok(result.status);
			assert.strictEqual(result.status.status, 'running');
			assert.strictEqual(result.status.step, 'plan');
			assert.strictEqual(result.status.stepType, 'action');
			assert.strictEqual(result.status.instructions, 'Plan the work');
			assert.strictEqual(result.status.progress.currentStep, 1);
			assert.strictEqual(result.status.progress.totalSteps, 3);
		});

		test('workflowStart saves initial state to workflow-state.json', async () => {
			await workflowStart(tempDir, 'test-workflow', templatesDir);

			const statePath = path.join(tempDir, 'workflow-state.json');
			assert.ok(fs.existsSync(statePath));

			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.strictEqual(savedState.status, 'running');
			assert.strictEqual(savedState.step, 'plan');
		});

		test('workflowStart works with simple workflow', async () => {
			const result = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			assert.strictEqual(result.status.step, 'step1');
			assert.strictEqual(result.status.instructions, 'First step');
			assert.strictEqual(result.status.progress.totalSteps, 2);
		});

		test('workflowStart throws for non-existent template', async () => {
			await assert.rejects(
				async () => workflowStart(tempDir, 'non-existent', templatesDir),
				/ENOENT/
			);
		});
	});

	suite('workflowSetTasks', () => {
		test('workflowSetTasks sets tasks on state machine', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'task-1', title: 'Task One', status: 'pending' },
			];

			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			const status = machine.getStatus();
			assert.ok(status.task);
			assert.strictEqual(status.task.id, 'task-1');
			assert.strictEqual(status.task.title, 'Task One');
			assert.strictEqual(status.task.total, 1);
		});

		test('workflowSetTasks saves state after setting tasks', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'task-1', title: 'Task One', status: 'pending' },
			];

			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			const statePath = path.join(tempDir, 'workflow-state.json');
			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.ok(savedState.tasks);
			assert.ok(savedState.tasks['task_loop']);
		});
	});

	suite('workflowAdvance', () => {
		test('workflowAdvance advances through action steps', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const status = await workflowAdvance(machine, 'Step 1 done', tempDir);

			assert.strictEqual(status.step, 'step2');
			assert.strictEqual(status.instructions, 'Second step\n\nIMPORTANT: When you have completed this step, you MUST call workflow_advance with a summary of what you accomplished.');
		});

		test('workflowAdvance saves state after each advance', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			await workflowAdvance(machine, 'Step 1 output', tempDir);

			const statePath = path.join(tempDir, 'workflow-state.json');
			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.strictEqual(savedState.step, 'step2');
			assert.ok(savedState.outputs['step1']);
		});

		test('workflowAdvance completes workflow after last step', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			await workflowAdvance(machine, 'Step 1 done', tempDir);

			const status = await workflowAdvance(machine, 'Step 2 done', tempDir);

			assert.strictEqual(status.status, 'complete');
		});

		test('workflowAdvance moves to cleanup step after loop completes', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'feature-1', title: 'Feature One', status: 'pending' },
			];
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			await workflowAdvance(machine, 'Implemented', tempDir);
			await workflowAdvance(machine, 'Reviewed', tempDir);

			const status = machine.getStatus();
			assert.strictEqual(status.step, 'cleanup');
		});
	});
});
