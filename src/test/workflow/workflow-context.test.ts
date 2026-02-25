import * as assert from 'assert';
import {
	WorkflowTemplate,
	WorkflowStateMachine,
	loadWorkflowTemplateFromString,
} from '../../core/workflow';

suite('Context Management', () => {
	let templateWithContext: WorkflowTemplate;

	setup(() => {
		templateWithContext = loadWorkflowTemplateFromString(`
name: context-test
description: Test context management

steps:
  - id: step_with_clear
    type: action
    context: clear
    instructions: Clear context first
  - id: step_with_compact
    type: action
    context: compact
    instructions: Compact context first
  - id: step_no_context
    type: action
    instructions: Normal step
`);
	});

	suite('getContextActionIfNeeded', () => {
		test('Returns null when step has no context action', () => {
			const template = loadWorkflowTemplateFromString(`
name: test
description: Test
steps:
  - id: step1
    type: action
    instructions: Do something
`);
			const machine = new WorkflowStateMachine(template);
			machine.start();

			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, null);
		});

		test('Returns clear action when step has context: clear', () => {
			const machine = new WorkflowStateMachine(templateWithContext);
			machine.start();

			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, 'clear');
		});

		test('Returns compact action when step has context: compact', () => {
			const machine = new WorkflowStateMachine(templateWithContext);
			machine.start();
			machine.advance('First step done');

			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, 'compact');
		});

		test('Returns clear action when step has context: clear', () => {
			const template = loadWorkflowTemplateFromString(`
name: test
description: Test
steps:
  - id: step1
    type: action
    context: clear
    instructions: Clear context first
`);
			const machine = new WorkflowStateMachine(template);
			machine.start();

			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, 'clear');
		});

		test('Returns null after action is marked executed', () => {
			const machine = new WorkflowStateMachine(templateWithContext);
			machine.start();

			machine.markContextActionExecuted();
			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, null);
		});

		test('Sub-step context action takes precedence over main step', () => {
			const template = loadWorkflowTemplateFromString(`
name: test
description: Test
loops:
  step1:
    - id: sub1
      context: clear
      instructions: Sub step with clear
    - id: sub2
      instructions: Sub step without
steps:
  - id: step1
    type: loop
    context: compact
`);
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.setTasks('step1', [{ id: 't1', title: 'Task 1', status: 'pending' }]);

			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, 'clear');
		});

		test('Returns null when sub-step has no context and main step has none', () => {
			const template = loadWorkflowTemplateFromString(`
name: test
description: Test
loops:
  step1:
    - id: sub1
      instructions: Sub step
steps:
  - id: step1
    type: loop
`);
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.setTasks('step1', [{ id: 't1', title: 'Task 1', status: 'pending' }]);

			const action = machine.getContextActionIfNeeded();

			assert.strictEqual(action, null);
		});
	});

	suite('markContextActionExecuted', () => {
		test('Updates state flag to true', () => {
			const machine = new WorkflowStateMachine(templateWithContext);
			machine.start();

			machine.markContextActionExecuted();

			assert.strictEqual(machine.getState().contextActionExecuted, true);
		});
	});

	suite('State Initialization and Reset', () => {
		test('contextActionExecuted initializes to false', () => {
			const machine = new WorkflowStateMachine(templateWithContext);
			machine.start();

			assert.strictEqual(machine.getState().contextActionExecuted, false);
		});

		test('contextActionExecuted resets to false on advance', () => {
			const machine = new WorkflowStateMachine(templateWithContext);
			machine.start();
			machine.markContextActionExecuted();

			machine.advance('Step done');

			assert.strictEqual(machine.getState().contextActionExecuted, false);
		});

		test('contextActionExecuted resets when tasks are set', () => {
			const template = loadWorkflowTemplateFromString(`
name: test
description: Test
loops:
  step1:
    - id: sub1
      instructions: Sub step
steps:
  - id: step1
    type: loop
`);
			const machine = new WorkflowStateMachine(template);
			machine.start();
			machine.markContextActionExecuted();

			machine.setTasks('step1', [{ id: 't1', title: 'Task 1', status: 'pending' }]);

			assert.strictEqual(machine.getState().contextActionExecuted, false);
		});
	});
});
