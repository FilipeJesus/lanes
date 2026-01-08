import * as assert from 'assert';
import * as path from 'path';
import {
	// Types
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
	// Loader
	loadWorkflowTemplate,
	loadWorkflowTemplateFromString,
	validateTemplate,
	WorkflowValidationError,
	// State machine
	WorkflowStateMachine,
} from '../workflow';

/**
 * Valid workflow template YAML for testing.
 */
const VALID_TEMPLATE_YAML = `
name: test-workflow
description: A test workflow

agents:
  orchestrator:
    description: Main orchestrator
    tools: [read, glob]
    cannot: [write]
  implementer:
    description: Code implementer
    tools: [read, write, edit]
    cannot: [commit]

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
    agent: orchestrator
    instructions: Review all work
`;

/**
 * Minimal valid workflow template YAML for testing.
 */
const MINIMAL_TEMPLATE_YAML = `
name: minimal-workflow
description: A minimal workflow

agents:
  default:
    description: Default agent
    tools: [read]
    cannot: []

loops: {}

steps:
  - id: only_step
    type: action
    instructions: Do something
`;

suite('Workflow Types', () => {
	test('All workflow types are properly exported', () => {
		// Test that type imports work by using them
		// These are compile-time checks - if types are not exported, this file won't compile

		// AgentConfig
		const agentConfig: AgentConfig = {
			description: 'Test agent',
			tools: ['read', 'write'],
			cannot: ['delete']
		};
		assert.ok(agentConfig.description);

		// LoopStep
		const loopStep: LoopStep = {
			id: 'step1',
			instructions: 'Do something',
			agent: 'test-agent',
			on_fail: 'retry'
		};
		assert.ok(loopStep.id);

		// WorkflowStep
		const workflowStep: WorkflowStep = {
			id: 'main-step',
			type: 'action',
			instructions: 'Main instructions'
		};
		assert.ok(workflowStep.type === 'action');

		// WorkflowTemplate
		const template: WorkflowTemplate = {
			name: 'test',
			description: 'Test workflow',
			agents: { test: agentConfig },
			loops: { testLoop: [loopStep] },
			steps: [workflowStep]
		};
		assert.ok(template.name);

		// Task
		const task: Task = {
			id: 'task1',
			title: 'Test task',
			status: 'pending'
		};
		assert.ok(task.status === 'pending');

		// TaskContext
		const taskContext: TaskContext = {
			index: 0,
			id: 'task1',
			title: 'Test task'
		};
		assert.ok(taskContext.index === 0);

		// WorkflowState
		const workflowState: WorkflowState = {
			status: 'running',
			step: 'step1',
			stepType: 'action',
			tasks: {},
			outputs: {}
		};
		assert.ok(workflowState.status === 'running');

		// WorkflowProgress
		const progress: WorkflowProgress = {
			currentStep: 1,
			totalSteps: 3
		};
		assert.ok(progress.currentStep === 1);

		// TaskStatusContext
		const taskStatusContext: TaskStatusContext = {
			index: 0,
			id: 'task1',
			title: 'Test task',
			total: 5
		};
		assert.ok(taskStatusContext.total === 5);

		// WorkflowStatusResponse
		const statusResponse: WorkflowStatusResponse = {
			status: 'running',
			step: 'step1',
			stepType: 'action',
			agent: null,
			instructions: 'Do something',
			progress: progress
		};
		assert.ok(statusResponse.status === 'running');
	});
});

suite('Workflow Loader', () => {
	suite('Valid Templates', () => {
		test('Loader parses valid YAML templates', () => {
			// Arrange & Act
			const template = loadWorkflowTemplateFromString(VALID_TEMPLATE_YAML);

			// Assert
			assert.strictEqual(template.name, 'test-workflow');
			assert.strictEqual(template.description, 'A test workflow');

			// Check agents
			assert.ok(template.agents.orchestrator);
			assert.strictEqual(template.agents.orchestrator.description, 'Main orchestrator');
			assert.deepStrictEqual(template.agents.orchestrator.tools, ['read', 'glob']);
			assert.deepStrictEqual(template.agents.orchestrator.cannot, ['write']);

			assert.ok(template.agents.implementer);
			assert.strictEqual(template.agents.implementer.description, 'Code implementer');
			assert.deepStrictEqual(template.agents.implementer.tools, ['read', 'write', 'edit']);
			assert.deepStrictEqual(template.agents.implementer.cannot, ['commit']);

			// Check loops
			assert.ok(template.loops.task_loop);
			assert.strictEqual(template.loops.task_loop.length, 2);
			assert.strictEqual(template.loops.task_loop[0].id, 'implement');
			assert.strictEqual(template.loops.task_loop[0].agent, 'implementer');
			assert.strictEqual(template.loops.task_loop[1].id, 'verify');

			// Check steps
			assert.strictEqual(template.steps.length, 3);
			assert.strictEqual(template.steps[0].id, 'plan');
			assert.strictEqual(template.steps[0].type, 'action');
			assert.strictEqual(template.steps[1].id, 'task_loop');
			assert.strictEqual(template.steps[1].type, 'loop');
			assert.strictEqual(template.steps[2].id, 'review');
			assert.strictEqual(template.steps[2].agent, 'orchestrator');
		});

		test('Loader parses minimal valid template', () => {
			// Arrange & Act
			const template = loadWorkflowTemplateFromString(MINIMAL_TEMPLATE_YAML);

			// Assert
			assert.strictEqual(template.name, 'minimal-workflow');
			assert.strictEqual(template.steps.length, 1);
			assert.ok(template.agents.default);
			assert.deepStrictEqual(template.loops, {});
		});

		test('validateTemplate returns true for valid template object', () => {
			// Arrange
			const templateObj = {
				name: 'valid-template',
				description: 'A valid template',
				agents: {
					agent1: {
						description: 'Agent 1',
						tools: ['read'],
						cannot: []
					}
				},
				loops: {},
				steps: [
					{ id: 'step1', type: 'action', instructions: 'Do something' }
				]
			};

			// Act & Assert
			assert.ok(validateTemplate(templateObj));
		});
	});

	suite('Invalid Templates', () => {
		test('Loader rejects template with missing name', () => {
			const invalidYaml = `
description: Missing name
agents: {}
loops: {}
steps:
  - id: step1
    type: action
    instructions: Do something
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for missing name'
			);
		});

		test('Loader rejects template with missing description', () => {
			const invalidYaml = `
name: missing-description
agents: {}
loops: {}
steps:
  - id: step1
    type: action
    instructions: Do something
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for missing description'
			);
		});

		test('Loader rejects template with missing agents', () => {
			const invalidYaml = `
name: missing-agents
description: A template
loops: {}
steps:
  - id: step1
    type: action
    instructions: Do something
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for missing agents'
			);
		});

		test('Loader rejects template with empty steps', () => {
			const invalidYaml = `
name: empty-steps
description: A template
agents: {}
loops: {}
steps: []
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for empty steps'
			);
		});

		test('Loader rejects template with invalid step type', () => {
			const invalidYaml = `
name: invalid-step-type
description: A template
agents: {}
loops: {}
steps:
  - id: step1
    type: invalid
    instructions: Do something
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for invalid step type'
			);
		});

		test('Loader rejects template with action step missing instructions', () => {
			const invalidYaml = `
name: missing-instructions
description: A template
agents: {}
loops: {}
steps:
  - id: step1
    type: action
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for action step without instructions'
			);
		});

		test('Loader rejects template with unknown agent reference', () => {
			const invalidYaml = `
name: unknown-agent
description: A template
agents:
  known_agent:
    description: Known agent
    tools: [read]
    cannot: []
loops: {}
steps:
  - id: step1
    type: action
    agent: unknown_agent
    instructions: Do something
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for unknown agent reference'
			);
		});

		test('Loader rejects template with unknown loop reference', () => {
			const invalidYaml = `
name: unknown-loop
description: A template
agents: {}
loops: {}
steps:
  - id: unknown_loop
    type: loop
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for unknown loop reference'
			);
		});

		test('Loader rejects template with agent missing description', () => {
			const invalidYaml = `
name: agent-missing-description
description: A template
agents:
  bad_agent:
    tools: [read]
    cannot: []
loops: {}
steps:
  - id: step1
    type: action
    instructions: Do something
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for agent missing description'
			);
		});

		test('Loader rejects template with loop step missing instructions', () => {
			const invalidYaml = `
name: loop-step-missing-instructions
description: A template
agents: {}
loops:
  my_loop:
    - id: sub_step
      agent: some_agent
steps:
  - id: my_loop
    type: loop
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for loop step missing instructions'
			);
		});

		test('Loader rejects invalid YAML syntax', () => {
			const invalidYaml = `
name: test
description: test
agents: {not: valid yaml structure
`;
			assert.throws(
				() => loadWorkflowTemplateFromString(invalidYaml),
				WorkflowValidationError,
				'Should throw WorkflowValidationError for invalid YAML syntax'
			);
		});

		test('Loader throws descriptive error message', () => {
			const invalidYaml = `
name: 123
description: A template
agents: {}
loops: {}
steps:
  - id: step1
    type: action
    instructions: Do something
`;
			try {
				loadWorkflowTemplateFromString(invalidYaml);
				assert.fail('Should have thrown an error');
			} catch (error) {
				assert.ok(error instanceof WorkflowValidationError);
				assert.ok(error.message.includes('name'), `Error message should mention 'name': ${error.message}`);
			}
		});
	});
});

suite('Workflow State Machine', () => {
	let validTemplate: WorkflowTemplate;

	setup(() => {
		validTemplate = loadWorkflowTemplateFromString(VALID_TEMPLATE_YAML);
	});

	suite('Start', () => {
		test('State machine starts at first step', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);

			// Act
			const status = machine.start();

			// Assert
			assert.strictEqual(status.status, 'running');
			assert.strictEqual(status.step, 'plan');
			assert.strictEqual(status.stepType, 'action');
			assert.strictEqual(status.instructions, 'Plan the work');
			assert.strictEqual(status.progress.currentStep, 1);
			assert.strictEqual(status.progress.totalSteps, 3);
		});

		test('Start returns first step with correct agent info', () => {
			// Arrange: Template where first step has an agent
			const templateWithAgent = loadWorkflowTemplateFromString(`
name: agent-first-step
description: Template with agent on first step

agents:
  starter:
    description: Starting agent
    tools: [read]
    cannot: [write]

loops: {}

steps:
  - id: start
    type: action
    agent: starter
    instructions: Start the workflow
`);
			const machine = new WorkflowStateMachine(templateWithAgent);

			// Act
			const status = machine.start();

			// Assert
			assert.strictEqual(status.agent, 'starter');
			assert.ok(status.agentConfig);
			assert.strictEqual(status.agentConfig.description, 'Starting agent');
			assert.deepStrictEqual(status.agentConfig.tools, ['read']);
		});

		test('Start on minimal template works correctly', () => {
			// Arrange
			const minimalTemplate = loadWorkflowTemplateFromString(MINIMAL_TEMPLATE_YAML);
			const machine = new WorkflowStateMachine(minimalTemplate);

			// Act
			const status = machine.start();

			// Assert
			assert.strictEqual(status.status, 'running');
			assert.strictEqual(status.step, 'only_step');
			assert.strictEqual(status.progress.totalSteps, 1);
		});
	});

	suite('Advance Action Steps', () => {
		test('State machine advances through action steps', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();

			// Act: Advance from first step (plan)
			const status = machine.advance('Planning complete');

			// Assert: Now at second step (task_loop)
			assert.strictEqual(status.status, 'running');
			assert.strictEqual(status.step, 'task_loop');
			assert.strictEqual(status.stepType, 'loop');
		});

		test('Advance stores output from completed step', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();

			// Act
			machine.advance('Planning output content');

			// Assert
			const context = machine.getContext();
			assert.strictEqual(context['plan'], 'Planning output content');
		});

		test('Advancing from last action step completes workflow', () => {
			// Arrange: Simple single-step workflow
			const singleStepTemplate = loadWorkflowTemplateFromString(MINIMAL_TEMPLATE_YAML);
			const machine = new WorkflowStateMachine(singleStepTemplate);
			machine.start();

			// Act
			const status = machine.advance('Done');

			// Assert
			assert.strictEqual(status.status, 'complete');
		});

		test('Multiple action steps advance sequentially', () => {
			// Arrange
			const multiActionTemplate = loadWorkflowTemplateFromString(`
name: multi-action
description: Multiple action steps

agents: {}
loops: {}

steps:
  - id: step1
    type: action
    instructions: First step
  - id: step2
    type: action
    instructions: Second step
  - id: step3
    type: action
    instructions: Third step
`);
			const machine = new WorkflowStateMachine(multiActionTemplate);
			machine.start();

			// Act & Assert
			let status = machine.advance('Output 1');
			assert.strictEqual(status.step, 'step2');

			status = machine.advance('Output 2');
			assert.strictEqual(status.step, 'step3');

			status = machine.advance('Output 3');
			assert.strictEqual(status.status, 'complete');
		});
	});

	suite('Advance Loop Steps', () => {
		test('State machine advances through loop sub-steps', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done'); // Move to task_loop

			// Set tasks for the loop
			const tasks: Task[] = [
				{ id: 'task1', title: 'First task', status: 'pending' },
				{ id: 'task2', title: 'Second task', status: 'pending' }
			];
			machine.setTasks('task_loop', tasks);

			// Act: Get current status after setting tasks
			const status = machine.getStatus();

			// Assert: Should be at first sub-step of first task
			assert.strictEqual(status.step, 'task_loop');
			assert.strictEqual(status.stepType, 'loop');
			assert.strictEqual(status.subStep, 'implement');
			assert.ok(status.task);
			assert.strictEqual(status.task.index, 0);
			assert.strictEqual(status.task.id, 'task1');
		});

		test('State machine advances through all sub-steps of a task', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done');

			const tasks: Task[] = [
				{ id: 'task1', title: 'First task', status: 'pending' }
			];
			machine.setTasks('task_loop', tasks);

			// Act: Advance through first sub-step (implement)
			let status = machine.advance('Implemented');

			// Assert: Now at second sub-step (verify)
			assert.strictEqual(status.subStep, 'verify');
			assert.strictEqual(status.task?.id, 'task1');

			// Act: Advance through second sub-step
			status = machine.advance('Verified');

			// Assert: Loop complete, moved to next step (review)
			assert.strictEqual(status.step, 'review');
			assert.strictEqual(status.stepType, 'action');
		});

		test('State machine iterates through all tasks in loop', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done');

			const tasks: Task[] = [
				{ id: 'task1', title: 'First task', status: 'pending' },
				{ id: 'task2', title: 'Second task', status: 'pending' }
			];
			machine.setTasks('task_loop', tasks);

			// Complete first task (2 sub-steps)
			machine.advance('Task 1 implemented');
			machine.advance('Task 1 verified');

			// Act: Get status after first task
			let status = machine.getStatus();

			// Assert: Now on second task, first sub-step
			assert.strictEqual(status.task?.id, 'task2');
			assert.strictEqual(status.task?.index, 1);
			assert.strictEqual(status.subStep, 'implement');

			// Complete second task
			machine.advance('Task 2 implemented');
			status = machine.advance('Task 2 verified');

			// Assert: Loop complete, moved to review step
			assert.strictEqual(status.step, 'review');
		});

		test('Loop with no tasks advances to next step', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done');

			// Set empty tasks
			machine.setTasks('task_loop', []);

			// Act
			const status = machine.getStatus();

			// Assert: Should have advanced to review step
			assert.strictEqual(status.step, 'review');
		});

		test('Loop step includes task progress in status', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done');

			const tasks: Task[] = [
				{ id: 'task1', title: 'First task', status: 'pending' },
				{ id: 'task2', title: 'Second task', status: 'pending' },
				{ id: 'task3', title: 'Third task', status: 'pending' }
			];
			machine.setTasks('task_loop', tasks);

			// Act
			const status = machine.getStatus();

			// Assert
			assert.ok(status.task);
			assert.strictEqual(status.task.total, 3);
			assert.ok(status.progress.currentTaskProgress);
			assert.ok(status.progress.totalTasks === 3);
		});

		test('Loop step includes sub-step index in status', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done');

			const tasks: Task[] = [
				{ id: 'task1', title: 'First task', status: 'pending' }
			];
			machine.setTasks('task_loop', tasks);

			// Act
			const status = machine.getStatus();

			// Assert
			assert.strictEqual(status.subStepIndex, 0);
			assert.strictEqual(status.totalSubSteps, 2);
		});
	});

	suite('Complete Workflow', () => {
		test('State machine marks workflow complete after last step', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done'); // -> task_loop
			machine.setTasks('task_loop', []); // No tasks, skip to review

			// Act: Complete the review step
			const status = machine.advance('Review done');

			// Assert
			assert.strictEqual(status.status, 'complete');
			assert.strictEqual(status.instructions, 'Workflow complete.');
		});

		test('Complete workflow has all outputs in context', () => {
			// Arrange
			const simpleTemplate = loadWorkflowTemplateFromString(`
name: simple
description: Simple workflow

agents: {}
loops: {}

steps:
  - id: step1
    type: action
    instructions: Step 1
  - id: step2
    type: action
    instructions: Step 2
`);
			const machine = new WorkflowStateMachine(simpleTemplate);
			machine.start();
			machine.advance('Output 1');
			machine.advance('Output 2');

			// Act
			const context = machine.getContext();

			// Assert
			assert.strictEqual(context['step1'], 'Output 1');
			assert.strictEqual(context['step2'], 'Output 2');
		});

		test('Advancing a complete workflow returns complete status', () => {
			// Arrange
			const minimalTemplate = loadWorkflowTemplateFromString(MINIMAL_TEMPLATE_YAML);
			const machine = new WorkflowStateMachine(minimalTemplate);
			machine.start();
			machine.advance('Done');

			// Act: Try to advance again
			const status = machine.advance('More output');

			// Assert: Still complete
			assert.strictEqual(status.status, 'complete');
		});

		test('Complete workflow progress shows final step', () => {
			// Arrange
			const minimalTemplate = loadWorkflowTemplateFromString(MINIMAL_TEMPLATE_YAML);
			const machine = new WorkflowStateMachine(minimalTemplate);
			machine.start();
			const status = machine.advance('Done');

			// Assert
			assert.strictEqual(status.progress.currentStep, 1);
			assert.strictEqual(status.progress.totalSteps, 1);
		});
	});

	suite('State Persistence', () => {
		test('getState returns current state for persistence', () => {
			// Arrange
			const machine = new WorkflowStateMachine(validTemplate);
			machine.start();
			machine.advance('Plan done');

			// Act
			const state = machine.getState();

			// Assert
			assert.strictEqual(state.status, 'running');
			assert.strictEqual(state.step, 'task_loop');
			assert.strictEqual(state.stepType, 'loop');
			assert.ok(state.outputs['plan']);
		});

		test('fromState restores workflow at saved position', () => {
			// Arrange
			const machine1 = new WorkflowStateMachine(validTemplate);
			machine1.start();
			machine1.advance('Plan done');
			machine1.setTasks('task_loop', [
				{ id: 'task1', title: 'Task 1', status: 'pending' }
			]);
			machine1.advance('Implemented');

			const savedState = machine1.getState();

			// Act: Create new machine from saved state
			const machine2 = WorkflowStateMachine.fromState(validTemplate, savedState);
			const status = machine2.getStatus();

			// Assert
			assert.strictEqual(status.step, 'task_loop');
			assert.strictEqual(status.subStep, 'verify');
			assert.strictEqual(status.task?.id, 'task1');
		});
	});
});

/**
 * Get the path to the workflows directory.
 * This handles both development (src) and compiled (out) contexts.
 */
function getWorkflowsDir(): string {
	// __dirname will be either src/test or out/test
	// workflows is at the root of the extension
	return path.join(__dirname, '..', '..', 'workflows');
}

suite('Built-in Templates', () => {
	test('Feature workflow template loads and validates', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'feature.yaml');

		// Act
		const template = await loadWorkflowTemplate(templatePath);

		// Assert
		assert.strictEqual(template.name, 'feature');
		assert.strictEqual(template.description, 'Plan and implement a new feature');

		// Verify agents
		assert.ok(template.agents.orchestrator, 'Should have orchestrator agent');
		assert.ok(template.agents.implementer, 'Should have implementer agent');
		assert.ok(template.agents.tester, 'Should have tester agent');
		assert.ok(template.agents.reviewer, 'Should have reviewer agent');

		// Verify loops
		assert.ok(template.loops.feature_development, 'Should have feature_development loop');
		assert.strictEqual(template.loops.feature_development.length, 4, 'Should have 4 sub-steps in loop');

		// Verify steps
		assert.strictEqual(template.steps.length, 5, 'Should have 5 main steps');
		assert.strictEqual(template.steps[0].id, 'plan');
		assert.strictEqual(template.steps[1].id, 'define_tasks');
		assert.strictEqual(template.steps[2].id, 'feature_development');
		assert.strictEqual(template.steps[2].type, 'loop');
		assert.strictEqual(template.steps[3].id, 'final_review');
		assert.strictEqual(template.steps[4].id, 'final_resolution');
	});

	test('Bugfix workflow template loads and validates', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'bugfix.yaml');

		// Act
		const template = await loadWorkflowTemplate(templatePath);

		// Assert
		assert.strictEqual(template.name, 'bugfix');
		assert.strictEqual(template.description, 'Investigate and fix a bug');

		// Verify agents
		assert.ok(template.agents.orchestrator, 'Should have orchestrator agent');
		assert.ok(template.agents.investigator, 'Should have investigator agent');
		assert.ok(template.agents.fixer, 'Should have fixer agent');
		assert.ok(template.agents.verifier, 'Should have verifier agent');

		// Verify loops
		assert.ok(template.loops.fix_cycle, 'Should have fix_cycle loop');
		assert.strictEqual(template.loops.fix_cycle.length, 3, 'Should have 3 sub-steps in loop');

		// Verify steps
		assert.strictEqual(template.steps.length, 5, 'Should have 5 main steps');
		assert.strictEqual(template.steps[0].id, 'investigate');
		assert.strictEqual(template.steps[1].id, 'define_fixes');
		assert.strictEqual(template.steps[2].id, 'fix_cycle');
		assert.strictEqual(template.steps[2].type, 'loop');
		assert.strictEqual(template.steps[3].id, 'final_verify');
		assert.strictEqual(template.steps[4].id, 'cleanup');
	});

	test('Refactor workflow template loads and validates', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'refactor.yaml');

		// Act
		const template = await loadWorkflowTemplate(templatePath);

		// Assert
		assert.strictEqual(template.name, 'refactor');
		assert.strictEqual(template.description, 'Refactor code for improved quality');

		// Verify agents
		assert.ok(template.agents.orchestrator, 'Should have orchestrator agent');
		assert.ok(template.agents.analyzer, 'Should have analyzer agent');
		assert.ok(template.agents.refactorer, 'Should have refactorer agent');
		assert.ok(template.agents.tester, 'Should have tester agent');

		// Verify loops
		assert.ok(template.loops.refactor_cycle, 'Should have refactor_cycle loop');
		assert.strictEqual(template.loops.refactor_cycle.length, 3, 'Should have 3 sub-steps in loop');

		// Verify steps
		assert.strictEqual(template.steps.length, 5, 'Should have 5 main steps');
		assert.strictEqual(template.steps[0].id, 'analyze');
		assert.strictEqual(template.steps[1].id, 'define_tasks');
		assert.strictEqual(template.steps[2].id, 'refactor_cycle');
		assert.strictEqual(template.steps[2].type, 'loop');
		assert.strictEqual(template.steps[3].id, 'final_test');
		assert.strictEqual(template.steps[4].id, 'cleanup');
	});

	test('Feature template can be used with state machine', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'feature.yaml');
		const template = await loadWorkflowTemplate(templatePath);
		const machine = new WorkflowStateMachine(template);

		// Act
		const status = machine.start();

		// Assert
		assert.strictEqual(status.status, 'running');
		assert.strictEqual(status.step, 'plan');
		assert.strictEqual(status.agent, 'orchestrator');
		assert.ok(status.agentConfig);
		assert.ok(status.instructions.includes('Analyze the goal'));
	});

	test('Bugfix template can be used with state machine', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'bugfix.yaml');
		const template = await loadWorkflowTemplate(templatePath);
		const machine = new WorkflowStateMachine(template);

		// Act
		const status = machine.start();

		// Assert
		assert.strictEqual(status.status, 'running');
		assert.strictEqual(status.step, 'investigate');
		assert.strictEqual(status.agent, 'investigator');
		assert.ok(status.agentConfig);
		assert.ok(status.instructions.includes('Investigate the bug'));
	});

	test('Refactor template can be used with state machine', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'refactor.yaml');
		const template = await loadWorkflowTemplate(templatePath);
		const machine = new WorkflowStateMachine(template);

		// Act
		const status = machine.start();

		// Assert
		assert.strictEqual(status.status, 'running');
		assert.strictEqual(status.step, 'analyze');
		assert.strictEqual(status.agent, 'analyzer');
		assert.ok(status.agentConfig);
		assert.ok(status.instructions.includes('Analyze the code'));
	});

	test('Default workflow template loads and validates', async () => {
		// Arrange
		const templatePath = path.join(getWorkflowsDir(), 'default.yaml');

		// Act
		const template = await loadWorkflowTemplate(templatePath);

		// Assert
		assert.strictEqual(template.name, 'default');
		assert.ok(template.description.includes('Standard development workflow'));

		// Verify agents
		assert.ok(template.agents.coder, 'Should have coder agent');
		assert.ok(template.agents['test-engineer'], 'Should have test-engineer agent');
		assert.ok(template.agents['code-reviewer'], 'Should have code-reviewer agent');

		// Verify loops
		assert.ok(template.loops.implement, 'Should have implement loop');

		// Verify steps
		assert.strictEqual(template.steps.length, 3, 'Should have 3 main steps');
		assert.strictEqual(template.steps[0].id, 'plan');
		assert.strictEqual(template.steps[1].id, 'implement');
		assert.strictEqual(template.steps[1].type, 'loop');
		assert.strictEqual(template.steps[2].id, 'cleanup');
	});
});
