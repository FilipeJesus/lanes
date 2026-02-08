/**
 * MCP Workflow State and Context Tests
 *
 * Tests for workflow state management and context retrieval:
 * - workflowStatus
 * - workflowContext
 * - State persistence (saveState, loadState)
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	workflowStart,
	workflowStatus,
	workflowContext,
	saveState,
	loadState,
	getStatePath,
} from '../../mcp/tools';
import {
	WorkflowStateMachine,
	loadWorkflowTemplateFromString,
	WorkflowTemplate,
} from '../../workflow';

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

suite('MCP Workflow State and Context', () => {
	let tempDir: string;
	let templatesDir: string;
	let template: WorkflowTemplate;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-state-context-test-'));
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

		template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('workflowStatus', () => {
		test('workflowStatus returns current position with context', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);

			const status = workflowStatus(machine);

			assert.strictEqual(status.status, 'running');
			assert.strictEqual(status.step, 'plan');
			assert.strictEqual(status.stepType, 'action');
			assert.strictEqual(status.instructions, 'Plan the work\n\nIMPORTANT: When you have completed this step, you MUST call workflow_advance with a summary of what you accomplished.');
			assert.ok(status.progress);
			assert.strictEqual(status.progress.currentStep, 1);
			assert.strictEqual(status.progress.totalSteps, 3);
		});

		test('workflowStatus returns agent info when step has agent', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			const status = workflowStatus(machine);

			assert.strictEqual(status.agent, 'implementer');
			assert.strictEqual(status.delegate, true);
		});

		test('workflowStatus sets delegate to false when no agent assigned', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);

			const status = workflowStatus(machine);

			assert.strictEqual(status.agent, null);
			assert.strictEqual(status.delegate, false);
		});

		test('workflowStatus prepends delegation message to instructions when agent is assigned', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			const status = workflowStatus(machine);

			assert.ok(status.instructions.includes("SPAWN the 'implementer' sub-agent"));
			assert.ok(status.instructions.includes('Implement the feature'));
			assert.strictEqual(status.agent, 'implementer');
			assert.strictEqual(status.delegate, true);
		});

		test('workflowStatus includes task context in loop step', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task One', status: 'pending' },
				{ id: 'task-2', title: 'Task Two', status: 'pending' }
			]);

			const status = workflowStatus(machine);

			assert.ok(status.task);
			assert.strictEqual(status.task.id, 'task-1');
			assert.strictEqual(status.task.title, 'Task One');
			assert.strictEqual(status.task.index, 0);
			assert.strictEqual(status.task.total, 2);
		});

		test('workflowStatus includes sub-step progress', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			const status = workflowStatus(machine);

			assert.strictEqual(status.subStep, 'implement');
			assert.strictEqual(status.subStepIndex, 0);
			assert.strictEqual(status.totalSubSteps, 2);
		});

		test('workflowStatus returns complete status when workflow done', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			machine.advance('Step 1 done');
			machine.advance('Step 2 done');

			const status = workflowStatus(machine);

			assert.strictEqual(status.status, 'complete');
		});
	});

	suite('workflowContext', () => {
		test('workflowContext returns outputs from previous steps', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			machine.advance('Output from step 1');

			const context = workflowContext(machine);

			assert.strictEqual(context['step1'], 'Output from step 1');
		});

		test('workflowContext returns empty object when no outputs yet', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const context = workflowContext(machine);

			assert.deepStrictEqual(context, {});
		});

		test('workflowContext includes outputs from all completed steps', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			machine.advance('Output 1');
			machine.advance('Output 2');

			const context = workflowContext(machine);

			assert.strictEqual(context['step1'], 'Output 1');
			assert.strictEqual(context['step2'], 'Output 2');
		});

		test('workflowContext includes outputs from loop sub-steps', async () => {
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Plan output');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);
			machine.advance('Implementation output');

			const context = workflowContext(machine);

			assert.strictEqual(context['plan'], 'Plan output');
			assert.ok(
				Object.keys(context).some(k => k.includes('implement') || context[k] === 'Implementation output')
			);
		});
	});

	suite('State Persistence', () => {
		test('Workflow state persists across server restarts', async () => {
			const { machine: machine1 } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine1.advance('Planning done');
			machine1.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' },
				{ id: 'task-2', title: 'Task 2', status: 'pending' }
			]);
			machine1.advance('Implemented task 1');

			await saveState(tempDir, machine1.getState());

			const loadedState = await loadState(tempDir);
			assert.ok(loadedState);

			const machine2 = WorkflowStateMachine.fromState(template, loadedState);
			const status = machine2.getStatus();

			assert.strictEqual(status.step, 'task_loop');
			assert.strictEqual(status.subStep, 'review');
			assert.strictEqual(status.task?.id, 'task-1');
			assert.strictEqual(status.task?.index, 0);
		});

		test('saveState creates workflow-state.json file', async () => {
			const machine = new WorkflowStateMachine(template);
			machine.start();

			await saveState(tempDir, machine.getState());

			const statePath = getStatePath(tempDir);
			assert.ok(fs.existsSync(statePath));
		});

		test('loadState returns null for non-existent state', async () => {
			const state = await loadState(tempDir);
			assert.strictEqual(state, null);
		});

		test('loadState returns correct state structure', async () => {
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.advance('Plan output');
			await saveState(tempDir, machine.getState());

			const loadedState = await loadState(tempDir);

			assert.ok(loadedState);
			assert.strictEqual(loadedState.status, 'running');
			assert.strictEqual(loadedState.step, 'task_loop');
			assert.ok(loadedState.outputs);
			assert.strictEqual(loadedState.outputs['plan'], 'Plan output');
		});

		test('State includes task context for loop steps', async () => {
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.advance('Plan done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			await saveState(tempDir, machine.getState());
			const loadedState = await loadState(tempDir);

			assert.ok(loadedState);
			assert.ok(loadedState.tasks);
			assert.ok(loadedState.tasks['task_loop']);
			assert.strictEqual(loadedState.tasks['task_loop'].length, 1);
			assert.strictEqual(loadedState.tasks['task_loop'][0].id, 'task-1');
		});

		test('Restored state continues workflow correctly', async () => {
			const machine1 = new WorkflowStateMachine(template);
			machine1.start();
			machine1.advance('Plan done');
			machine1.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);
			machine1.advance('Implemented');

			await saveState(tempDir, machine1.getState());

			const loadedState = await loadState(tempDir);
			const machine2 = WorkflowStateMachine.fromState(template, loadedState!);

			const status = machine2.advance('Reviewed');

			assert.strictEqual(status.step, 'cleanup');
			assert.strictEqual(status.stepType, 'action');
		});

		test('getStatePath returns correct path', () => {
			const statePath = getStatePath(tempDir);
			assert.strictEqual(statePath, path.join(tempDir, 'workflow-state.json'));
		});
	});
});
