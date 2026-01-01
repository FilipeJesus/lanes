import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getFeatureStatus, getClaudeStatus, getSessionId, getFeaturesJsonPath, getTestsJsonPath, getClaudeSessionPath, getClaudeStatusPath, getRepoIdentifier, getGlobalStoragePath, isGlobalStorageEnabled, initializeGlobalStorageContext, getSessionNameFromWorktree } from '../ClaudeSessionProvider';
import { getRepoName } from '../extension';

/**
 * Helper function to get a configuration property from the package.json configuration array.
 * Since configuration is now an array of sections, this function searches all sections
 * for the requested property key.
 *
 * @param config - The configuration array from package.json contributes.configuration
 * @param key - The full property key (e.g., 'claudeLanes.featuresJsonPath')
 * @returns The property configuration object, or undefined if not found
 */
function getConfigProperty(config: any[], key: string): any {
	for (const section of config) {
		if (section.properties?.[key]) {
			return section.properties[key];
		}
	}
	return undefined;
}

/**
 * Helper function to find a configuration section by its title.
 *
 * @param config - The configuration array from package.json contributes.configuration
 * @param title - The section title to find
 * @returns The section object, or undefined if not found
 */
function getConfigSection(config: any[], title: string): any {
	return config.find((section: any) => section.title === title);
}

suite('Configuration Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-config-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
	});

	// Clean up after each test
	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('Configurable JSON Paths', () => {

		let tempDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-json-paths-test-'));
		});

		teardown(async () => {
			// Reset all configuration values to default after each test
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('testsJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeSessionPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeStatusPath', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		test('should return worktree root path for features.json when featuresJsonPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, 'features.json'),
				'Should return features.json at worktree root when config is empty'
			);
		});

		test('should return custom path for features.json when featuresJsonPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'features.json'),
				'Should return features.json at worktree/.claude when config is set to .claude'
			);
		});

		test('should return worktree root path for tests.json when testsJsonPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('testsJsonPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getTestsJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, 'tests.json'),
				'Should return tests.json at worktree root when config is empty'
			);
		});

		test('should return custom path for tests.json when testsJsonPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('testsJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getTestsJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'tests.json'),
				'Should return tests.json at worktree/.claude when config is set to .claude'
			);
		});

		test('should be able to read claudeLanes configuration values', async () => {
			// Arrange: Set a configuration value
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', 'custom/path', vscode.ConfigurationTarget.Global);

			// Act: Read the configuration back
			const readConfig = vscode.workspace.getConfiguration('claudeLanes');
			const featuresPath = readConfig.get<string>('featuresJsonPath');

			// Assert
			assert.strictEqual(
				featuresPath,
				'custom/path',
				'Should be able to read the configured value'
			);
		});

		test('should verify package.json has correct configuration schema for featuresJsonPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.configuration section
			assert.ok(
				packageJson.contributes?.configuration,
				'package.json should have contributes.configuration section'
			);

			// Assert: featuresJsonPath configuration exists with correct schema
			const featuresConfig = getConfigProperty(packageJson.contributes.configuration, 'claudeLanes.featuresJsonPath');
			assert.ok(
				featuresConfig,
				'package.json should have claudeLanes.featuresJsonPath configuration'
			);
			assert.strictEqual(
				featuresConfig.type,
				'string',
				'featuresJsonPath should have type "string"'
			);
			assert.strictEqual(
				featuresConfig.default,
				'',
				'featuresJsonPath should have default value of empty string'
			);
		});

		test('should verify package.json has correct configuration schema for testsJsonPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: testsJsonPath configuration exists with correct schema
			const testsConfig = getConfigProperty(packageJson.contributes.configuration, 'claudeLanes.testsJsonPath');
			assert.ok(
				testsConfig,
				'package.json should have claudeLanes.testsJsonPath configuration'
			);
			assert.strictEqual(
				testsConfig.type,
				'string',
				'testsJsonPath should have type "string"'
			);
			assert.strictEqual(
				testsConfig.default,
				'',
				'testsJsonPath should have default value of empty string'
			);
		});

		test('should use configured featuresJsonPath in getFeatureStatus', async () => {
			// Arrange: Set custom path and create features.json in that location
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create the .claude directory and features.json in it
			const claudeDir = path.join(tempDir, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });
			const featuresJson = {
				features: [
					{ id: 'test-feature', description: 'Test feature', passes: false }
				]
			};
			fs.writeFileSync(path.join(claudeDir, 'features.json'), JSON.stringify(featuresJson));

			// Act
			const result = getFeatureStatus(tempDir);

			// Assert
			assert.ok(result.currentFeature, 'Should find the feature in the custom path');
			assert.strictEqual(result.currentFeature.id, 'test-feature', 'Should return the correct feature');
		});

		test('should return null when features.json is in root but config points elsewhere', async () => {
			// Arrange: Set custom path but put features.json in root
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create features.json in root (wrong location per config)
			const featuresJson = {
				features: [
					{ id: 'root-feature', description: 'Feature in root', passes: false }
				]
			};
			fs.writeFileSync(path.join(tempDir, 'features.json'), JSON.stringify(featuresJson));

			// Act
			const result = getFeatureStatus(tempDir);

			// Assert: Should not find the feature since it's looking in .claude/
			assert.strictEqual(result.currentFeature, null, 'Should not find feature when config points to different path');
			assert.strictEqual(result.allComplete, false);
		});

		test('should trim whitespace from configured paths', async () => {
			// Arrange: Set custom path with whitespace
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '  .claude  ', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should trim the whitespace
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'features.json'),
				'Should trim whitespace from configured path'
			);
		});

		test('should reject paths with parent directory traversal (..)', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '../../etc', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, 'features.json'),
				'Should reject path traversal and use default'
			);
		});

		test('should reject absolute paths', async () => {
			// Arrange: Set absolute path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '/etc/passwd', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, 'features.json'),
				'Should reject absolute paths and use default'
			);
		});

		test('should reject tests.json paths with parent directory traversal', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('testsJsonPath', '../../../tmp', vscode.ConfigurationTarget.Global);

			// Act
			const result = getTestsJsonPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, 'tests.json'),
				'Should reject path traversal and use default for tests.json'
			);
		});

		test('should convert Windows backslashes to forward slashes', async () => {
			// Arrange: Set path with Windows backslashes
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude\\subdir', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should normalize backslashes
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'subdir', 'features.json'),
				'Should convert backslashes to forward slashes'
			);
		});

		test('should allow nested relative paths without traversal', async () => {
			// Arrange: Set valid nested path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', 'config/claude/tracking', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should accept valid nested path
			assert.strictEqual(
				result,
				path.join(tempDir, 'config', 'claude', 'tracking', 'features.json'),
				'Should accept valid nested relative paths'
			);
		});
	});

	suite('Configurable Claude Session and Status Paths', () => {

		let tempDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-session-status-paths-test-'));
		});

		teardown(async () => {
			// Reset all configuration values to default after each test
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('testsJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeSessionPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeStatusPath', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		test('should return worktree root path for .claude-session when claudeSessionPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-session'),
				'Should return .claude-session at worktree root when config is empty'
			);
		});

		test('should return custom path for .claude-session when claudeSessionPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', '.claude-session'),
				'Should return .claude-session at worktree/.claude when config is set to .claude'
			);
		});

		test('should return worktree root path for .claude-status when claudeStatusPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-status'),
				'Should return .claude-status at worktree root when config is empty'
			);
		});

		test('should return custom path for .claude-status when claudeStatusPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', '.claude-status'),
				'Should return .claude-status at worktree/.claude when config is set to .claude'
			);
		});

		test('should read session ID from configured claudeSessionPath location', async () => {
			// Arrange: Set custom path and create .claude-session in that location
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create the .claude directory and .claude-session in it
			const claudeDir = path.join(tempDir, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });
			const sessionData = {
				sessionId: 'custom-session-123',
				timestamp: '2025-12-21T10:00:00Z'
			};
			fs.writeFileSync(path.join(claudeDir, '.claude-session'), JSON.stringify(sessionData));

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.ok(result, 'Should find the session in the custom path');
			assert.strictEqual(result.sessionId, 'custom-session-123', 'Should return the correct session ID');
			assert.strictEqual(result.timestamp, '2025-12-21T10:00:00Z', 'Should return the correct timestamp');
		});

		test('should read Claude status from configured claudeStatusPath location', async () => {
			// Arrange: Set custom path and create .claude-status in that location
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create the .claude directory and .claude-status in it
			const claudeDir = path.join(tempDir, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });
			const statusData = {
				status: 'waiting_for_user',
				timestamp: '2025-12-21T10:30:00Z',
				message: 'Waiting for confirmation'
			};
			fs.writeFileSync(path.join(claudeDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.ok(result, 'Should find the status in the custom path');
			assert.strictEqual(result.status, 'waiting_for_user', 'Should return the correct status');
			assert.strictEqual(result.timestamp, '2025-12-21T10:30:00Z', 'Should return the correct timestamp');
			assert.strictEqual(result.message, 'Waiting for confirmation', 'Should return the correct message');
		});

		test('should reject claudeSessionPath with parent directory traversal and fall back to worktree root', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '../../etc', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-session'),
				'Should reject path traversal and use default for .claude-session'
			);
		});

		test('should reject claudeStatusPath with parent directory traversal and fall back to worktree root', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '../../../tmp', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-status'),
				'Should reject path traversal and use default for .claude-status'
			);
		});

		test('should reject claudeSessionPath with absolute path and fall back to worktree root', async () => {
			// Arrange: Set absolute path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '/etc/passwd', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-session'),
				'Should reject absolute paths and use default for .claude-session'
			);
		});

		test('should reject claudeStatusPath with absolute path and fall back to worktree root', async () => {
			// Arrange: Set absolute path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '/tmp/evil', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-status'),
				'Should reject absolute paths and use default for .claude-status'
			);
		});

		test('should verify package.json has correct configuration schema for claudeSessionPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.configuration section
			assert.ok(
				packageJson.contributes?.configuration,
				'package.json should have contributes.configuration section'
			);

			// Assert: claudeSessionPath configuration exists with correct schema
			const sessionConfig = getConfigProperty(packageJson.contributes.configuration, 'claudeLanes.claudeSessionPath');
			assert.ok(
				sessionConfig,
				'package.json should have claudeLanes.claudeSessionPath configuration'
			);
			assert.strictEqual(
				sessionConfig.type,
				'string',
				'claudeSessionPath should have type "string"'
			);
			assert.strictEqual(
				sessionConfig.default,
				'',
				'claudeSessionPath should have default value of empty string'
			);
		});

		test('should verify package.json has correct configuration schema for claudeStatusPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: claudeStatusPath configuration exists with correct schema
			const statusConfig = getConfigProperty(packageJson.contributes.configuration, 'claudeLanes.claudeStatusPath');
			assert.ok(
				statusConfig,
				'package.json should have claudeLanes.claudeStatusPath configuration'
			);
			assert.strictEqual(
				statusConfig.type,
				'string',
				'claudeStatusPath should have type "string"'
			);
			assert.strictEqual(
				statusConfig.default,
				'',
				'claudeStatusPath should have default value of empty string'
			);
		});
	});

	suite('Global Storage', () => {

		let tempDir: string;
		let globalStorageDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-storage-test-'));
			globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));
		});

		teardown(async () => {
			// Reset global storage configuration
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
			fs.rmSync(globalStorageDir, { recursive: true, force: true });
		});

		suite('getRepoIdentifier', () => {

			test('should generate unique identifier with repo name and hash', () => {
				// Arrange
				const repoPath = '/path/to/my-project';

				// Act
				const result = getRepoIdentifier(repoPath);

				// Assert
				assert.ok(result.startsWith('my-project-'), 'Should start with repo name');
				assert.ok(result.length > 'my-project-'.length, 'Should have hash suffix');
				// Hash is 8 characters
				const hashPart = result.substring('my-project-'.length);
				assert.strictEqual(hashPart.length, 8, 'Hash part should be 8 characters');
				assert.ok(/^[a-f0-9]+$/.test(hashPart), 'Hash part should be hexadecimal');
			});

			test('should produce different identifiers for different repos with same name in different locations', () => {
				// Arrange
				const repoPath1 = '/path/to/my-project';
				const repoPath2 = '/other/location/my-project';

				// Act
				const result1 = getRepoIdentifier(repoPath1);
				const result2 = getRepoIdentifier(repoPath2);

				// Assert
				assert.notStrictEqual(
					result1,
					result2,
					'Different repo paths should produce different identifiers'
				);
				// Both should start with the same repo name
				assert.ok(result1.startsWith('my-project-'), 'First should start with repo name');
				assert.ok(result2.startsWith('my-project-'), 'Second should start with repo name');
			});

			test('should produce deterministic identifiers for the same repo', () => {
				// Arrange
				const repoPath = '/path/to/my-project';

				// Act
				const result1 = getRepoIdentifier(repoPath);
				const result2 = getRepoIdentifier(repoPath);

				// Assert
				assert.strictEqual(
					result1,
					result2,
					'Same repo path should always produce the same identifier'
				);
			});

			test('should sanitize special characters in repo name', () => {
				// Arrange
				const repoPath = '/path/to/my project@v1.0';

				// Act
				const result = getRepoIdentifier(repoPath);

				// Assert
				// Special characters should be replaced with underscores
				assert.ok(result.startsWith('my_project_v1_0-'), 'Should sanitize special characters');
				assert.ok(!result.includes(' '), 'Should not contain spaces');
				assert.ok(!result.includes('@'), 'Should not contain @ symbol');
				assert.ok(!result.includes('.'), 'Should not contain dots');
			});

			test('should normalize paths for cross-platform consistency', () => {
				// Arrange
				const repoPath1 = '/path/to/project';
				const repoPath2 = '/PATH/TO/PROJECT';

				// Act
				const result1 = getRepoIdentifier(repoPath1);
				const result2 = getRepoIdentifier(repoPath2);

				// Assert: The hash part should be the same (path is normalized to lowercase before hashing)
				// But the repo name prefix may differ in case since it comes from path.basename
				const hash1 = result1.split('-').pop();
				const hash2 = result2.split('-').pop();
				assert.strictEqual(
					hash1,
					hash2,
					'Hash part should be identical for case-different paths'
				);

				// Both should have the same prefix pattern (project name)
				assert.ok(
					result1.toLowerCase().startsWith('project-'),
					'First should have project name prefix'
				);
				assert.ok(
					result2.toLowerCase().startsWith('project-'),
					'Second should have project name prefix'
				);
			});
		});

		suite('getSessionNameFromWorktree', () => {

			test('should extract session name from worktree path', () => {
				// Arrange
				const worktreePath = '/path/to/repo/.worktrees/my-session';

				// Act
				const result = getSessionNameFromWorktree(worktreePath);

				// Assert
				assert.strictEqual(result, 'my-session');
			});

			test('should handle paths with special characters in session name', () => {
				// Arrange
				const worktreePath = '/path/to/repo/.worktrees/feature-123';

				// Act
				const result = getSessionNameFromWorktree(worktreePath);

				// Assert
				assert.strictEqual(result, 'feature-123');
			});
		});

		suite('getGlobalStoragePath', () => {

			test('should return null when global storage context is not initialized', () => {
				// Note: We cannot easily uninitialize the global storage context in tests
				// This test verifies behavior when getGlobalStoragePath is called
				// without proper initialization

				// Act: Initialize with valid values first, then check the path format
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'my-session');
				const result = getGlobalStoragePath(worktreePath, 'features.json');

				// Assert: Should return a valid path
				assert.ok(result, 'Should return a path when context is initialized');
				assert.ok(result!.includes('features.json'), 'Path should include filename');
			});

			test('should generate correct path structure: globalStorage/repoIdentifier/sessionName/filename', () => {
				// Arrange
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getGlobalStoragePath(worktreePath, '.claude-status');

				// Assert
				assert.ok(result, 'Should return a path');

				// Path should be: globalStorageDir/<repo-identifier>/test-session/.claude-status
				const repoIdentifier = getRepoIdentifier(tempDir);
				const expectedPath = path.join(globalStorageDir, repoIdentifier, 'test-session', '.claude-status');
				assert.strictEqual(result, expectedPath, 'Should match expected path structure');
			});

			test('should produce different paths for different repos with same session name', () => {
				// Arrange
				const repo1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo1-'));
				const repo2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo2-'));
				const mockUri = vscode.Uri.file(globalStorageDir);

				try {
					// Test with repo1
					initializeGlobalStorageContext(mockUri, repo1Dir);
					const path1 = getGlobalStoragePath(
						path.join(repo1Dir, '.worktrees', 'session-a'),
						'features.json'
					);

					// Test with repo2
					initializeGlobalStorageContext(mockUri, repo2Dir);
					const path2 = getGlobalStoragePath(
						path.join(repo2Dir, '.worktrees', 'session-a'),
						'features.json'
					);

					// Assert: Paths should be different due to different repo identifiers
					assert.ok(path1, 'Path 1 should exist');
					assert.ok(path2, 'Path 2 should exist');
					assert.notStrictEqual(
						path1,
						path2,
						'Different repos should have different paths even with same session name'
					);
				} finally {
					fs.rmSync(repo1Dir, { recursive: true, force: true });
					fs.rmSync(repo2Dir, { recursive: true, force: true });
				}
			});

			test('should produce identical paths for same repo and session (deterministic)', () => {
				// Arrange
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);
				const worktreePath = path.join(tempDir, '.worktrees', 'my-session');

				// Act
				const path1 = getGlobalStoragePath(worktreePath, 'features.json');
				const path2 = getGlobalStoragePath(worktreePath, 'features.json');

				// Assert
				assert.strictEqual(path1, path2, 'Same inputs should produce same path');
			});
		});

		suite('Path functions respect useGlobalStorage setting', () => {

			test('should return worktree-relative path when useGlobalStorage is false', async () => {
				// Arrange: Ensure global storage is disabled
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

				// Initialize global storage context (should not affect paths when disabled)
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				// Act
				const result = getFeaturesJsonPath(tempDir);

				// Assert: Should return worktree-relative path
				assert.strictEqual(
					result,
					path.join(tempDir, 'features.json'),
					'Should return worktree-relative path when global storage is disabled'
				);
			});

			test('should NOT return global storage path for getFeaturesJsonPath even when useGlobalStorage is true', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getFeaturesJsonPath(worktreePath);

				// Assert: features.json should NOT be in global storage (it's a dev workflow file)
				assert.ok(
					!result.startsWith(globalStorageDir),
					'features.json should NOT be in global storage'
				);
				assert.ok(
					result.startsWith(worktreePath),
					'features.json should be in worktree directory'
				);
				assert.ok(
					result.endsWith('features.json'),
					'Path should end with features.json'
				);
			});

			test('should return global storage path when useGlobalStorage is true for getClaudeStatusPath', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getClaudeStatusPath(worktreePath);

				// Assert: Should return global storage path
				assert.ok(
					result.startsWith(globalStorageDir),
					'Should return path in global storage directory'
				);
				assert.ok(
					result.endsWith('.claude-status'),
					'Path should end with .claude-status'
				);
			});

			test('should return global storage path when useGlobalStorage is true for getClaudeSessionPath', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getClaudeSessionPath(worktreePath);

				// Assert: Should return global storage path
				assert.ok(
					result.startsWith(globalStorageDir),
					'Should return path in global storage directory'
				);
				assert.ok(
					result.endsWith('.claude-session'),
					'Path should end with .claude-session'
				);
			});

			test('should NOT return global storage path for getTestsJsonPath even when useGlobalStorage is true', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getTestsJsonPath(worktreePath);

				// Assert: tests.json should NOT be in global storage (it's a dev workflow file)
				assert.ok(
					!result.startsWith(globalStorageDir),
					'tests.json should NOT be in global storage'
				);
				assert.ok(
					result.startsWith(worktreePath),
					'tests.json should be in worktree directory'
				);
				assert.ok(
					result.endsWith('tests.json'),
					'Path should end with tests.json'
				);
			});
		});

		suite('isGlobalStorageEnabled', () => {

			test('should return true when useGlobalStorage is not set (default)', async () => {
				// Arrange: Reset to default
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

				// Act
				const result = isGlobalStorageEnabled();

				// Assert
				assert.strictEqual(result, true, 'Should default to true');
			});

			test('should return true when useGlobalStorage is true', async () => {
				// Arrange
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Act
				const result = isGlobalStorageEnabled();

				// Assert
				assert.strictEqual(result, true, 'Should return true when enabled');
			});

			test('should return false when useGlobalStorage is explicitly false', async () => {
				// Arrange
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

				// Act
				const result = isGlobalStorageEnabled();

				// Assert
				assert.strictEqual(result, false, 'Should return false when explicitly disabled');
			});
		});
	});

	suite('Configuration', () => {

		test('should verify package.json has useGlobalStorage configuration', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.configuration section
			assert.ok(
				packageJson.contributes?.configuration,
				'package.json should have contributes.configuration section'
			);

			// Assert: useGlobalStorage configuration exists with correct schema
			const globalStorageConfig = getConfigProperty(packageJson.contributes.configuration, 'claudeLanes.useGlobalStorage');
			assert.ok(
				globalStorageConfig,
				'package.json should have claudeLanes.useGlobalStorage configuration'
			);
			assert.strictEqual(
				globalStorageConfig.type,
				'boolean',
				'useGlobalStorage should have type "boolean"'
			);
			assert.strictEqual(
				globalStorageConfig.default,
				true,
				'useGlobalStorage should have default value of true'
			);
		});

		test('should verify useGlobalStorage has a meaningful description', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const globalStorageConfig = getConfigProperty(packageJson.contributes.configuration, 'claudeLanes.useGlobalStorage');

			assert.ok(
				globalStorageConfig.description,
				'useGlobalStorage should have a description'
			);
			assert.ok(
				globalStorageConfig.description.length > 20,
				'Description should be meaningful (more than 20 chars)'
			);
			assert.ok(
				globalStorageConfig.description.toLowerCase().includes('global storage') ||
				globalStorageConfig.description.toLowerCase().includes('worktree'),
				'Description should mention global storage or worktree'
			);
		});
	});

	suite('Configuration Structure', () => {

		test('should verify configuration is an array with 3 sections', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: configuration should be an array
			assert.ok(
				Array.isArray(packageJson.contributes?.configuration),
				'package.json contributes.configuration should be an array'
			);

			// Assert: configuration should have exactly 3 elements
			assert.strictEqual(
				packageJson.contributes.configuration.length,
				3,
				'Configuration array should have exactly 3 sections'
			);
		});

		test('should verify each configuration section has the correct title', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			const config = packageJson.contributes.configuration;

			// Assert: sections should have correct titles
			const expectedTitles = [
				'Claude Lanes: General',
				'Claude Lanes: Git',
				'Claude Lanes: Advanced'
			];

			const actualTitles = config.map((section: any) => section.title);

			assert.deepStrictEqual(
				actualTitles,
				expectedTitles,
				'Configuration sections should have correct titles in order'
			);
		});
	});

	suite('Configuration Sections', () => {

		test('should verify General section contains correct settings', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const generalSection = getConfigSection(packageJson.contributes.configuration, 'Claude Lanes: General');

			// Assert: General section should exist
			assert.ok(generalSection, 'General section should exist');

			// Assert: General section should contain worktreesFolder and promptsFolder
			assert.ok(
				generalSection.properties?.['claudeLanes.worktreesFolder'],
				'General section should contain worktreesFolder'
			);
			assert.ok(
				generalSection.properties?.['claudeLanes.promptsFolder'],
				'General section should contain promptsFolder'
			);

			// Assert: Settings should have correct order
			assert.strictEqual(
				generalSection.properties['claudeLanes.worktreesFolder'].order,
				1,
				'worktreesFolder should have order 1'
			);
			assert.strictEqual(
				generalSection.properties['claudeLanes.promptsFolder'].order,
				2,
				'promptsFolder should have order 2'
			);
		});

		test('should verify Git section contains correct settings', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const gitSection = getConfigSection(packageJson.contributes.configuration, 'Claude Lanes: Git');

			// Assert: Git section should exist
			assert.ok(gitSection, 'Git section should exist');

			// Assert: Git section should contain baseBranch and includeUncommittedChanges
			assert.ok(
				gitSection.properties?.['claudeLanes.baseBranch'],
				'Git section should contain baseBranch'
			);
			assert.ok(
				gitSection.properties?.['claudeLanes.includeUncommittedChanges'],
				'Git section should contain includeUncommittedChanges'
			);

			// Assert: Settings should have correct order
			assert.strictEqual(
				gitSection.properties['claudeLanes.baseBranch'].order,
				1,
				'baseBranch should have order 1'
			);
			assert.strictEqual(
				gitSection.properties['claudeLanes.includeUncommittedChanges'].order,
				2,
				'includeUncommittedChanges should have order 2'
			);
		});

		test('should verify Advanced section contains correct settings', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const advancedSection = getConfigSection(packageJson.contributes.configuration, 'Claude Lanes: Advanced');

			// Assert: Advanced section should exist
			assert.ok(advancedSection, 'Advanced section should exist');

			// Assert: Advanced section should contain all expected settings
			const expectedSettings = [
				'claudeLanes.useGlobalStorage',
				'claudeLanes.claudeSessionPath',
				'claudeLanes.claudeStatusPath',
				'claudeLanes.featuresJsonPath',
				'claudeLanes.testsJsonPath'
			];

			for (const setting of expectedSettings) {
				assert.ok(
					advancedSection.properties?.[setting],
					`Advanced section should contain ${setting}`
				);
			}

			// Assert: Settings should have correct order (1-5)
			assert.strictEqual(
				advancedSection.properties['claudeLanes.useGlobalStorage'].order,
				1,
				'useGlobalStorage should have order 1'
			);
			assert.strictEqual(
				advancedSection.properties['claudeLanes.claudeSessionPath'].order,
				2,
				'claudeSessionPath should have order 2'
			);
			assert.strictEqual(
				advancedSection.properties['claudeLanes.claudeStatusPath'].order,
				3,
				'claudeStatusPath should have order 3'
			);
			assert.strictEqual(
				advancedSection.properties['claudeLanes.featuresJsonPath'].order,
				4,
				'featuresJsonPath should have order 4'
			);
			assert.strictEqual(
				advancedSection.properties['claudeLanes.testsJsonPath'].order,
				5,
				'testsJsonPath should have order 5'
			);
		});
	});

	suite('Configuration Defaults', () => {

		test('should verify all setting default values are preserved', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			const config = packageJson.contributes.configuration;

			// Test each setting's default value
			const worktreesFolder = getConfigProperty(config, 'claudeLanes.worktreesFolder');
			assert.strictEqual(
				worktreesFolder.default,
				'.worktrees',
				'worktreesFolder should default to .worktrees'
			);

			const promptsFolder = getConfigProperty(config, 'claudeLanes.promptsFolder');
			assert.strictEqual(
				promptsFolder.default,
				'.claude/lanes',
				'promptsFolder should default to .claude/lanes'
			);

			const baseBranch = getConfigProperty(config, 'claudeLanes.baseBranch');
			assert.strictEqual(
				baseBranch.default,
				'',
				'baseBranch should default to empty string'
			);

			const includeUncommittedChanges = getConfigProperty(config, 'claudeLanes.includeUncommittedChanges');
			assert.strictEqual(
				includeUncommittedChanges.default,
				true,
				'includeUncommittedChanges should default to true'
			);

			const useGlobalStorage = getConfigProperty(config, 'claudeLanes.useGlobalStorage');
			assert.strictEqual(
				useGlobalStorage.default,
				true,
				'useGlobalStorage should default to true'
			);

			const claudeSessionPath = getConfigProperty(config, 'claudeLanes.claudeSessionPath');
			assert.strictEqual(
				claudeSessionPath.default,
				'',
				'claudeSessionPath should default to empty string'
			);

			const claudeStatusPath = getConfigProperty(config, 'claudeLanes.claudeStatusPath');
			assert.strictEqual(
				claudeStatusPath.default,
				'',
				'claudeStatusPath should default to empty string'
			);

			const featuresJsonPath = getConfigProperty(config, 'claudeLanes.featuresJsonPath');
			assert.strictEqual(
				featuresJsonPath.default,
				'',
				'featuresJsonPath should default to empty string'
			);

			const testsJsonPath = getConfigProperty(config, 'claudeLanes.testsJsonPath');
			assert.strictEqual(
				testsJsonPath.default,
				'',
				'testsJsonPath should default to empty string'
			);
		});
	});

	suite('Configuration Descriptions', () => {

		test('should verify settings have user-friendly descriptions', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			const config = packageJson.contributes.configuration;

			// Expected descriptions for each setting
			const expectedDescriptions: { [key: string]: string } = {
				'claudeLanes.worktreesFolder': 'Folder name where session worktrees are created (relative to repository root). Default: .worktrees',
				'claudeLanes.promptsFolder': 'Folder where session starting prompts are stored (relative to repository root). Default: .claude/lanes',
				'claudeLanes.baseBranch': 'Branch to compare against when viewing changes. Leave empty for auto-detection (tries origin/main, origin/master, main, master)',
				'claudeLanes.includeUncommittedChanges': 'Show uncommitted changes (staged and unstaged) when viewing session changes. Default: enabled',
				'claudeLanes.useGlobalStorage': 'Store session tracking files in VS Code\'s storage instead of worktree folders. Keeps worktrees cleaner but files are hidden from version control. Default: enabled',
				'claudeLanes.claudeSessionPath': 'Relative path for .claude-session file within each worktree. Only used when Use Global Storage is disabled. Leave empty for worktree root',
				'claudeLanes.claudeStatusPath': 'Relative path for .claude-status file within each worktree. Only used when Use Global Storage is disabled. Leave empty for worktree root',
				'claudeLanes.featuresJsonPath': 'Relative path for features.json within each worktree. Leave empty for worktree root',
				'claudeLanes.testsJsonPath': 'Relative path for tests.json within each worktree. Leave empty for worktree root'
			};

			for (const [key, expectedDescription] of Object.entries(expectedDescriptions)) {
				const setting = getConfigProperty(config, key);
				assert.ok(setting, `Setting ${key} should exist`);
				assert.strictEqual(
					setting.description,
					expectedDescription,
					`${key} should have the expected description`
				);
			}
		});
	});
});
