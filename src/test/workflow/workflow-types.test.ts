import * as assert from 'assert';
import {
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
} from '../../workflow';

suite('Workflow Types', () => {
	test('All workflow types are properly exported', () => {
		// Test that type imports work by using them
		// These are compile-time checks - if types are not exported, this file won't compile

		// AgentConfig
		const agentConfig: AgentConfig = {
			description: 'Test agent'
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
			outputs: {},
			artefacts: [],
			contextActionExecuted: false
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
