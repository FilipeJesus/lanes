import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	SessionItem,
	getWorkflowStatus,
	WorkflowStatus
} from '../../vscode/providers/AgentSessionProvider';
import { WorkflowState, WorkflowTemplate } from '../../core/workflow/types';
import { WorkflowStateMachine } from '../../core/workflow/state';
import { workflowStart } from '../../mcp/tools';

suite('Workflow Summary Feature', () => {

	let tempDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-summary-test-'));
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// Minimal workflow template for testing
	const minimalTemplate: WorkflowTemplate = {
		name: 'test-workflow',
		description: 'Test workflow for summary feature',
		agents: {
			'test-agent': {
				description: 'Test agent'
			}
		},
		loops: {
			'tasks': [
				{ id: 'step1', instructions: 'Do step 1' },
				{ id: 'step2', instructions: 'Do step 2' }
			]
		},
		steps: [
			{ id: 'plan', type: 'action', instructions: 'Plan the work' },
			{ id: 'tasks', type: 'loop' }
		]
	};

	suite('WorkflowState Interface', () => {

		test('WorkflowState interface includes optional summary field - string value', () => {
			// Arrange
			const state: WorkflowState = {
				status: 'running',
				step: 'plan',
				stepType: 'action',
				tasks: {},
				outputs: {},
				summary: 'Add dark mode toggle',
				artefacts: [],
				contextActionExecuted: false
			};

			// Assert
			assert.strictEqual(typeof state.summary, 'string', 'Summary should be a string when set');
			assert.strictEqual(state.summary, 'Add dark mode toggle', 'Summary should match the set value');
		});

		test('WorkflowState interface includes optional summary field - undefined', () => {
			// Arrange
			const state: WorkflowState = {
				status: 'running',
				step: 'plan',
				stepType: 'action',
				tasks: {},
				outputs: {},
				artefacts: [],
				contextActionExecuted: false
			};

			// Assert
			assert.strictEqual(state.summary, undefined, 'Summary should be undefined when not set');
		});
	});

	suite('workflowStart Function', () => {

		test('workflowStart stores summary in machine state when provided', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'workflow-with-summary');
			fs.mkdirSync(worktreePath, { recursive: true });

			// Create test template file
			const templatesDir = path.join(tempDir, 'templates');
			fs.mkdirSync(templatesDir, { recursive: true });
			const templateContent = `
name: test-workflow
description: Test workflow
agents: {}
loops: {}
steps:
  - id: plan
    type: action
    instructions: Plan the work
`;
			fs.writeFileSync(path.join(templatesDir, 'test-workflow.yaml'), templateContent, 'utf-8');

			// Act
			const result = await workflowStart(worktreePath, 'test-workflow', templatesDir, 'Add dark mode toggle');

			// Assert
			const state = result.machine.getState();
			assert.strictEqual(state.summary, 'Add dark mode toggle', 'Machine state should contain the summary');

			// Verify it was also persisted to file
			const statePath = path.join(worktreePath, 'workflow-state.json');
			const persistedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.strictEqual(persistedState.summary, 'Add dark mode toggle', 'Persisted state should contain the summary');
		});

		test('workflowStart does not include summary when not provided', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'workflow-without-summary');
			fs.mkdirSync(worktreePath, { recursive: true });

			// Create test template file
			const templatesDir = path.join(tempDir, 'templates-no-summary');
			fs.mkdirSync(templatesDir, { recursive: true });
			const templateContent = `
name: test-workflow
description: Test workflow
agents: {}
loops: {}
steps:
  - id: plan
    type: action
    instructions: Plan the work
`;
			fs.writeFileSync(path.join(templatesDir, 'test-workflow.yaml'), templateContent, 'utf-8');

			// Act
			const result = await workflowStart(worktreePath, 'test-workflow', templatesDir);

			// Assert
			const state = result.machine.getState();
			assert.strictEqual(state.summary, undefined, 'Machine state should not have a summary field when not provided');
		});
	});

	suite('WorkflowStateMachine.setSummary', () => {

		test('setSummary sets the summary correctly', () => {
			// Arrange
			const machine = new WorkflowStateMachine(minimalTemplate);
			machine.start();

			// Act
			machine.setSummary('Implement user authentication');

			// Assert
			const state = machine.getState();
			assert.strictEqual(state.summary, 'Implement user authentication', 'getState().summary should equal the set string');
		});

		test('setSummary can update an existing summary', () => {
			// Arrange
			const machine = new WorkflowStateMachine(minimalTemplate);
			machine.start();
			machine.setSummary('Initial summary');

			// Act
			machine.setSummary('Updated summary');

			// Assert
			const state = machine.getState();
			assert.strictEqual(state.summary, 'Updated summary', 'Summary should be updated to new value');
		});
	});

	suite('getWorkflowStatus Summary Extraction', () => {

		test('getWorkflowStatus extracts summary from workflow-state.json when present', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'with-summary');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				status: 'running',
				step: 'implement',
				stepType: 'action',
				task: { index: 0 },
				summary: 'Add dark mode toggle'
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = await getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, 'Add dark mode toggle', 'Summary should be extracted from state');
		});

		test('getWorkflowStatus returns undefined summary when not present in workflow-state.json', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'without-summary');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				status: 'running',
				step: 'implement',
				stepType: 'action'
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = await getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, undefined, 'Summary should be undefined when not in state');
		});

		test('getWorkflowStatus returns undefined summary for empty string', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'empty-summary');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				status: 'running',
				step: 'implement',
				stepType: 'action',
				summary: ''
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = await getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, undefined, 'Summary should be undefined for empty string');
		});

		test('getWorkflowStatus returns undefined summary for whitespace-only string', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'whitespace-summary');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				status: 'running',
				step: 'implement',
				stepType: 'action',
				summary: '   '
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = await getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, undefined, 'Summary should be undefined for whitespace-only string');
		});
	});

	suite('SessionItem Summary Display', () => {

		test('SessionItem description includes status and summary (step/task info moved to child items)', () => {
			// Arrange
			const workflowStatus: WorkflowStatus = {
				active: true,
				workflow: 'feature',
				step: 'implement',
				progress: 'Task 1',
				summary: 'Add dark mode toggle'
			};

			const claudeStatus = { status: 'working' as const };

			// Act
			const sessionItem = new SessionItem(
				'test-session',
				'/path/to/worktree',
				vscode.TreeItemCollapsibleState.None,
				claudeStatus,
				workflowStatus
			);

			// Assert - step/task info is now shown in child SessionDetailItem, main line shows status + summary
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Working'),
				`Description should include Working. Got: ${description}`
			);
			assert.ok(
				description.includes('Add dark mode toggle'),
				`Description should include summary. Got: ${description}`
			);
			// Step and progress info moved to child items - verify workflowStatus is stored
			assert.ok(
				sessionItem.workflowStatus?.step === 'implement',
				'workflowStatus step should be stored for child items'
			);
			assert.ok(
				sessionItem.workflowStatus?.progress === 'Task 1',
				'workflowStatus progress should be stored for child items'
			);
		});

		test('SessionItem description shows summary without step info when only summary available', () => {
			// Arrange - workflow active but no step info, only summary
			const workflowStatus: WorkflowStatus = {
				active: false,
				summary: 'Fix login bug'
			};

			const claudeStatus = { status: 'idle' as const };

			// Act
			const sessionItem = new SessionItem(
				'test-session',
				'/path/to/worktree',
				vscode.TreeItemCollapsibleState.None,
				claudeStatus,
				workflowStatus
			);

			// Assert
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Fix login bug'),
				`Description should include summary when no other info. Got: ${description}`
			);
		});

		test('SessionItem description shows only status when no summary (step info moved to child items)', () => {
			// Arrange
			const workflowStatus: WorkflowStatus = {
				active: true,
				workflow: 'feature',
				step: 'review'
			};

			const claudeStatus = { status: 'waiting_for_user' as const };

			// Act
			const sessionItem = new SessionItem(
				'test-session',
				'/path/to/worktree',
				vscode.TreeItemCollapsibleState.None,
				claudeStatus,
				workflowStatus
			);

			// Assert - step info is now in child items, main line shows only status
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Waiting'),
				`Description should include Waiting. Got: ${description}`
			);
			// Step info moved to child items - verify workflowStatus is stored
			assert.ok(
				sessionItem.workflowStatus?.step === 'review',
				'workflowStatus step should be stored for child items'
			);
			// The description should not end with " - " or have trailing separator patterns
			assert.ok(
				!description.endsWith(' - '),
				`Description should not end with separator when no summary. Got: ${description}`
			);
		});

		test('SessionItem with waiting status shows summary', () => {
			// Arrange
			const workflowStatus: WorkflowStatus = {
				active: true,
				workflow: 'feature',
				step: 'review',
				summary: 'Refactor database layer'
			};

			const claudeStatus = { status: 'waiting_for_user' as const };

			// Act
			const sessionItem = new SessionItem(
				'test-session',
				'/path/to/worktree',
				vscode.TreeItemCollapsibleState.None,
				claudeStatus,
				workflowStatus
			);

			// Assert
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Waiting'),
				`Description should include Waiting. Got: ${description}`
			);
			assert.ok(
				description.includes('Refactor database layer'),
				`Description should include summary. Got: ${description}`
			);
		});
	});
});
