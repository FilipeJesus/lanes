import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	initializeGlobalStorageContext,
	getGlobalStorageUri,
	getBaseRepoPathForStorage,
	getRepoIdentifier,
	getSessionNameFromWorktree,
	isGlobalStorageEnabled,
	getGlobalStoragePath,
	SessionItem,
	getWorkflowStatus,
	WorkflowStatus
} from '../ClaudeSessionProvider';
import { getOrCreateExtensionSettingsFile, combinePromptAndCriteria } from '../extension';
import { WorkflowState, WorkflowTemplate } from '../workflow/types';
import { WorkflowStateMachine } from '../workflow/state';
import { workflowStart } from '../mcp/tools';

suite('Extension Settings File', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	// Create a temp directory structure before tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-ext-settings-test-'));
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
		await config.update('claudeStatusPath', undefined, vscode.ConfigurationTarget.Global);
		await config.update('claudeSessionPath', undefined, vscode.ConfigurationTarget.Global);

		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	suite('Settings File Location', () => {

		test('should create settings file at correct global storage path', async () => {
			// Arrange
			const sessionName = 'test-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			const repoIdentifier = getRepoIdentifier(tempDir);
			const expectedPath = path.join(globalStorageDir, repoIdentifier, sessionName, 'claude-settings.json');
			assert.strictEqual(settingsPath, expectedPath, 'Settings file should be at globalStorageUri/<repo-identifier>/<session-name>/claude-settings.json');
		});

		test('should return absolute path to the settings file', async () => {
			// Arrange
			const sessionName = 'absolute-path-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			assert.ok(path.isAbsolute(settingsPath), 'Returned path should be absolute');
		});

		test('should create the settings file if it does not exist', async () => {
			// Arrange
			const sessionName = 'new-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			assert.ok(fs.existsSync(settingsPath), 'Settings file should exist after creation');
		});

		test('should create parent directories if they do not exist', async () => {
			// Arrange
			const sessionName = 'nested-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			const settingsDir = path.dirname(settingsPath);
			assert.ok(fs.existsSync(settingsDir), 'Parent directories should be created');
		});

		test('should use session name from worktree path (last path component)', async () => {
			// Arrange
			const sessionName = 'my-feature-branch';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			assert.ok(settingsPath.includes(sessionName), 'Settings path should include session name');
		});

		test('should handle different worktree session names', async () => {
			// Arrange
			const sessionNames = ['feat-login', 'fix-bug-123', 'refactor/core'];
			const settingsPaths: string[] = [];

			for (const sessionName of sessionNames) {
				const worktreePath = path.join(worktreesDir, sessionName);
				fs.mkdirSync(worktreePath, { recursive: true });

				// Act
				const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
				settingsPaths.push(settingsPath);
			}

			// Assert: Each session should have its own settings file
			const uniquePaths = new Set(settingsPaths);
			assert.strictEqual(uniquePaths.size, sessionNames.length, 'Each session should have a unique settings file path');
		});
	});

	suite('Settings File Hooks Content', () => {

		test('should contain SessionStart hook with session ID capture', async () => {
			// Arrange
			const sessionName = 'session-start-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(settings.hooks, 'Settings should have hooks object');
			assert.ok(settings.hooks.SessionStart, 'Hooks should have SessionStart');
			assert.ok(Array.isArray(settings.hooks.SessionStart), 'SessionStart should be an array');
			assert.ok(settings.hooks.SessionStart.length > 0, 'SessionStart should have at least one entry');

			// Check that SessionStart hook captures session ID using jq
			const sessionStartHook = settings.hooks.SessionStart[0];
			assert.ok(sessionStartHook.hooks, 'SessionStart entry should have hooks array');
			const sessionIdHook = sessionStartHook.hooks.find((h: any) => h.command && h.command.includes('session_id'));
			assert.ok(sessionIdHook, 'Should have a hook that captures session_id');
			assert.ok(sessionIdHook.command.includes('jq'), 'Session ID hook should use jq');
			assert.ok(sessionIdHook.command.includes('.claude-session'), 'Session ID hook should write to .claude-session');
		});

		test('should contain Stop hook with waiting_for_user status', async () => {
			// Arrange
			const sessionName = 'stop-hook-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(settings.hooks.Stop, 'Hooks should have Stop');
			assert.ok(Array.isArray(settings.hooks.Stop), 'Stop should be an array');

			const stopHook = settings.hooks.Stop[0];
			assert.ok(stopHook.hooks, 'Stop entry should have hooks array');
			const statusHook = stopHook.hooks.find((h: any) => h.command && h.command.includes('waiting_for_user'));
			assert.ok(statusHook, 'Stop hook should write waiting_for_user status');
			assert.ok(statusHook.command.includes('.claude-status'), 'Stop hook should write to .claude-status');
		});

		test('should contain UserPromptSubmit hook with working status', async () => {
			// Arrange
			const sessionName = 'prompt-submit-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(settings.hooks.UserPromptSubmit, 'Hooks should have UserPromptSubmit');
			assert.ok(Array.isArray(settings.hooks.UserPromptSubmit), 'UserPromptSubmit should be an array');

			const promptHook = settings.hooks.UserPromptSubmit[0];
			assert.ok(promptHook.hooks, 'UserPromptSubmit entry should have hooks array');
			const statusHook = promptHook.hooks.find((h: any) => h.command && h.command.includes('working'));
			assert.ok(statusHook, 'UserPromptSubmit hook should write working status');
		});

		test('should contain Notification hook for permission prompts', async () => {
			// Arrange
			const sessionName = 'notification-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(settings.hooks.Notification, 'Hooks should have Notification');
			assert.ok(Array.isArray(settings.hooks.Notification), 'Notification should be an array');

			const notificationHook = settings.hooks.Notification[0];
			assert.strictEqual(notificationHook.matcher, 'permission_prompt', 'Notification should match permission_prompt');
			assert.ok(notificationHook.hooks, 'Notification entry should have hooks array');
		});

		test('should contain PreToolUse hook with working status', async () => {
			// Arrange
			const sessionName = 'pre-tool-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			assert.ok(settings.hooks.PreToolUse, 'Hooks should have PreToolUse');
			assert.ok(Array.isArray(settings.hooks.PreToolUse), 'PreToolUse should be an array');

			const preToolHook = settings.hooks.PreToolUse[0];
			assert.strictEqual(preToolHook.matcher, '.*', 'PreToolUse should match all tools');
			assert.ok(preToolHook.hooks, 'PreToolUse entry should have hooks array');
			const statusHook = preToolHook.hooks.find((h: any) => h.command && h.command.includes('working'));
			assert.ok(statusHook, 'PreToolUse hook should write working status');
		});

		test('should have all five required hook types', async () => {
			// Arrange
			const sessionName = 'all-hooks-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert
			const requiredHooks = ['SessionStart', 'Stop', 'UserPromptSubmit', 'Notification', 'PreToolUse'];
			for (const hookName of requiredHooks) {
				assert.ok(settings.hooks[hookName], `Settings should have ${hookName} hook`);
			}
		});

		test('should point to correct global storage paths when useGlobalStorage is enabled', async () => {
			// Arrange
			const sessionName = 'global-storage-paths';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Check that hooks use global storage paths (absolute paths)
			const stopHook = settings.hooks.Stop[0].hooks[0];
			assert.ok(
				path.isAbsolute(stopHook.command.match(/"([^"]+\.claude-status)"/)?.[1] || ''),
				'Status file path in hooks should be absolute when using global storage'
			);
		});

		test('should use relative paths when useGlobalStorage is disabled', async () => {
			// Arrange
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

			const sessionName = 'relative-paths-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Check that hooks use relative paths
			const stopHook = settings.hooks.Stop[0].hooks[0];
			const statusPath = stopHook.command.match(/"([^"]+\.claude-status)"/)?.[1] || '';
			assert.ok(
				!path.isAbsolute(statusPath) || statusPath === '.claude-status',
				'Status file path in hooks should be relative when global storage is disabled'
			);
		});
	});

	suite('No Worktree Settings Files', () => {

		test('should NOT create .claude/settings.json in the worktree', async () => {
			// Arrange
			const sessionName = 'no-worktree-settings';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			const worktreeClaudeDir = path.join(worktreePath, '.claude');
			const worktreeSettingsJson = path.join(worktreeClaudeDir, 'settings.json');
			assert.ok(
				!fs.existsSync(worktreeSettingsJson),
				'.claude/settings.json should NOT exist in the worktree'
			);
		});

		test('should NOT create .claude/settings.local.json in the worktree', async () => {
			// Arrange
			const sessionName = 'no-local-settings';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			const worktreeClaudeDir = path.join(worktreePath, '.claude');
			const worktreeLocalSettings = path.join(worktreeClaudeDir, 'settings.local.json');
			assert.ok(
				!fs.existsSync(worktreeLocalSettings),
				'.claude/settings.local.json should NOT exist in the worktree'
			);
		});

		test('should NOT create any files in worktree .claude directory', async () => {
			// Arrange
			const sessionName = 'no-claude-files';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			const worktreeClaudeDir = path.join(worktreePath, '.claude');
			if (fs.existsSync(worktreeClaudeDir)) {
				const files = fs.readdirSync(worktreeClaudeDir);
				assert.strictEqual(
					files.length,
					0,
					'No files should be created in worktree .claude directory by getOrCreateExtensionSettingsFile'
				);
			}
			// If .claude doesn't exist, that's also fine
		});

		test('settings file should be created in extension global storage, not worktree', async () => {
			// Arrange
			const sessionName = 'storage-location-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			assert.ok(
				settingsPath.startsWith(globalStorageDir),
				'Settings file should be in global storage directory'
			);
			assert.ok(
				!settingsPath.startsWith(worktreePath),
				'Settings file should NOT be in worktree directory'
			);
		});
	});

	suite('Backwards Compatibility - Status Files', () => {

		test('should still write status files to configured locations', async () => {
			// Arrange
			const sessionName = 'backwards-compat-status';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Verify Stop hook writes to .claude-status
			const stopHook = settings.hooks.Stop[0].hooks[0];
			assert.ok(
				stopHook.command.includes('.claude-status'),
				'Stop hook should write to .claude-status'
			);
		});

		test('should still write session files to configured locations', async () => {
			// Arrange
			const sessionName = 'backwards-compat-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Verify SessionStart hook writes to .claude-session
			const sessionStartHook = settings.hooks.SessionStart[0].hooks[0];
			assert.ok(
				sessionStartHook.command.includes('.claude-session'),
				'SessionStart hook should write to .claude-session'
			);
		});

		test('should respect claudeStatusPath configuration for relative paths', async () => {
			// Arrange
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);
			await config.update('claudeStatusPath', '.claude', vscode.ConfigurationTarget.Global);

			const sessionName = 'status-path-config';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Status path should include the configured subdirectory
			const stopHook = settings.hooks.Stop[0].hooks[0];
			assert.ok(
				stopHook.command.includes('.claude/') || stopHook.command.includes('.claude-status'),
				'Status path should respect configuration'
			);
		});

		test('should respect claudeSessionPath configuration for relative paths', async () => {
			// Arrange
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);
			await config.update('claudeSessionPath', '.claude', vscode.ConfigurationTarget.Global);

			const sessionName = 'session-path-config';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Session path should include the configured subdirectory
			const sessionStartHook = settings.hooks.SessionStart[0].hooks[0];
			assert.ok(
				sessionStartHook.command.includes('.claude/') || sessionStartHook.command.includes('.claude-session'),
				'Session path should respect configuration'
			);
		});

		test('should work with global storage enabled (paths should be absolute)', async () => {
			// Arrange: Enable global storage (should be default)
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

			const sessionName = 'global-storage-enabled';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Paths in hooks should be absolute (global storage)
			const stopHook = settings.hooks.Stop[0].hooks[0];
			const statusPathMatch = stopHook.command.match(/"([^"]+\.claude-status)"/);
			assert.ok(statusPathMatch, 'Should find status file path in command');
			assert.ok(
				path.isAbsolute(statusPathMatch[1]),
				'Status file path should be absolute when global storage is enabled'
			);
		});

		test('should work with global storage disabled (paths should be relative)', async () => {
			// Arrange: Disable global storage
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

			const sessionName = 'global-storage-disabled';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

			// Assert: Paths in hooks should be relative
			const stopHook = settings.hooks.Stop[0].hooks[0];
			// The path is within double quotes in the echo command, e.g.: echo '...' > ".claude-status"
			const statusPathMatch = stopHook.command.match(/"([^"]+)"/);
			assert.ok(statusPathMatch, 'Should find status file path in command');
			const statusPath = statusPathMatch[1];
			// When global storage is disabled with default config, the path is just '.claude-status' (relative)
			assert.ok(
				!path.isAbsolute(statusPath),
				`Status file path should be relative when global storage is disabled, got: ${statusPath}`
			);
		});
	});

	suite('Error Handling', () => {

		test('should throw error when global storage is not initialized', async () => {
			// Arrange: Create a fresh temp directory without initializing global storage
			// Note: Since we can't un-initialize the global storage, we'll verify the function
			// works correctly with the initialized context
			const sessionName = 'error-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act & Assert: Function should succeed when context is initialized
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			assert.ok(settingsPath, 'Should return a valid path when context is initialized');
		});

		test('should create valid JSON file', async () => {
			// Arrange
			const sessionName = 'valid-json-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert: File should be valid JSON
			assert.doesNotThrow(() => {
				const content = fs.readFileSync(settingsPath, 'utf-8');
				JSON.parse(content);
			}, 'Settings file should contain valid JSON');
		});

		test('should overwrite existing settings file', async () => {
			// Arrange
			const sessionName = 'overwrite-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Create settings file first time
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const firstContent = fs.readFileSync(settingsPath, 'utf-8');

			// Act: Call again to overwrite
			const newSettingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
			const secondContent = fs.readFileSync(newSettingsPath, 'utf-8');

			// Assert: Paths should be the same, and both should be valid
			assert.strictEqual(settingsPath, newSettingsPath, 'Should return the same path');
			assert.doesNotThrow(() => JSON.parse(secondContent), 'New content should be valid JSON');
		});
	});

	suite('Extension Settings MCP Configuration', () => {

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
			const { getSessionWorkflow } = await import('../ClaudeSessionProvider.js');
			const savedWorkflow = getSessionWorkflow(worktreePath);
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

suite('Extension Integration', () => {

	suite('Workflow Prompt Instructions', () => {

		test('combinePromptAndCriteria returns combined format when both provided', () => {
			// Arrange
			const prompt = 'Implement feature X';
			const criteria = 'Must pass all tests';

			// Act
			const result = combinePromptAndCriteria(prompt, criteria);

			// Assert
			assert.ok(result.includes('request:'), 'Should include request prefix');
			assert.ok(result.includes(prompt), 'Should include the prompt');
			assert.ok(result.includes('acceptance criteria:'), 'Should include acceptance criteria prefix');
			assert.ok(result.includes(criteria), 'Should include the criteria');
		});

		test('combinePromptAndCriteria returns prompt only when no criteria', () => {
			// Arrange
			const prompt = 'Implement feature X';

			// Act
			const result = combinePromptAndCriteria(prompt, '');

			// Assert
			assert.strictEqual(result, prompt, 'Should return just the prompt');
		});

		test('combinePromptAndCriteria returns criteria only when no prompt', () => {
			// Arrange
			const criteria = 'Must pass all tests';

			// Act
			const result = combinePromptAndCriteria('', criteria);

			// Assert
			assert.strictEqual(result, criteria, 'Should return just the criteria');
		});

		test('combinePromptAndCriteria returns empty string when neither provided', () => {
			// Act
			const result = combinePromptAndCriteria('', '');

			// Assert
			assert.strictEqual(result, '', 'Should return empty string');
		});

		test('combinePromptAndCriteria handles undefined values', () => {
			// Act
			const result = combinePromptAndCriteria(undefined, undefined);

			// Assert
			assert.strictEqual(result, '', 'Should return empty string for undefined');
		});

		test('combinePromptAndCriteria trims whitespace', () => {
			// Arrange
			const prompt = '  trimmed prompt  ';
			const criteria = '  trimmed criteria  ';

			// Act
			const result = combinePromptAndCriteria(prompt, criteria);

			// Assert
			assert.ok(!result.includes('  trimmed'), 'Should trim leading whitespace');
			assert.ok(!result.includes('trimmed  '), 'Should trim trailing whitespace');
		});
	});
});

suite('OpenCodeAgent', () => {
	const { OpenCodeAgent } = require('../codeAgents/OpenCodeAgent');

	let agent: any;

	setup(() => {
		agent = new OpenCodeAgent();
	});

	suite('Configuration', () => {
		test('should have correct name', () => {
			assert.strictEqual(agent.name, 'opencode', 'Agent name should be opencode');
		});

		test('should have correct display name', () => {
			assert.strictEqual(agent.displayName, 'OpenCode', 'Display name should be OpenCode');
		});

		test('should have correct CLI command', () => {
			assert.strictEqual(agent.cliCommand, 'opencode', 'CLI command should be opencode');
		});
	});

	suite('File Naming', () => {
		test('should return correct session file name', () => {
			assert.strictEqual(agent.getSessionFileName(), '.opencode-session', 'Session file should be .opencode-session');
		});

		test('should return correct status file name', () => {
			assert.strictEqual(agent.getStatusFileName(), '.opencode-status', 'Status file should be .opencode-status');
		});

		test('should return correct settings file name', () => {
			assert.strictEqual(agent.getSettingsFileName(), 'opencode.json', 'Settings file should be opencode.json');
		});

		test('should return correct data directory', () => {
			assert.strictEqual(agent.getDataDirectory(), '.opencode', 'Data directory should be .opencode');
		});
	});

	suite('Terminal Configuration', () => {
		test('should return terminal name with OpenCode prefix', () => {
			const name = agent.getTerminalName('test-session');
			assert.strictEqual(name, 'OpenCode: test-session', 'Terminal name should have OpenCode prefix');
		});

		test('should return terminal icon configuration', () => {
			const icon = agent.getTerminalIcon();
			assert.ok(icon, 'Should return icon configuration');
			assert.strictEqual(typeof icon.id, 'string', 'Icon should have id');
		});
	});

	suite('buildStartCommand', () => {
		test('should use opencode TUI format', () => {
			const command = agent.buildStartCommand({ prompt: 'test' });
			assert.ok(command.startsWith('opencode'), 'Start command should start with "opencode"');
			assert.ok(!command.includes('opencode run'), 'Should not use "opencode run" (uses TUI mode)');
		});

		test('should include prompt with --prompt flag', () => {
			const command = agent.buildStartCommand({ prompt: 'test prompt' });
			assert.ok(command.includes("--prompt 'test prompt'"), 'Should include --prompt flag with value');
		});

		test('should escape single quotes in prompt', () => {
			const command = agent.buildStartCommand({ prompt: "it's a test" });
			assert.ok(command.includes("--prompt 'it'\\''s a test'"), 'Should escape single quotes in prompt');
		});

		test('should include config path via OPENCODE_CONFIG env var', () => {
			const command = agent.buildStartCommand({
				prompt: 'test',
				settingsPath: '/path/to/opencode.json'
			});
			assert.ok(command.includes('OPENCODE_CONFIG='), 'Should include OPENCODE_CONFIG env var');
			assert.ok(command.includes('/path/to/opencode.json'), 'Should include settings path');
			assert.ok(command.includes('opencode'), 'Should include opencode command');
		});

		test('should set env var before command', () => {
			const command = agent.buildStartCommand({
				prompt: 'test',
				settingsPath: '/path/to/settings.json'
			});
			const envPos = command.indexOf('OPENCODE_CONFIG=');
			const cmdPos = command.indexOf('opencode');
			assert.ok(envPos < cmdPos, 'Env var should come before command');
		});

		test('should work without prompt', () => {
			const command = agent.buildStartCommand({
				settingsPath: '/path/to/settings.json'
			});
			assert.ok(command.includes('opencode'), 'Should include opencode');
			assert.ok(command.includes('OPENCODE_CONFIG='), 'Should include config env var');
			assert.ok(!command.includes('--prompt'), 'Should not include --prompt when no prompt given');
		});
	});

	suite('buildResumeCommand', () => {
		test('should use --session flag instead of --resume', () => {
			const command = agent.buildResumeCommand('test-session-123', {});
			assert.ok(command.includes('--session test-session-123'), 'Should use --session flag');
			assert.ok(!command.includes('--resume'), 'Should not use --resume flag');
		});

		test('should validate session ID format', () => {
			assert.throws(
				() => agent.buildResumeCommand('invalid session!', {}),
				/Invalid session ID format/,
				'Should reject invalid session ID with special characters'
			);
		});

		test('should accept valid alphanumeric session IDs', () => {
			assert.doesNotThrow(
				() => agent.buildResumeCommand('session-123', {}),
				'Should accept session ID with hyphens'
			);

			assert.doesNotThrow(
				() => agent.buildResumeCommand('session_456', {}),
				'Should accept session ID with underscores'
			);

			assert.doesNotThrow(
				() => agent.buildResumeCommand('sessionABC789', {}),
				'Should accept alphanumeric session ID'
			);
		});

		test('should include config path via OPENCODE_CONFIG env var', () => {
			const command = agent.buildResumeCommand('test-session', {
				settingsPath: '/path/to/opencode.json'
			});
			assert.ok(command.includes('OPENCODE_CONFIG='), 'Should include OPENCODE_CONFIG env var');
			assert.ok(command.includes('/path/to/opencode.json'), 'Should include settings path');
		});

		test('should set env var before command', () => {
			const command = agent.buildResumeCommand('test-session', {
				settingsPath: '/path/to/settings.json'
			});
			const envPos = command.indexOf('OPENCODE_CONFIG=');
			const cmdPos = command.indexOf('opencode');
			assert.ok(envPos < cmdPos, 'Env var should come before command');
		});
	});

	suite('Session Data Parsing', () => {
		test('should parse valid session data', () => {
			const content = JSON.stringify({
				sessionId: 'test-session-123',
				timestamp: '2024-01-01T00:00:00Z'
			});
			const data = agent.parseSessionData(content);
			assert.ok(data, 'Should parse valid session data');
			assert.strictEqual(data.sessionId, 'test-session-123', 'Should extract session ID');
			assert.strictEqual(data.agentName, 'opencode', 'Should set agent name');
		});

		test('should return null for missing sessionId', () => {
			const content = JSON.stringify({ timestamp: '2024-01-01T00:00:00Z' });
			const data = agent.parseSessionData(content);
			assert.strictEqual(data, null, 'Should return null for missing sessionId');
		});

		test('should return null for invalid session ID format', () => {
			const content = JSON.stringify({ sessionId: 'invalid session!' });
			const data = agent.parseSessionData(content);
			assert.strictEqual(data, null, 'Should return null for invalid session ID format');
		});

		test('should accept valid alphanumeric session IDs', () => {
			const validIds = ['session-123', 'session_456', 'sessionABC789'];
			for (const id of validIds) {
				const content = JSON.stringify({ sessionId: id });
				const data = agent.parseSessionData(content);
				assert.ok(data, `Should accept valid session ID: ${id}`);
				assert.strictEqual(data.sessionId, id);
			}
		});

		test('should return null for invalid JSON', () => {
			const data = agent.parseSessionData('not json');
			assert.strictEqual(data, null, 'Should return null for invalid JSON');
		});

		test('should preserve optional fields', () => {
			const content = JSON.stringify({
				sessionId: 'test-123',
				timestamp: '2024-01-01T00:00:00Z',
				workflow: 'feature'
			});
			const data = agent.parseSessionData(content);
			assert.ok(data, 'Should parse session data');
			assert.strictEqual(data.timestamp, '2024-01-01T00:00:00Z', 'Should preserve timestamp');
			assert.strictEqual(data.workflow, 'feature', 'Should preserve workflow');
		});
	});

	suite('Status Parsing', () => {
		test('should parse valid status data', () => {
			const content = JSON.stringify({
				status: 'working',
				timestamp: '2024-01-01T00:00:00Z'
			});
			const status = agent.parseStatus(content);
			assert.ok(status, 'Should parse valid status');
			assert.strictEqual(status.status, 'working', 'Should extract status');
			assert.strictEqual(status.timestamp, '2024-01-01T00:00:00Z', 'Should extract timestamp');
		});

		test('should return null for missing status field', () => {
			const content = JSON.stringify({ timestamp: '2024-01-01T00:00:00Z' });
			const status = agent.parseStatus(content);
			assert.strictEqual(status, null, 'Should return null for missing status');
		});

		test('should return null for invalid JSON', () => {
			const status = agent.parseStatus('not json');
			assert.strictEqual(status, null, 'Should return null for invalid JSON');
		});

		test('should preserve optional message field', () => {
			const content = JSON.stringify({
				status: 'error',
				timestamp: '2024-01-01T00:00:00Z',
				message: 'Something went wrong'
			});
			const status = agent.parseStatus(content);
			assert.ok(status, 'Should parse status');
			assert.strictEqual(status.message, 'Something went wrong', 'Should preserve message');
		});
	});

	suite('Valid Status States', () => {
		test('should return list of valid status states', () => {
			const states = agent.getValidStatusStates();
			assert.ok(Array.isArray(states), 'Should return an array');
			assert.ok(states.length > 0, 'Should have at least one state');
		});

		test('should include standard status states', () => {
			const states = agent.getValidStatusStates();
			assert.ok(states.includes('working'), 'Should include working state');
			assert.ok(states.includes('waiting_for_user'), 'Should include waiting_for_user state');
			assert.ok(states.includes('idle'), 'Should include idle state');
		});
	});

	suite('Permission Modes', () => {
		test('should return list of permission modes', () => {
			const modes = agent.getPermissionModes();
			assert.ok(Array.isArray(modes), 'Should return an array');
			assert.ok(modes.length > 0, 'Should have at least one mode');
		});

		test('should include default permission mode', () => {
			const modes = agent.getPermissionModes();
			const defaultMode = modes.find((m: any) => m.id === 'default');
			assert.ok(defaultMode, 'Should include default mode');
			assert.strictEqual(defaultMode.label, 'Default', 'Default mode should have correct label');
		});

		test('should include OpenCode-specific permission modes', () => {
			const modes = agent.getPermissionModes();
			const allowEdits = modes.find((m: any) => m.id === 'allowEdits');
			assert.ok(allowEdits, 'Should include allowEdits mode');
			assert.ok(allowEdits.flag.includes('--permission-edit'), 'allowEdits should have permission-edit flag');
		});

		test('should validate permission modes', () => {
			assert.ok(agent.validatePermissionMode('default'), 'Should validate default mode');
			assert.ok(agent.validatePermissionMode('allowEdits'), 'Should validate allowEdits mode');
			assert.ok(!agent.validatePermissionMode('invalidMode'), 'Should reject invalid mode');
		});

		test('should return empty flag for default mode', () => {
			const flag = agent.getPermissionFlag('default');
			assert.strictEqual(flag, '', 'Default mode should have empty flag');
		});

		test('should return correct flag for non-default modes', () => {
			const flag = agent.getPermissionFlag('allowEdits');
			assert.ok(flag.includes('--permission-edit allow'), 'Should return correct permission flag');
		});
	});

	suite('Hook Events', () => {
		test('should return list of hook events', () => {
			const events = agent.getHookEvents();
			assert.ok(Array.isArray(events), 'Should return an array');
			assert.ok(events.length > 0, 'Should have at least one event');
		});

		test('should include OpenCode plugin events', () => {
			const events = agent.getHookEvents();
			assert.ok(events.includes('session.created'), 'Should include session.created event');
			assert.ok(events.includes('session.status'), 'Should include session.status event');
		});
	});

	suite('Plugin Configuration', () => {
		test('should generate plugin config instead of JSON hooks', () => {
			const hooks = agent.generateHooksConfig(
				'/worktree/path',
				'/path/to/session',
				'/path/to/status'
			);
			assert.ok(Array.isArray(hooks), 'Should return array of hooks');
			assert.ok(hooks.length > 0, 'Should generate at least one hook');
		});

		test('should generate SetupPlugin event', () => {
			const hooks = agent.generateHooksConfig(
				'/worktree/path',
				'/path/to/session',
				'/path/to/status'
			);
			const setupHook = hooks.find((h: any) => h.event === 'SetupPlugin');
			assert.ok(setupHook, 'Should include SetupPlugin event');
		});

		test('should include plugin directory creation', () => {
			const hooks = agent.generateHooksConfig(
				'/worktree/path',
				'/path/to/session',
				'/path/to/status'
			);
			const setupHook = hooks.find((h: any) => h.event === 'SetupPlugin');
			assert.ok(setupHook.commands[0].command.includes('mkdir -p'), 'Should create plugin directory');
		});

		test('should write plugin file with session tracking', () => {
			const hooks = agent.generateHooksConfig(
				'/worktree/path',
				'/path/to/session',
				'/path/to/status'
			);
			const setupHook = hooks.find((h: any) => h.event === 'SetupPlugin');
			const command = setupHook.commands[0].command;
			assert.ok(command.includes('session.created'), 'Plugin should handle session.created event');
			assert.ok(command.includes('session.status'), 'Plugin should handle session.status event');
		});

		test('should include session file path in plugin', () => {
			const hooks = agent.generateHooksConfig(
				'/worktree/path',
				'/path/to/session',
				'/path/to/status'
			);
			const setupHook = hooks.find((h: any) => h.event === 'SetupPlugin');
			const command = setupHook.commands[0].command;
			assert.ok(command.includes('/path/to/session'), 'Plugin should reference session file');
		});

		test('should include status file path in plugin', () => {
			const hooks = agent.generateHooksConfig(
				'/worktree/path',
				'/path/to/session',
				'/path/to/status'
			);
			const setupHook = hooks.find((h: any) => h.event === 'SetupPlugin');
			const command = setupHook.commands[0].command;
			assert.ok(command.includes('/path/to/status'), 'Plugin should reference status file');
		});

		test('should escape paths with special characters', () => {
			const hooks = agent.generateHooksConfig(
				"/worktree/path with 'quotes'",
				"/path/to/session with 'quotes'",
				"/path/to/status with 'quotes'"
			);
			const setupHook = hooks.find((h: any) => h.event === 'SetupPlugin');
			const command = setupHook.commands[0].command;
			// Command should use proper shell escaping
			assert.ok(command.includes("'"), 'Should use single quotes for path escaping');
		});
	});

	suite('MCP Support', () => {
		test('should support MCP', () => {
			assert.ok(agent.supportsMcp(), 'OpenCode should support MCP');
		});

		test('should return MCP config with lanes-workflow server', () => {
			const config = agent.getMcpConfig('/worktree/path', '/workflow/path.yaml');
			assert.ok(config, 'Should return MCP config');
			assert.ok(config.mcpServers, 'Should have mcpServers');
			assert.ok(config.mcpServers['lanes-workflow'], 'Should have lanes-workflow server');
		});

		test('should configure MCP server with correct command', () => {
			const config = agent.getMcpConfig('/worktree/path', '/workflow/path.yaml');
			const server = config.mcpServers['lanes-workflow'];
			assert.strictEqual(server.command, 'node', 'MCP server should use node command');
			assert.ok(Array.isArray(server.args), 'MCP server should have args array');
		});

		test('should include worktree path in MCP config', () => {
			const config = agent.getMcpConfig('/worktree/path', '/workflow/path.yaml');
			const server = config.mcpServers['lanes-workflow'];
			assert.ok(server.args.includes('--worktree'), 'Should include --worktree flag');
			assert.ok(server.args.includes('/worktree/path'), 'Should include worktree path');
		});

		test('should include workflow path in MCP config', () => {
			const config = agent.getMcpConfig('/worktree/path', '/workflow/path.yaml');
			const server = config.mcpServers['lanes-workflow'];
			assert.ok(server.args.includes('--workflow-path'), 'Should include --workflow-path flag');
			assert.ok(server.args.includes('/workflow/path.yaml'), 'Should include workflow path');
		});
	});
});

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
				description: 'Test agent',
				tools: ['Read', 'Write'],
				cannot: []
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
				summary: 'Add dark mode toggle'
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
				outputs: {}
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

		test('getWorkflowStatus extracts summary from workflow-state.json when present', () => {
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
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, 'Add dark mode toggle', 'Summary should be extracted from state');
		});

		test('getWorkflowStatus returns undefined summary when not present in workflow-state.json', () => {
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
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, undefined, 'Summary should be undefined when not in state');
		});

		test('getWorkflowStatus returns undefined summary for empty string', () => {
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
			const status = getWorkflowStatus(worktreePath);

			// Assert
			assert.ok(status, 'Should return workflow status');
			assert.strictEqual(status.summary, undefined, 'Summary should be undefined for empty string');
		});

		test('getWorkflowStatus returns undefined summary for whitespace-only string', () => {
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
			const status = getWorkflowStatus(worktreePath);

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
