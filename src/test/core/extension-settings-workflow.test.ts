import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	initializeGlobalStorageContext,
} from '../../ClaudeSessionProvider';
import { getOrCreateExtensionSettingsFile } from '../../services/SettingsService';

suite('Extension Settings Workflow Configuration', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	// Create a temp directory structure before tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-ext-settings-workflow-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		fs.mkdirSync(worktreesDir, { recursive: true });
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

		// Initialize global storage context for tests
		const mockUri = vscode.Uri.file(globalStorageDir);
		initializeGlobalStorageContext(mockUri, tempDir);

		// Enable global storage for these tests
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);
	});

	// Clean up after each test
	teardown(async () => {
		// Reset configuration
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	suite('Extension Settings MCP Configuration', () => {

		test('should include workflow status hook when workflow is specified', async () => {
			// Arrange
			const { ClaudeCodeAgent } = await import('../../codeAgents/ClaudeCodeAgent.js');
			const codeAgent = new ClaudeCodeAgent();

			const sessionName = 'workflow-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			const workflowPath = path.join(tempDir, 'workflows', 'test-workflow.yaml');
			fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
			fs.writeFileSync(workflowPath, 'name: test\nsteps: []');

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, workflowPath, codeAgent);

			// Assert
			const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
			const settings = JSON.parse(settingsContent);

			// Should have SessionStart hook with multiple commands
			assert.ok(settings.hooks.SessionStart, 'Should have SessionStart hook');
			assert.ok(settings.hooks.SessionStart[0].hooks.length >= 2, 'SessionStart should have at least 2 commands when workflow is active');

			// Second command should be the workflow status check
			const workflowHookCmd = settings.hooks.SessionStart[0].hooks[1];
			assert.ok(workflowHookCmd.command.includes('workflow_status'), 'Second command should check workflow status');
		});

		test('should NOT include workflow status hook when workflow is not specified', async () => {
			// Arrange
			const { ClaudeCodeAgent } = await import('../../codeAgents/ClaudeCodeAgent.js');
			const codeAgent = new ClaudeCodeAgent();

			const sessionName = 'no-workflow-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act - no workflow parameter
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, undefined, codeAgent);

			// Assert
			const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
			const settings = JSON.parse(settingsContent);

			// SessionStart should only have session ID capture
			assert.ok(settings.hooks.SessionStart, 'Should have SessionStart hook');
			assert.strictEqual(settings.hooks.SessionStart[0].hooks.length, 1, 'SessionStart should only have 1 command when no workflow');
		});

		test('should save workflow to session data when workflow is provided', async () => {
			// Arrange
			const sessionName = 'mcp-workflow-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });
			// Workflow is now a full path to the YAML file
			const workflowPath = '/path/to/workflows/feature.yaml';

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, workflowPath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Settings file should NOT have mcpServers (now passed via --mcp-config flag)
			assert.ok(!settings.mcpServers, 'Settings should NOT have mcpServers (now passed via --mcp-config)');

			// Assert: Workflow path should be saved to session data for restoration
			const { getSessionWorkflow } = await import('../../ClaudeSessionProvider.js');
			const savedWorkflow = await getSessionWorkflow(worktreePath);
			assert.strictEqual(savedWorkflow, workflowPath, 'Workflow path should be saved to session data');
		});

		test('should NOT include MCP config when workflow is null', async () => {
			// Arrange
			const sessionName = 'no-workflow-null-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, null);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(!settings.mcpServers, 'Settings should NOT have mcpServers when workflow is null');
		});

		test('should NOT include MCP config when workflow is undefined', async () => {
			// Arrange
			const sessionName = 'no-workflow-undefined-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, undefined);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(!settings.mcpServers, 'Settings should NOT have mcpServers when workflow is undefined');
		});

		test('should NOT include MCP config when workflow parameter is omitted', async () => {
			// Arrange
			const sessionName = 'no-workflow-omitted-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(!settings.mcpServers, 'Settings should NOT have mcpServers when workflow is omitted');
		});

		test('should still include hooks when workflow is provided', async () => {
			// Arrange
			const sessionName = 'workflow-with-hooks-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });
			// Workflow is now a full path to the YAML file
			const workflowPath = '/path/to/workflows/feature.yaml';

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, workflowPath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Hooks should be present (mcpServers is now passed via --mcp-config flag)
			assert.ok(settings.hooks, 'Settings should still have hooks');
			assert.ok(!settings.mcpServers, 'Settings should NOT have mcpServers (now passed via --mcp-config)');
			assert.ok(settings.hooks.SessionStart, 'Hooks should have SessionStart');
			assert.ok(settings.hooks.Stop, 'Hooks should have Stop');
		});

		test('should reject relative workflow paths', async () => {
			// Arrange
			const sessionName = 'invalid-workflow-path-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act & Assert: Workflow path must be absolute
			await assert.rejects(
				async () => await getOrCreateExtensionSettingsFile(worktreePath, 'relative/workflow.yaml'),
				/Invalid workflow path.*Must be an absolute path/,
				'Should reject relative workflow path'
			);
		});

		test('should reject workflow paths without .yaml extension', async () => {
			// Arrange
			const sessionName = 'invalid-workflow-ext-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act & Assert: Workflow path must end with .yaml
			await assert.rejects(
				async () => await getOrCreateExtensionSettingsFile(worktreePath, '/path/to/workflow'),
				/Invalid workflow path.*Must end with .yaml/,
				'Should reject workflow path without .yaml extension'
			);
		});
	});
});
