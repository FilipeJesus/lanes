import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowStateMachine, loadWorkflowTemplateFromString, type WorkflowState } from '../../core/workflow';
import { saveState, loadState, getStatePath } from '../../mcp/tools';

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
		// Simulate artefact registration (done by hook script in production)
		machine.getState().artefacts.push(testFile);
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

	suite('Workflow Definition Snapshot', () => {
		test('initial state includes workflow_definition snapshot', async () => {
			// Arrange: Create a workflow machine and start it
			const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
			const machine = new WorkflowStateMachine(template);
			machine.start();

			// Act: Get the state
			const state = machine.getState();

			// Assert: workflow_definition should be included
			assert.ok(state.workflow_definition, 'State should include workflow_definition snapshot');
			assert.strictEqual(state.workflow_definition!.name, 'test-resume-workflow', 'Workflow name should match');
			assert.strictEqual(state.workflow_definition!.description, 'A test workflow for resume functionality', 'Workflow description should match');
			assert.strictEqual(state.workflow_definition!.steps.length, 3, 'Should have 3 steps');
		});

		test('workflow_definition survives save/load round trip', async () => {
			// Arrange: Create a workflow machine and start it
			const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.advance('Plan done');

			// Act: Save and load state
			await saveState(tempDir, machine.getState());
			const loadedState = await loadState(tempDir);

			// Assert: workflow_definition should be preserved
			assert.ok(loadedState, 'State should be loaded');
			assert.ok(loadedState!.workflow_definition, 'Loaded state should include workflow_definition');
			assert.strictEqual(loadedState!.workflow_definition!.name, 'test-resume-workflow', 'Workflow name should match');
			assert.strictEqual(loadedState!.workflow_definition!.steps.length, 3, 'Should have 3 steps');
		});

		test('fromState uses workflow_definition when available', async () => {
			// Arrange: Create a workflow machine with original template
			const originalTemplate = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
			const originalMachine = new WorkflowStateMachine(originalTemplate);
			originalMachine.start();

			// Save state (which includes workflow_definition)
			await saveState(tempDir, originalMachine.getState());
			const loadedState = await loadState(tempDir);

			// Create a MODIFIED template (simulating YAML file changes during session)
			const modifiedYaml = TEST_WORKFLOW_YAML.replace('Plan the work', 'PLANNING PHASE - MODIFIED');
			const modifiedTemplate = loadWorkflowTemplateFromString(modifiedYaml);

			// Act: Restore using modified template - should use saved workflow_definition instead
			const restoredMachine = WorkflowStateMachine.fromState(modifiedTemplate, loadedState!);
			const restoredStatus = restoredMachine.getStatus();

			// Assert: Should use the SAVED definition, not the modified template
			// The instructions should be from the original, not the modified version
			assert.ok(restoredStatus.instructions.includes('Plan the work'), 'Should use original instructions from saved workflow_definition');
			assert.ok(!restoredStatus.instructions.includes('PLANNING PHASE - MODIFIED'), 'Should NOT use modified template instructions');
		});

		test('fromState falls back to provided template when workflow_definition is missing', async () => {
			// Arrange: Create a state WITHOUT workflow_definition (simulating old state files)
			const stateWithoutDefinition: WorkflowState = {
				status: 'running',
				step: 'plan',
				stepType: 'action',
				tasks: {},
				outputs: {},
				artefacts: [],
				currentStepArtefacts: false,
				contextActionExecuted: false,
				// workflow_definition is intentionally undefined
			};

			// Create a template
			const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);

			// Act: Restore state without workflow_definition
			const restoredMachine = WorkflowStateMachine.fromState(template, stateWithoutDefinition);
			const restoredStatus = restoredMachine.getStatus();

			// Assert: Should fall back to the provided template
			assert.strictEqual(restoredStatus.step, 'plan', 'Step should be restored');
			assert.ok(restoredStatus.instructions.includes('Plan the work'), 'Should use provided template');
		});

		test('workflow_definition enables resume even if YAML file is deleted', async () => {
			// Arrange: Create a workflow machine and save state
			const template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.advance('Plan complete');

			// Save state (which includes workflow_definition)
			await saveState(tempDir, machine.getState());
			const loadedState = await loadState(tempDir);

			// Create a dummy template (simulating deleted/missing YAML file)
			const dummyYaml = `
name: dummy
description: Dummy template
steps:
  - id: dummy
    type: action
    instructions: This should not be used
`;
			const dummyTemplate = loadWorkflowTemplateFromString(dummyYaml);

			// Act: Restore using dummy template - should use saved workflow_definition instead
			const restoredMachine = WorkflowStateMachine.fromState(dummyTemplate, loadedState!);
			const restoredStatus = restoredMachine.getStatus();

			// Assert: Should use the SAVED definition, not the dummy template
			assert.strictEqual(restoredStatus.step, 'task_loop', 'Should be at task_loop step (advanced from plan)');
			assert.ok(restoredStatus.stepType === 'loop', 'Should be a loop step');
			assert.ok(!restoredStatus.instructions.includes('This should not be used'), 'Should NOT use dummy template instructions');
		});
	});
});
