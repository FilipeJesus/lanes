import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getAgentStatus, initializeGlobalStorageContext } from '../../vscode/providers/AgentSessionProvider';

suite('Session Status', () => {

	let tempDir: string;
	let globalStorageDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-status-test-'));
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-session-status-global-storage-'));
		initializeGlobalStorageContext(vscode.Uri.file(globalStorageDir), tempDir);
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	// Helper function to create status file in the correct location (.lanes/current-sessions/)
	function createStatusFile(worktreePath: string, statusData: { status: string; timestamp?: string; message?: string }): void {
		const sessionName = path.basename(worktreePath);
		const statusDir = path.join(tempDir, '.lanes', 'current-sessions', sessionName);
		fs.mkdirSync(statusDir, { recursive: true });
		fs.writeFileSync(path.join(statusDir, '.claude-status'), JSON.stringify(statusData));
	}

	suite('getAgentStatus', () => {

		test('should return correct status for valid waiting_for_user .claude-status file', async () => {
			// Arrange: Create a .claude-status file with waiting_for_user status
			const statusData = { status: 'waiting_for_user' };
			createStatusFile(tempDir, statusData);

			// Act
			const result = await getAgentStatus(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.status, 'waiting_for_user');
		});

		test('should return correct status for valid working .claude-status file', async () => {
			// Arrange: Create a .claude-status file with working status
			const statusData = { status: 'working' };
			createStatusFile(tempDir, statusData);

			// Act
			const result = await getAgentStatus(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.status, 'working');
		});

		test('should return null when .claude-status file does not exist', async () => {
			// Arrange: tempDir exists but has no .claude-status file

			// Act
			const result = await getAgentStatus(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null for invalid JSON in .claude-status', async () => {
			// Arrange: Create a .claude-status file with invalid JSON
			const sessionName = path.basename(tempDir);
			const statusDir = path.join(tempDir, '.lanes', 'current-sessions', sessionName);
			fs.mkdirSync(statusDir, { recursive: true });
			fs.writeFileSync(path.join(statusDir, '.claude-status'), 'not valid json {{{');

			// Act
			const result = await getAgentStatus(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null when status field is not a valid value', async () => {
			// Arrange: Create a .claude-status file with invalid status value
			const statusData = { status: 'invalid' };
			const sessionName = path.basename(tempDir);
			const statusDir = path.join(tempDir, '.lanes', 'current-sessions', sessionName);
			fs.mkdirSync(statusDir, { recursive: true });
			fs.writeFileSync(path.join(statusDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = await getAgentStatus(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should correctly parse optional timestamp and message fields', async () => {
			// Arrange: Create a .claude-status file with all fields
			const statusData = {
				status: 'waiting_for_user',
				timestamp: '2025-12-21T10:30:00Z',
				message: 'Waiting for user confirmation'
			};
			createStatusFile(tempDir, statusData);

			// Act
			const result = await getAgentStatus(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.status, 'waiting_for_user');
			assert.strictEqual(result.timestamp, '2025-12-21T10:30:00Z');
			assert.strictEqual(result.message, 'Waiting for user confirmation');
		});
	});
});
