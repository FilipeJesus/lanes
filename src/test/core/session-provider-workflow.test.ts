import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	SessionItem,
	getWorkflowStatus,
	WorkflowStatus
} from '../../ClaudeSessionProvider';

suite('Session Provider', () => {

	let tempDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-provider-test-'));
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('Workflow Status Display', () => {

		test('getWorkflowStatus returns null when no workflow-state.json exists', () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'no-workflow');
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.strictEqual(status, null, 'Should return null when workflow-state.json does not exist');
		});

		test('getWorkflowStatus returns workflow status from valid state file', () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'with-workflow');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				status: 'running',
				workflow: 'feature',
				step: 'implement',
				task: { index: 1 }
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.active, true, 'Should be active when status is running');
			assert.strictEqual(status.workflow, 'feature', 'Should include workflow name');
			assert.strictEqual(status.step, 'implement', 'Should include current step');
			assert.strictEqual(status.progress, 'Task 2', 'Should include task progress (1-indexed)');
		});

		test('getWorkflowStatus returns inactive for completed workflow', () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'completed-workflow');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				status: 'complete',
				workflow: 'feature',
				step: 'review'
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.active, false, 'Should be inactive when status is complete');
		});

		test('getWorkflowStatus returns null for invalid JSON', () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'invalid-json');
			fs.mkdirSync(worktreePath, { recursive: true });

			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				'not valid json',
				'utf-8'
			);

			// Act
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.strictEqual(status, null, 'Should return null for invalid JSON');
		});

		test('getWorkflowStatus returns null for missing status field', () => {
			// Arrange
			const worktreePath = path.join(tempDir, 'missing-status');
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowState = {
				workflow: 'feature',
				step: 'implement'
			};
			fs.writeFileSync(
				path.join(worktreePath, 'workflow-state.json'),
				JSON.stringify(workflowState),
				'utf-8'
			);

			// Act
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.strictEqual(status, null, 'Should return null when status field is missing');
		});

		test('SessionItem shows Working status in description (step/task info moved to child items)', () => {
			// Arrange
			const workflowStatus: WorkflowStatus = {
				active: true,
				workflow: 'feature',
				step: 'implement',
				progress: 'Task 1'
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

			// Assert - step/task info is now shown in child SessionDetailItem, main line shows only status
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Working'),
				`Description should include Working status. Got: ${description}`
			);
			// Step and progress info moved to child items - verify workflowStatus is stored for child creation
			assert.ok(
				sessionItem.workflowStatus?.step === 'implement',
				'workflowStatus should be stored for child items'
			);
			assert.ok(
				sessionItem.workflowStatus?.progress === 'Task 1',
				'workflowStatus progress should be stored for child items'
			);
		});

		test('SessionItem shows Waiting status in description (step info moved to child items)', () => {
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

			// Assert - step info is now shown in child SessionDetailItem, main line shows only status
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Waiting'),
				`Description should include Waiting. Got: ${description}`
			);
			// Step info moved to child items - verify workflowStatus is stored for child creation
			assert.ok(
				sessionItem.workflowStatus?.step === 'review',
				'workflowStatus should be stored for child items'
			);
		});

		test('SessionItem shows Working status when no workflow', () => {
			// Arrange
			const claudeStatus = { status: 'working' as const };

			// Act
			const sessionItem = new SessionItem(
				'test-session',
				'/path/to/worktree',
				vscode.TreeItemCollapsibleState.None,
				claudeStatus,
				null
			);

			// Assert - when working, shows "Working"
			const description = String(sessionItem.description || '');
			assert.ok(
				description.includes('Working'),
				`Description should include Working when status is working. Got: ${description}`
			);
		});
	});
});
