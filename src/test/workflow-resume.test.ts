import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowStateMachine, loadWorkflowTemplateFromString } from '../workflow';
import { saveState, loadState, getStatePath } from '../mcp/tools';

// Valid workflow template YAML for testing resume behavior
const TEST_WORKFLOW_YAML = `
name: test-resume-workflow
description: A test workflow for resume functionality

agents:
  implementer:
    description: Code implementer

loops:
  task_loop:
    - id: implement
      agent: implementer
      instructions: Implement the task
    - id: verify
      instructions: Verify the implementation

steps:
  - id: plan
    type: action
    instructions: Plan the work
  - id: task_loop
    type: loop
  - id: review
    type: action
    agent: implementer
    instructions: Review all work
`;

suite('Workflow Resume Tests', () => {
	let tempDir: string;
	let testFile: string;

	setup(() => {
		// Create a temporary directory for testing
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
		// Create a test artefact file
		testFile = path.join(tempDir, 'test-artefact.txt');
		fs.writeFileSync(testFile, 'test content');
	});

	teardown(() => {
		// Clean up temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('loadState returns null when no state exists', async () => {
		// Act: Try to load state from empty directory
		const state = await loadState(tempDir);

		// Assert: loadState should return null for non-existent state
		assert.strictEqual(state, null, 'loadState should return null for non-existent state');
	});

	test('loadState returns state when workflow-state.json exists', async () => {
		// Arrange: Create and save a workflow state
		const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
		const machine = new WorkflowStateMachine(template);
		machine.start();
		await saveState(tempDir, machine.getState());

		// Verify the state file exists
		const statePath = getStatePath(tempDir);
		assert.strictEqual(fs.existsSync(statePath), true, 'State file should exist');

		// Act: Load the state
		const loadedState = await loadState(tempDir);

		// Assert: State should be loaded and match expected values
		assert.ok(loadedState, 'loadState should return state');
		assert.strictEqual(loadedState!.status, 'running', 'Status should be running');
	});

	test('WorkflowStateMachine.fromState restores correctly', async () => {
		// Arrange: Create a workflow machine, start it, and save state
		const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
		const originalMachine = new WorkflowStateMachine(template);
		originalMachine.start();
		const originalStatus = originalMachine.getStatus();
		await saveState(tempDir, originalMachine.getState());

		// Act: Load state and create machine from it
		const loadedState = await loadState(tempDir);
		const restoredMachine = WorkflowStateMachine.fromState(template, loadedState!);
		const restoredStatus = restoredMachine.getStatus();

		// Assert: Status should match
		assert.strictEqual(restoredStatus.step, originalStatus.step, 'Step should match');
		assert.strictEqual(restoredStatus.status, originalStatus.status, 'Status should match');
		assert.strictEqual(restoredStatus.stepType, originalStatus.stepType, 'Step type should match');
	});

	test('saveState creates workflow-state.json in worktree', async () => {
		// Arrange: Create a workflow machine and start it
		const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
		const machine = new WorkflowStateMachine(template);
		machine.start();

		// Act: Save the state
		await saveState(tempDir, machine.getState());

		// Assert: State file should exist at correct path
		const statePath = getStatePath(tempDir);
		assert.strictEqual(fs.existsSync(statePath), true, 'State file should exist');
		assert.strictEqual(statePath, path.join(tempDir, 'workflow-state.json'), 'State file path should be correct');
	});

	test('saveState overwrites existing state file', async () => {
		// Arrange: Create and save initial state
		const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
		const machine = new WorkflowStateMachine(template);
		machine.start();
		await saveState(tempDir, machine.getState());

		// Get initial state content
		const initialContent = fs.readFileSync(getStatePath(tempDir), 'utf-8');

		// Act: Advance and save new state
		machine.advance('First step complete');
		await saveState(tempDir, machine.getState());

		// Get updated state content
		const updatedContent = fs.readFileSync(getStatePath(tempDir), 'utf-8');

		// Assert: Content should be different
		assert.notStrictEqual(initialContent, updatedContent, 'State file should be updated');
	});

	test('loadState and saveState round trip preserves all state fields', async () => {
		// Arrange: Create a workflow machine with some progress
		const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
		const machine = new WorkflowStateMachine(template);
		machine.start();
		machine.setSummary('Test summary');
		machine.registerArtefacts([testFile]);
		machine.advance('Step 1 output');

		const originalState = machine.getState();

		// Act: Save and load state
		await saveState(tempDir, originalState);
		const loadedState = await loadState(tempDir);

		// Assert: All fields should be preserved
		assert.ok(loadedState, 'State should be loaded');
		assert.strictEqual(loadedState!.status, originalState.status, 'Status should match');
		assert.strictEqual(loadedState!.step, originalState.step, 'Step should match');
		assert.strictEqual(loadedState!.stepType, originalState.stepType, 'StepType should match');
		assert.deepStrictEqual(loadedState!.outputs, originalState.outputs, 'Outputs should match');
		assert.deepStrictEqual(loadedState!.artefacts, originalState.artefacts, 'Artefacts should match');
	});

	test('fromState preserves task context when restoring loop state', async () => {
		// Arrange: Create a workflow machine and advance to a loop with tasks
		const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
		const machine = new WorkflowStateMachine(template);
		machine.start();
		machine.advance('Plan done');

		// Set tasks for the loop (use 'task_loop' which is the loop id in the YAML)
		machine.setTasks('task_loop', [
			{ id: 'task1', title: 'First task', status: 'pending' },
			{ id: 'task2', title: 'Second task', status: 'pending' }
		]);

		const originalStatus = machine.getStatus();

		// Act: Save, load, and restore state
		await saveState(tempDir, machine.getState());
		const loadedState = await loadState(tempDir);
		const restoredMachine = WorkflowStateMachine.fromState(template, loadedState!);
		const restoredStatus = restoredMachine.getStatus();

		// Assert: Task context should be preserved
		assert.strictEqual(restoredStatus.step, originalStatus.step, 'Step should match');
		assert.ok(restoredStatus.task, 'Task context should exist');
		assert.strictEqual(restoredStatus.task?.id, originalStatus.task?.id, 'Task ID should match');
		assert.strictEqual(restoredStatus.task?.total, originalStatus.task?.total, 'Total tasks should match');
	});

	test('getStatePath returns correct path for worktree', () => {
		// Act: Get state path
		const statePath = getStatePath(tempDir);

		// Assert: Path should be correct
		assert.strictEqual(statePath, path.join(tempDir, 'workflow-state.json'));
		assert.ok(statePath.endsWith('workflow-state.json'), 'Path should end with workflow-state.json');
	});
});
