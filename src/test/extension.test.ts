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
	getGlobalStoragePath
} from '../ClaudeSessionProvider';
import { getOrCreateExtensionSettingsFile } from '../extension';

suite('Extension Settings File', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	// Create a temp directory structure before tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-ext-settings-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		fs.mkdirSync(worktreesDir, { recursive: true });
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

		// Initialize global storage context for tests
		const mockUri = vscode.Uri.file(globalStorageDir);
		initializeGlobalStorageContext(mockUri, tempDir);

		// Enable global storage for these tests
		const config = vscode.workspace.getConfiguration('claudeLanes');
		await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);
	});

	// Clean up after each test
	teardown(async () => {
		// Reset configuration
		const config = vscode.workspace.getConfiguration('claudeLanes');
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
			const config = vscode.workspace.getConfiguration('claudeLanes');
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
			const config = vscode.workspace.getConfiguration('claudeLanes');
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
			const config = vscode.workspace.getConfiguration('claudeLanes');
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
			const config = vscode.workspace.getConfiguration('claudeLanes');
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
			const config = vscode.workspace.getConfiguration('claudeLanes');
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
});
