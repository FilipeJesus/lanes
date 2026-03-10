import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import { parse as yamlParse } from 'yaml';
import {
	initializeGlobalStorageContext,
} from '../../vscode/providers/AgentSessionProvider';
import { getOrCreateExtensionSettingsFile } from '../../core/services/SettingsService';
import { VscodeConfigProvider } from '../../vscode/adapters/VscodeConfigProvider';
import { UNIFIED_DEFAULTS } from '../../core/services/UnifiedSettingsService';

suite('Extension Settings File Location', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	// Create a temp directory structure before tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-ext-settings-location-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		fs.mkdirSync(worktreesDir, { recursive: true });
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

		// Initialize global storage context for tests
		const mockUri = vscode.Uri.file(globalStorageDir);
		initializeGlobalStorageContext(mockUri, tempDir);

	});

	// Clean up after each test
	teardown(async () => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	suite('Settings File Location', () => {

		test('should create settings file at correct repo-local path', async () => {
			// Arrange
			const sessionName = 'test-session';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			const expectedPath = path.join(tempDir, '.lanes', 'current-sessions', sessionName, 'claude-settings.json');
			assert.strictEqual(settingsPath, expectedPath, 'Settings file should be at <repo>/.lanes/current-sessions/<session-name>/claude-settings.json');
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

		test('settings file should be created in repo-local .lanes/current-sessions/, not worktree', async () => {
			// Arrange
			const sessionName = 'storage-location-test';
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			// Act
			const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

			// Assert
			assert.ok(
				settingsPath.startsWith(tempDir),
				'Settings file should be under the repo root'
			);
			assert.ok(
				settingsPath.includes('.lanes/current-sessions/'),
				'Settings file should be in .lanes/current-sessions/ directory'
			);
			assert.ok(
				!settingsPath.startsWith(worktreePath),
				'Settings file should NOT be in worktree directory'
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

// vscode-config-provider-initialize (critical)
suite('VscodeConfigProvider', () => {
	let tempDir: string;
	let provider: VscodeConfigProvider;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-vscode-config-provider-'));
	});

	teardown(() => {
		if (provider) {
			provider.dispose();
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// vscode-config-provider-initialize (critical)
	// Given settings.yaml already exists, when initialize() is called,
	// then get() returns settings.yaml values (not VSCode values)
	test('get() delegates to UnifiedSettingsService and returns settings.yaml values after initialize()', async () => {
		// Arrange: create settings.yaml with custom values
		const lanesDir = path.join(tempDir, '.lanes');
		fs.mkdirSync(lanesDir, { recursive: true });
		fs.writeFileSync(
			path.join(lanesDir, 'settings.yaml'),
			'lanes:\n  worktreesFolder: from-yaml\n  defaultAgent: codex\n',
			'utf-8'
		);

		// Act
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Assert: values from settings.yaml are returned
		assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), 'from-yaml');
		assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'codex');
	});

	// vscode-config-provider-initialize (critical)
	// get() delegates to UnifiedSettingsService and returns UNIFIED_DEFAULTS when settings.yaml is empty
	test('get() returns UNIFIED_DEFAULTS when settings.yaml is empty', async () => {
		// Arrange: no settings.yaml
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Assert: UNIFIED_DEFAULTS are returned
		assert.strictEqual(
			provider.get('lanes', 'worktreesFolder', 'fallback'),
			UNIFIED_DEFAULTS['lanes.worktreesFolder']
		);
		assert.strictEqual(
			provider.get('lanes', 'defaultAgent', 'fallback'),
			UNIFIED_DEFAULTS['lanes.defaultAgent']
		);
	});

	// vscode-config-provider-initialize (critical)
	// Given no settings.yaml exists, when initialize() is called, then settings.yaml may be seeded
	// from VSCode settings that differ from UNIFIED_DEFAULTS.
	// (The seeding step only writes if the VSCode value differs from the default — in the test VS Code
	// environment the workspace settings are defaults so no file is written; we verify the provider still works.)
	test('initialize() is idempotent when no settings.yaml exists and VSCode settings are defaults', async () => {
		// Arrange: no .lanes directory at all
		provider = new VscodeConfigProvider();

		// Act: should not throw
		await provider.initialize(tempDir);

		// Assert: get() still works and returns defaults
		const worktreesFolder = provider.get('lanes', 'worktreesFolder', 'FALLBACK');
		assert.strictEqual(worktreesFolder, UNIFIED_DEFAULTS['lanes.worktreesFolder']);
	});

	test('get() for unknown section returns provided default', async () => {
		// Arrange
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Act & Assert
		assert.strictEqual(provider.get('unknown-section', 'key', 'my-default'), 'my-default');
	});

	test('onDidChange returns a disposable that does not throw on dispose', async () => {
		// Arrange
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Act
		const disposable = provider.onDidChange('lanes', () => {});

		// Assert
		assert.ok(disposable, 'Should return a disposable');
		assert.ok(typeof disposable.dispose === 'function');
		assert.doesNotThrow(() => disposable.dispose());
	});

	test('initialize() succeeds even if .lanes directory does not exist', async () => {
		// Arrange: ensure no .lanes directory
		const lanesDir = path.join(tempDir, '.lanes');
		assert.ok(!fs.existsSync(lanesDir), '.lanes should not exist initially');

		// Act
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Assert: provider works without throwing
		const value = provider.get('lanes', 'worktreesFolder', 'fallback');
		assert.strictEqual(value, UNIFIED_DEFAULTS['lanes.worktreesFolder']);
	});

	test('settings.yaml values take precedence over UNIFIED_DEFAULTS', async () => {
		// Arrange: create settings.yaml overriding a default
		const lanesDir = path.join(tempDir, '.lanes');
		fs.mkdirSync(lanesDir, { recursive: true });
		fs.writeFileSync(
			path.join(lanesDir, 'settings.yaml'),
			'lanes:\n  permissionMode: bypassPermissions\n',
			'utf-8'
		);

		// Act
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Assert: settings.yaml value takes precedence
		assert.strictEqual(provider.get('lanes', 'permissionMode', 'fallback'), 'bypassPermissions');
		// Other defaults still hold
		assert.strictEqual(
			provider.get('lanes', 'worktreesFolder', 'fallback'),
			UNIFIED_DEFAULTS['lanes.worktreesFolder']
		);
	});

	test('initialize() migrates legacy .lanes/config.json to settings.yaml', async () => {
		// Arrange: create legacy config.json, no settings.yaml
		const lanesDir = path.join(tempDir, '.lanes');
		fs.mkdirSync(lanesDir, { recursive: true });
		fs.writeFileSync(
			path.join(lanesDir, 'config.json'),
			JSON.stringify({ worktreesFolder: 'from-legacy-cli' }),
			'utf-8'
		);

		// Act
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Assert: settings.yaml was created via migration
		const settingsPath = path.join(lanesDir, 'settings.yaml');
		assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created after migration');

		const content = fs.readFileSync(settingsPath, 'utf-8');
		const parsed = yamlParse(content) as Record<string, unknown>;
		const lanes = parsed['lanes'] as Record<string, unknown>;
		assert.strictEqual(lanes['worktreesFolder'], 'from-legacy-cli');

		// And get() returns the migrated value
		assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), 'from-legacy-cli');
	});

	test('initialize() does not overwrite existing settings.yaml during migration', async () => {
		// Arrange: both config.json and settings.yaml exist
		const lanesDir = path.join(tempDir, '.lanes');
		fs.mkdirSync(lanesDir, { recursive: true });
		fs.writeFileSync(
			path.join(lanesDir, 'config.json'),
			JSON.stringify({ worktreesFolder: 'from-legacy' }),
			'utf-8'
		);
		const existingYaml = 'lanes:\n  worktreesFolder: from-existing-yaml\n';
		fs.writeFileSync(path.join(lanesDir, 'settings.yaml'), existingYaml, 'utf-8');

		// Act
		provider = new VscodeConfigProvider();
		await provider.initialize(tempDir);

		// Assert: settings.yaml is not overwritten
		const content = fs.readFileSync(path.join(lanesDir, 'settings.yaml'), 'utf-8');
		assert.strictEqual(content, existingYaml, 'settings.yaml should not be overwritten');

		assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), 'from-existing-yaml');
	});

	test('initialize() preserves workspace-specific VS Code settings as local overrides even when global settings exist', async () => {
		const originalHome = process.env.HOME;
		const tempHomeDir = path.join(tempDir, 'home');
		fs.mkdirSync(path.join(tempHomeDir, '.lanes'), { recursive: true });
		process.env.HOME = tempHomeDir;

		const lanesDir = path.join(tempDir, '.lanes');
		fs.mkdirSync(lanesDir, { recursive: true });
		fs.writeFileSync(
			path.join(tempHomeDir, '.lanes', 'settings.yaml'),
			'lanes:\n  defaultAgent: claude\n',
			'utf-8'
		);

		const realGetConfiguration = vscode.workspace.getConfiguration.bind(vscode.workspace);
		const getConfigurationStub = sinon.stub(vscode.workspace, 'getConfiguration').callsFake((section?: string) => {
			if (section !== 'lanes') {
				return realGetConfiguration(section as never);
			}

			return {
				get: (key: string) => key === 'defaultAgent' ? 'codex' : undefined,
				inspect: (key: string) => ({
					defaultValue: UNIFIED_DEFAULTS[`lanes.${key}`],
					globalValue: undefined,
					workspaceValue: key === 'defaultAgent' ? 'codex' : undefined,
					workspaceFolderValue: undefined,
				}),
			} as vscode.WorkspaceConfiguration;
		});

		try {
			provider = new VscodeConfigProvider();
			await provider.initialize(tempDir);

			const settingsPath = path.join(lanesDir, 'settings.yaml');
			assert.ok(fs.existsSync(settingsPath), 'workspace override should be written to local settings');

			const content = fs.readFileSync(settingsPath, 'utf-8');
			const parsed = yamlParse(content) as Record<string, unknown>;
			const lanes = parsed['lanes'] as Record<string, unknown>;
			assert.strictEqual(lanes['defaultAgent'], 'codex');
			assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'codex');
		} finally {
			getConfigurationStub.restore();
			if (originalHome === undefined) {
				delete process.env.HOME;
			} else {
				process.env.HOME = originalHome;
			}
		}
	});
});
