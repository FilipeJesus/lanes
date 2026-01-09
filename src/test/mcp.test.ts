/**
 * MCP Tools Tests
 *
 * Tests for the MCP tool handlers that control workflow execution.
 * These tests verify that MCP tools correctly interact with the workflow
 * state machine and persist state to features.json.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	workflowStart,
	workflowSetTasks,
	workflowAdvance,
	workflowStatus,
	workflowContext,
	saveState,
	loadState,
	getStatePath,
	createSession,
	PendingSessionConfig,
} from '../mcp/tools';
import {
	WorkflowStateMachine,
	loadWorkflowTemplateFromString,
	Task,
	WorkflowTemplate,
} from '../workflow';

/**
 * Valid workflow template YAML for testing.
 * Contains a loop step to test task iteration.
 */
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

/**
 * Simple workflow template without loops for basic tests.
 */
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

suite('MCP Tools', () => {
	let tempDir: string;
	let templatesDir: string;

	setup(() => {
		// Create temp directories for each test
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
		templatesDir = path.join(tempDir, 'workflows');
		fs.mkdirSync(templatesDir, { recursive: true });

		// Write test workflow templates
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
		// Clean up temp directories
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('workflowStart', () => {
		test('workflowStart loads template and returns status', async () => {
			// Arrange: Template is already written in setup

			// Act
			const result = await workflowStart(tempDir, 'test-workflow', templatesDir);

			// Assert
			assert.ok(result.machine, 'Should return a state machine');
			assert.ok(result.status, 'Should return initial status');
			assert.strictEqual(result.status.status, 'running', 'Status should be running');
			assert.strictEqual(result.status.step, 'plan', 'Should be at first step');
			assert.strictEqual(result.status.stepType, 'action', 'First step should be action type');
			assert.strictEqual(result.status.instructions, 'Plan the work', 'Should have correct instructions');
			assert.strictEqual(result.status.progress.currentStep, 1, 'Should be at step 1');
			assert.strictEqual(result.status.progress.totalSteps, 3, 'Should have 3 total steps');
		});

		test('workflowStart saves initial state to workflow-state.json', async () => {
			// Arrange & Act
			await workflowStart(tempDir, 'test-workflow', templatesDir);

			// Assert: State file should exist
			const statePath = getStatePath(tempDir);
			assert.ok(fs.existsSync(statePath), 'State file should be created');

			// Verify state contents
			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.strictEqual(savedState.status, 'running');
			assert.strictEqual(savedState.step, 'plan');
		});

		test('workflowStart works with simple workflow', async () => {
			// Act
			const result = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			// Assert
			assert.strictEqual(result.status.step, 'step1');
			assert.strictEqual(result.status.instructions, 'First step');
			assert.strictEqual(result.status.progress.totalSteps, 2);
		});

		test('workflowStart throws for non-existent template', async () => {
			// Act & Assert
			await assert.rejects(
				async () => workflowStart(tempDir, 'non-existent', templatesDir),
				/ENOENT/,
				'Should throw when template does not exist'
			);
		});
	});

	suite('workflowSetTasks', () => {
		test('workflowSetTasks syncs to features.json', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done'); // Move to loop step

			const tasks: Task[] = [
				{ id: 'feature-1', title: 'Feature One', status: 'pending' },
				{ id: 'feature-2', title: 'Feature Two', status: 'pending' },
			];

			// Act
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Assert: features.json should be created/updated
			const featuresPath = path.join(tempDir, 'features.json');
			assert.ok(fs.existsSync(featuresPath), 'features.json should be created');

			const features = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
			assert.strictEqual(features.features.length, 2, 'Should have 2 features');
			assert.strictEqual(features.features[0].id, 'feature-1');
			assert.strictEqual(features.features[0].description, 'Feature One');
			assert.strictEqual(features.features[0].passes, false, 'Feature should start as not passed');
			assert.strictEqual(features.features[1].id, 'feature-2');
			assert.strictEqual(features.features[1].description, 'Feature Two');
			assert.strictEqual(features.features[1].passes, false);
		});

		test('workflowSetTasks sets tasks on state machine', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'task-1', title: 'Task One', status: 'pending' },
			];

			// Act
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Assert: Machine should have tasks set
			const status = machine.getStatus();
			assert.ok(status.task, 'Status should have task context');
			assert.strictEqual(status.task.id, 'task-1');
			assert.strictEqual(status.task.title, 'Task One');
			assert.strictEqual(status.task.total, 1);
		});

		test('workflowSetTasks merges with existing features', async () => {
			// Arrange: Create features.json with existing feature
			const featuresPath = path.join(tempDir, 'features.json');
			fs.writeFileSync(featuresPath, JSON.stringify({
				features: [
					{ id: 'existing', description: 'Existing Feature', passes: true }
				]
			}));

			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'new-feature', title: 'New Feature', status: 'pending' },
			];

			// Act
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Assert: Should have both features
			const features = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
			assert.strictEqual(features.features.length, 2, 'Should have 2 features total');
			assert.ok(
				features.features.find((f: { id: string }) => f.id === 'existing'),
				'Existing feature should be preserved'
			);
			assert.ok(
				features.features.find((f: { id: string }) => f.id === 'new-feature'),
				'New feature should be added'
			);
		});

		test('workflowSetTasks avoids duplicate features by id', async () => {
			// Arrange: Create features.json with existing feature
			const featuresPath = path.join(tempDir, 'features.json');
			fs.writeFileSync(featuresPath, JSON.stringify({
				features: [
					{ id: 'feature-1', description: 'Old Description', passes: true }
				]
			}));

			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'feature-1', title: 'New Description', status: 'pending' },
			];

			// Act
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Assert: Should not duplicate
			const features = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
			assert.strictEqual(features.features.length, 1, 'Should not duplicate features');
			// Original description preserved (not overwritten)
			assert.strictEqual(features.features[0].description, 'Old Description');
		});

		test('workflowSetTasks saves state after setting tasks', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'task-1', title: 'Task One', status: 'pending' },
			];

			// Act
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Assert: State should include tasks
			const statePath = getStatePath(tempDir);
			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.ok(savedState.tasks, 'State should have tasks');
			assert.ok(savedState.tasks['task_loop'], 'Tasks should be keyed by loop id');
		});
	});

	suite('workflowAdvance', () => {
		test('workflowAdvance updates features.json on task completion', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done'); // -> task_loop

			const tasks: Task[] = [
				{ id: 'feature-1', title: 'Feature One', status: 'pending' },
				{ id: 'feature-2', title: 'Feature Two', status: 'pending' },
			];
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Complete first task (2 sub-steps: implement, review)
			await workflowAdvance(machine, 'Implemented feature 1', tempDir);
			await workflowAdvance(machine, 'Reviewed feature 1', tempDir);

			// Assert: First feature should be marked as passes: true
			const featuresPath = path.join(tempDir, 'features.json');
			const features = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));

			const feature1 = features.features.find((f: { id: string }) => f.id === 'feature-1');
			const feature2 = features.features.find((f: { id: string }) => f.id === 'feature-2');

			assert.strictEqual(feature1.passes, true, 'Completed feature should have passes: true');
			assert.strictEqual(feature2.passes, false, 'Incomplete feature should still have passes: false');
		});

		test('workflowAdvance advances through action steps', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			// Act
			const status = await workflowAdvance(machine, 'Step 1 done', tempDir);

			// Assert
			assert.strictEqual(status.step, 'step2');
			assert.strictEqual(status.instructions, 'Second step');
		});

		test('workflowAdvance saves state after each advance', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			// Act
			await workflowAdvance(machine, 'Step 1 output', tempDir);

			// Assert: State should reflect advancement
			const statePath = getStatePath(tempDir);
			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.strictEqual(savedState.step, 'step2');
			assert.ok(savedState.outputs['step1'], 'Output should be saved');
		});

		test('workflowAdvance completes workflow after last step', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			await workflowAdvance(machine, 'Step 1 done', tempDir);

			// Act
			const status = await workflowAdvance(machine, 'Step 2 done', tempDir);

			// Assert
			assert.strictEqual(status.status, 'complete');
		});

		test('workflowAdvance marks all features as passed when loop completes', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');

			const tasks: Task[] = [
				{ id: 'feature-1', title: 'Feature One', status: 'pending' },
			];
			await workflowSetTasks(machine, 'task_loop', tasks, tempDir);

			// Complete the single task (2 sub-steps)
			await workflowAdvance(machine, 'Implemented', tempDir);
			await workflowAdvance(machine, 'Reviewed', tempDir);

			// Assert: Feature should be marked as passed
			const featuresPath = path.join(tempDir, 'features.json');
			const features = JSON.parse(fs.readFileSync(featuresPath, 'utf-8'));
			assert.strictEqual(features.features[0].passes, true);

			// And we should now be at cleanup step
			const status = machine.getStatus();
			assert.strictEqual(status.step, 'cleanup');
		});
	});

	suite('workflowStatus', () => {
		test('workflowStatus returns current position with context', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);

			// Act
			const status = workflowStatus(machine);

			// Assert
			assert.strictEqual(status.status, 'running');
			assert.strictEqual(status.step, 'plan');
			assert.strictEqual(status.stepType, 'action');
			assert.strictEqual(status.instructions, 'Plan the work');
			assert.ok(status.progress, 'Should have progress');
			assert.strictEqual(status.progress.currentStep, 1);
			assert.strictEqual(status.progress.totalSteps, 3);
		});

		test('workflowStatus returns agent info when step has agent', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			// Act
			const status = workflowStatus(machine);

			// Assert: First sub-step has implementer agent
			assert.strictEqual(status.agent, 'implementer');
			assert.ok(status.agentConfig);
			assert.strictEqual(status.agentConfig.description, 'Code implementer');
		});

		test('workflowStatus includes task context in loop step', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task One', status: 'pending' },
				{ id: 'task-2', title: 'Task Two', status: 'pending' }
			]);

			// Act
			const status = workflowStatus(machine);

			// Assert
			assert.ok(status.task, 'Should have task context');
			assert.strictEqual(status.task.id, 'task-1');
			assert.strictEqual(status.task.title, 'Task One');
			assert.strictEqual(status.task.index, 0);
			assert.strictEqual(status.task.total, 2);
		});

		test('workflowStatus includes sub-step progress', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Planning done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			// Act
			const status = workflowStatus(machine);

			// Assert
			assert.strictEqual(status.subStep, 'implement');
			assert.strictEqual(status.subStepIndex, 0);
			assert.strictEqual(status.totalSubSteps, 2);
		});

		test('workflowStatus returns complete status when workflow done', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			machine.advance('Step 1 done');
			machine.advance('Step 2 done');

			// Act
			const status = workflowStatus(machine);

			// Assert
			assert.strictEqual(status.status, 'complete');
		});
	});

	suite('workflowContext', () => {
		test('workflowContext returns outputs from previous steps', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			machine.advance('Output from step 1');

			// Act
			const context = workflowContext(machine);

			// Assert
			assert.strictEqual(context['step1'], 'Output from step 1');
		});

		test('workflowContext returns empty object when no outputs yet', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			// Act
			const context = workflowContext(machine);

			// Assert
			assert.deepStrictEqual(context, {});
		});

		test('workflowContext includes outputs from all completed steps', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);
			machine.advance('Output 1');
			machine.advance('Output 2');

			// Act
			const context = workflowContext(machine);

			// Assert
			assert.strictEqual(context['step1'], 'Output 1');
			assert.strictEqual(context['step2'], 'Output 2');
		});

		test('workflowContext includes outputs from loop sub-steps', async () => {
			// Arrange
			const { machine } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine.advance('Plan output');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);
			machine.advance('Implementation output');

			// Act
			const context = workflowContext(machine);

			// Assert
			assert.strictEqual(context['plan'], 'Plan output');
			// Loop sub-step outputs should be keyed appropriately
			assert.ok(
				Object.keys(context).some(k => k.includes('implement') || context[k] === 'Implementation output'),
				'Should have loop sub-step output'
			);
		});
	});
});

suite('MCP State', () => {
	let tempDir: string;
	let templatesDir: string;
	let template: WorkflowTemplate;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-state-test-'));
		templatesDir = path.join(tempDir, 'workflows');
		fs.mkdirSync(templatesDir, { recursive: true });

		// Write test workflow template
		fs.writeFileSync(
			path.join(templatesDir, 'test-workflow.yaml'),
			TEST_WORKFLOW_YAML
		);

		// Load template for state restoration tests
		template = loadWorkflowTemplateFromString(TEST_WORKFLOW_YAML);
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('State Persistence', () => {
		test('Workflow state persists across server restarts', async () => {
			// Arrange: Start workflow and advance to a specific state
			const { machine: machine1 } = await workflowStart(tempDir, 'test-workflow', templatesDir);
			machine1.advance('Planning done');
			machine1.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' },
				{ id: 'task-2', title: 'Task 2', status: 'pending' }
			]);
			await workflowAdvance(machine1, 'Implemented task 1', tempDir);

			// Simulate server restart: load state from file
			const loadedState = await loadState(tempDir);
			assert.ok(loadedState, 'State should be loadable from file');

			// Act: Create new machine from loaded state
			const machine2 = WorkflowStateMachine.fromState(template, loadedState);
			const status = machine2.getStatus();

			// Assert: Should be at the same position
			assert.strictEqual(status.step, 'task_loop');
			assert.strictEqual(status.subStep, 'review', 'Should be at review sub-step');
			assert.strictEqual(status.task?.id, 'task-1');
			assert.strictEqual(status.task?.index, 0);
		});

		test('saveState creates workflow-state.json file', async () => {
			// Arrange
			const machine = new WorkflowStateMachine(template);
			machine.start();

			// Act
			await saveState(tempDir, machine.getState());

			// Assert
			const statePath = getStatePath(tempDir);
			assert.ok(fs.existsSync(statePath), 'State file should exist');
		});

		test('loadState returns null for non-existent state', async () => {
			// Act
			const state = await loadState(tempDir);

			// Assert
			assert.strictEqual(state, null);
		});

		test('loadState returns correct state structure', async () => {
			// Arrange
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.advance('Plan output');
			await saveState(tempDir, machine.getState());

			// Act
			const loadedState = await loadState(tempDir);

			// Assert
			assert.ok(loadedState);
			assert.strictEqual(loadedState.status, 'running');
			assert.strictEqual(loadedState.step, 'task_loop');
			assert.ok(loadedState.outputs);
			assert.strictEqual(loadedState.outputs['plan'], 'Plan output');
		});

		test('State includes task context for loop steps', async () => {
			// Arrange
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.advance('Plan done');
			machine.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);

			// Act
			await saveState(tempDir, machine.getState());
			const loadedState = await loadState(tempDir);

			// Assert
			assert.ok(loadedState);
			assert.ok(loadedState.tasks);
			assert.ok(loadedState.tasks['task_loop']);
			assert.strictEqual(loadedState.tasks['task_loop'].length, 1);
			assert.strictEqual(loadedState.tasks['task_loop'][0].id, 'task-1');
		});

		test('Restored state continues workflow correctly', async () => {
			// Arrange: Create and advance workflow
			const machine1 = new WorkflowStateMachine(template);
			machine1.start();
			machine1.advance('Plan done');
			machine1.setTasks('task_loop', [
				{ id: 'task-1', title: 'Task 1', status: 'pending' }
			]);
			machine1.advance('Implemented');

			await saveState(tempDir, machine1.getState());

			// Act: Restore and continue
			const loadedState = await loadState(tempDir);
			const machine2 = WorkflowStateMachine.fromState(template, loadedState!);

			// Continue from where we left off
			const status = machine2.advance('Reviewed');

			// Assert: Should have moved to cleanup step (loop complete)
			assert.strictEqual(status.step, 'cleanup');
			assert.strictEqual(status.stepType, 'action');
		});

		test('getStatePath returns correct path', () => {
			// Act
			const statePath = getStatePath(tempDir);

			// Assert
			assert.strictEqual(statePath, path.join(tempDir, 'workflow-state.json'));
		});
	});
});

/**
 * Tests for MCP createSession with workflow parameter.
 */
suite('MCP Session Creation with Workflow', () => {
	const PENDING_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'lanes', 'pending-sessions');

	// Clean up pending sessions after each test
	teardown(async () => {
		// Clean up any test session files
		try {
			const files = fs.readdirSync(PENDING_SESSIONS_DIR);
			for (const file of files) {
				if (file.startsWith('test-session-')) {
					fs.unlinkSync(path.join(PENDING_SESSIONS_DIR, file));
				}
			}
		} catch {
			// Directory might not exist, that's fine
		}
	});

	test('createSession accepts workflow parameter and includes it in config', async () => {
		// Act
		const result = await createSession('test-session-workflow', 'main', 'Test prompt', 'feature');

		// Assert
		assert.ok(result.success, 'createSession should succeed');
		assert.ok(result.configPath, 'Should have a config path');

		// Read the config file
		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, 'feature', 'Workflow should be included in config');
		assert.strictEqual(config.name, 'test-session-workflow');
		assert.strictEqual(config.sourceBranch, 'main');
		assert.strictEqual(config.prompt, 'Test prompt');

		// Clean up
		fs.unlinkSync(result.configPath!);
	});

	test('createSession works without workflow (undefined)', async () => {
		// Act
		const result = await createSession('test-session-no-workflow', 'main', 'Test prompt');

		// Assert
		assert.ok(result.success, 'createSession should succeed');
		assert.ok(result.configPath, 'Should have a config path');

		// Read the config file
		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, undefined, 'Workflow should be undefined');
		assert.strictEqual(config.name, 'test-session-no-workflow');

		// Clean up
		fs.unlinkSync(result.configPath!);
	});

	test('createSession trims workflow parameter', async () => {
		// Act
		const result = await createSession('test-session-trim', 'main', undefined, '  feature  ');

		// Assert
		assert.ok(result.success, 'createSession should succeed');
		assert.ok(result.configPath, 'Should have a config path');

		// Read the config file
		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, 'feature', 'Workflow should be trimmed');

		// Clean up
		fs.unlinkSync(result.configPath!);
	});

	test('createSession handles empty workflow string as undefined', async () => {
		// Act
		const result = await createSession('test-session-empty', 'main', undefined, '   ');

		// Assert
		assert.ok(result.success, 'createSession should succeed');
		assert.ok(result.configPath, 'Should have a config path');

		// Read the config file
		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, undefined, 'Empty workflow should become undefined');

		// Clean up
		fs.unlinkSync(result.configPath!);
	});

	test('createSession includes requestedAt timestamp', async () => {
		// Act
		const beforeTime = new Date().toISOString();
		const result = await createSession('test-session-timestamp', 'main');
		const afterTime = new Date().toISOString();

		// Assert
		assert.ok(result.success);
		assert.ok(result.configPath);

		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.ok(config.requestedAt, 'Should have requestedAt timestamp');
		assert.ok(config.requestedAt >= beforeTime, 'Timestamp should be after test start');
		assert.ok(config.requestedAt <= afterTime, 'Timestamp should be before test end');

		// Clean up
		fs.unlinkSync(result.configPath!);
	});
});
