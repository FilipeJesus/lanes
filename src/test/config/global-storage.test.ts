import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	getRepoIdentifier,
	getSessionNameFromWorktree,
	getGlobalStoragePath,
	isGlobalStorageEnabled,
	initializeGlobalStorageContext,
	getStatusFilePath,
	getSessionFilePath,
} from '../../AgentSessionProvider';

/**
 * Helper function to get a configuration property from the package.json configuration array.
 * Since configuration is now an array of sections, this function searches all sections
 * for the requested property key.
 */
function getConfigProperty(config: any[], key: string): any {
	for (const section of config) {
		if (section.properties?.[key]) {
			return section.properties[key];
		}
	}
	return undefined;
}

suite('Global Storage Configuration Test Suite', () => {

	let tempDir: string;
	let globalStorageDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-storage-test-'));
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));
	});

	teardown(async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	suite('Non-Global Session Management Path', () => {

		let testTempDir: string;
		let mockGlobalStorageDir: string;

		setup(async () => {
			testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-global-test-'));
			mockGlobalStorageDir = path.join(os.tmpdir(), 'vscode-mock-global-storage');
			fs.mkdirSync(mockGlobalStorageDir, { recursive: true });
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);
			const mockUri = vscode.Uri.file(mockGlobalStorageDir);
			initializeGlobalStorageContext(mockUri, testTempDir);
		});

		teardown(async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(testTempDir, { recursive: true, force: true });
			if (fs.existsSync(mockGlobalStorageDir)) {
				fs.rmSync(mockGlobalStorageDir, { recursive: true, force: true });
			}
		});

		test('should return .lanes/session_management path for getStatusFilePath when useGlobalStorage is false', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const result = getStatusFilePath(worktreePath);

			const expectedPath = path.join(testTempDir, '.lanes', 'session_management', 'test-session', '.claude-status');
			assert.strictEqual(result, expectedPath);
		});

		test('should return .lanes/session_management path for getSessionFilePath when useGlobalStorage is false', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'my-feature');
			const result = getSessionFilePath(worktreePath);

			const expectedPath = path.join(testTempDir, '.lanes', 'session_management', 'my-feature', '.claude-session');
			assert.strictEqual(result, expectedPath);
		});

		test('should create session-specific subdirectories within .lanes/session_management', async () => {
			const session1Path = path.join(testTempDir, '.worktrees', 'session-a');
			const session2Path = path.join(testTempDir, '.worktrees', 'session-b');

			const status1 = getStatusFilePath(session1Path);
			const status2 = getStatusFilePath(session2Path);

			assert.ok(status1.includes('session-a'));
			assert.ok(status2.includes('session-b'));
			assert.ok(status1.includes('.lanes/session_management'));
			assert.ok(status2.includes('.lanes/session_management'));
		});

		test('should fall back to global storage when useGlobalStorage is true', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const result = getStatusFilePath(worktreePath);

			assert.ok(result.startsWith(mockGlobalStorageDir));
		});
	});

	suite('getRepoIdentifier', () => {

		test('should generate unique identifier with repo name and hash', () => {
			const repoPath = '/path/to/my-project';
			const result = getRepoIdentifier(repoPath);

			assert.ok(result.startsWith('my-project-'));
			assert.ok(result.length > 'my-project-'.length);
			const hashPart = result.substring('my-project-'.length);
			assert.strictEqual(hashPart.length, 8);
			assert.ok(/^[a-f0-9]+$/.test(hashPart));
		});

		test('should produce different identifiers for different repos with same name in different locations', () => {
			const repoPath1 = '/path/to/my-project';
			const repoPath2 = '/other/location/my-project';

			const result1 = getRepoIdentifier(repoPath1);
			const result2 = getRepoIdentifier(repoPath2);

			assert.notStrictEqual(result1, result2);
			assert.ok(result1.startsWith('my-project-'));
			assert.ok(result2.startsWith('my-project-'));
		});

		test('should produce deterministic identifiers for the same repo', () => {
			const repoPath = '/path/to/my-project';

			const result1 = getRepoIdentifier(repoPath);
			const result2 = getRepoIdentifier(repoPath);

			assert.strictEqual(result1, result2);
		});

		test('should sanitize special characters in repo name', () => {
			const repoPath = '/path/to/my project@v1.0';
			const result = getRepoIdentifier(repoPath);

			assert.ok(result.startsWith('my_project_v1_0-'));
			assert.ok(!result.includes(' '));
			assert.ok(!result.includes('@'));
			assert.ok(!result.includes('.'));
		});

		test('should normalize paths for cross-platform consistency', () => {
			const repoPath1 = '/path/to/project';
			const repoPath2 = '/PATH/TO/PROJECT';

			const result1 = getRepoIdentifier(repoPath1);
			const result2 = getRepoIdentifier(repoPath2);

			const hash1 = result1.split('-').pop();
			const hash2 = result2.split('-').pop();
			assert.strictEqual(hash1, hash2);

			assert.ok(result1.toLowerCase().startsWith('project-'));
			assert.ok(result2.toLowerCase().startsWith('project-'));
		});
	});

	suite('getSessionNameFromWorktree', () => {

		test('should extract session name from worktree path', () => {
			const worktreePath = '/path/to/repo/.worktrees/my-session';
			const result = getSessionNameFromWorktree(worktreePath);

			assert.strictEqual(result, 'my-session');
		});

		test('should handle paths with special characters in session name', () => {
			const worktreePath = '/path/to/repo/.worktrees/feature-123';
			const result = getSessionNameFromWorktree(worktreePath);

			assert.strictEqual(result, 'feature-123');
		});
	});

	suite('getGlobalStoragePath', () => {

		test('should return path when global storage context is initialized', () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'my-session');
			const result = getGlobalStoragePath(worktreePath, '.claude-status');

			assert.ok(result);
			assert.ok(result!.includes('.claude-status'));
		});

		test('should generate correct path structure: globalStorage/repoIdentifier/sessionName/filename', () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getGlobalStoragePath(worktreePath, '.claude-status');

			assert.ok(result);

			const repoIdentifier = getRepoIdentifier(tempDir);
			const expectedPath = path.join(globalStorageDir, repoIdentifier, 'test-session', '.claude-status');
			assert.strictEqual(result, expectedPath);
		});

		test('should produce different paths for different repos with same session name', () => {
			const repo1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo1-'));
			const repo2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo2-'));
			const mockUri = vscode.Uri.file(globalStorageDir);

			try {
				initializeGlobalStorageContext(mockUri, repo1Dir);
				const path1 = getGlobalStoragePath(
					path.join(repo1Dir, '.worktrees', 'session-a'),
					'.claude-status'
				);

				initializeGlobalStorageContext(mockUri, repo2Dir);
				const path2 = getGlobalStoragePath(
					path.join(repo2Dir, '.worktrees', 'session-a'),
					'.claude-status'
				);

				assert.ok(path1);
				assert.ok(path2);
				assert.notStrictEqual(path1, path2);
			} finally {
				fs.rmSync(repo1Dir, { recursive: true, force: true });
				fs.rmSync(repo2Dir, { recursive: true, force: true });
			}
		});

		test('should produce identical paths for same repo and session (deterministic)', () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);
			const worktreePath = path.join(tempDir, '.worktrees', 'my-session');

			const path1 = getGlobalStoragePath(worktreePath, '.claude-status');
			const path2 = getGlobalStoragePath(worktreePath, '.claude-status');

			assert.strictEqual(path1, path2);
		});
	});

	suite('Path functions respect useGlobalStorage setting', () => {

		test('should return global storage path for getStatusFilePath when useGlobalStorage is true', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getStatusFilePath(worktreePath);

			assert.ok(result.startsWith(globalStorageDir));
			assert.ok(result.endsWith('.claude-status'));
		});

		test('should return global storage path for getSessionFilePath when useGlobalStorage is true', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getSessionFilePath(worktreePath);

			assert.ok(result.startsWith(globalStorageDir));
			assert.ok(result.endsWith('.claude-session'));
		});
	});

	suite('isGlobalStorageEnabled', () => {

		test('should return true when useGlobalStorage is not set (default)', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

			const result = isGlobalStorageEnabled();

			assert.strictEqual(result, true);
		});

		test('should return true when useGlobalStorage is true', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

			const result = isGlobalStorageEnabled();

			assert.strictEqual(result, true);
		});

		test('should return false when useGlobalStorage is explicitly false', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

			const result = isGlobalStorageEnabled();

			assert.strictEqual(result, false);
		});
	});
});
