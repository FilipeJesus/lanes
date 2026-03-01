import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	getRepoIdentifier,
	getSessionNameFromWorktree,
	getGlobalStoragePath,
	initializeGlobalStorageContext,
	getStatusFilePath,
	getSessionFilePath,
} from '../../vscode/providers/AgentSessionProvider';
import {
	resolveSessionFilePath,
	resolveStatusFilePath,
} from '../../core/session/SessionDataService';

suite('Global Storage Configuration Test Suite', () => {

	let tempDir: string;
	let globalStorageDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-storage-test-'));
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));
	});

	teardown(async () => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	suite('Session Management Paths (always repo-local)', () => {

		let testTempDir: string;
		let mockGlobalStorageDir: string;

		setup(async () => {
			testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-global-test-'));
			mockGlobalStorageDir = path.join(os.tmpdir(), 'vscode-mock-global-storage');
			fs.mkdirSync(mockGlobalStorageDir, { recursive: true });
			const mockUri = vscode.Uri.file(mockGlobalStorageDir);
			initializeGlobalStorageContext(mockUri, testTempDir);
		});

		teardown(async () => {
			fs.rmSync(testTempDir, { recursive: true, force: true });
			if (fs.existsSync(mockGlobalStorageDir)) {
				fs.rmSync(mockGlobalStorageDir, { recursive: true, force: true });
			}
		});

		test('should return .lanes/session_management path for getStatusFilePath', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const result = getStatusFilePath(worktreePath);

			const expectedPath = path.join(testTempDir, '.lanes', 'session_management', 'test-session', '.claude-status');
			assert.strictEqual(result, expectedPath);
		});

		test('should return .lanes/session_management path for getSessionFilePath', async () => {
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
	});

	suite('Fallback Resolvers', () => {

		let testTempDir: string;
		let mockGlobalStorageDir: string;

		setup(async () => {
			testTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fallback-resolver-test-'));
			mockGlobalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-fallback-global-storage-'));
			const mockUri = vscode.Uri.file(mockGlobalStorageDir);
			initializeGlobalStorageContext(mockUri, testTempDir);
		});

		teardown(async () => {
			fs.rmSync(testTempDir, { recursive: true, force: true });
			fs.rmSync(mockGlobalStorageDir, { recursive: true, force: true });
		});

		test('should resolve to non-global path when file exists only in non-global location', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const localPath = getSessionFilePath(worktreePath);

			// Create the file at the non-global location
			fs.mkdirSync(path.dirname(localPath), { recursive: true });
			fs.writeFileSync(localPath, JSON.stringify({ sessionId: 'test-123' }));

			const resolved = await resolveSessionFilePath(worktreePath);
			assert.strictEqual(resolved, localPath);
		});

		test('should resolve to global path when file exists only in global storage', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const globalPath = getGlobalStoragePath(worktreePath, '.claude-session');

			assert.ok(globalPath, 'Global storage path should be available');

			// Create the file only at the global storage location
			fs.mkdirSync(path.dirname(globalPath!), { recursive: true });
			fs.writeFileSync(globalPath!, JSON.stringify({ sessionId: 'global-123' }));

			const resolved = await resolveSessionFilePath(worktreePath);
			assert.strictEqual(resolved, globalPath);
		});

		test('should prefer non-global path when file exists in both locations', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const localPath = getSessionFilePath(worktreePath);
			const globalPath = getGlobalStoragePath(worktreePath, '.claude-session');

			assert.ok(globalPath, 'Global storage path should be available');

			// Create files at both locations
			fs.mkdirSync(path.dirname(localPath), { recursive: true });
			fs.writeFileSync(localPath, JSON.stringify({ sessionId: 'local-123' }));
			fs.mkdirSync(path.dirname(globalPath!), { recursive: true });
			fs.writeFileSync(globalPath!, JSON.stringify({ sessionId: 'global-123' }));

			const resolved = await resolveSessionFilePath(worktreePath);
			assert.strictEqual(resolved, localPath);
		});

		test('should return non-global path when no file exists anywhere', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const localPath = getSessionFilePath(worktreePath);

			const resolved = await resolveSessionFilePath(worktreePath);
			assert.strictEqual(resolved, localPath);
		});

		test('should resolve status file from global storage fallback', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const globalPath = getGlobalStoragePath(worktreePath, '.claude-status');

			assert.ok(globalPath, 'Global storage path should be available');

			// Create the file only at the global storage location
			fs.mkdirSync(path.dirname(globalPath!), { recursive: true });
			fs.writeFileSync(globalPath!, JSON.stringify({ status: 'working' }));

			const resolved = await resolveStatusFilePath(worktreePath);
			assert.strictEqual(resolved, globalPath);
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

	suite('Path functions always return repo-local paths', () => {

		test('should return .lanes/session_management path for getStatusFilePath', async () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getStatusFilePath(worktreePath);

			assert.ok(result.includes('.lanes/session_management'));
			assert.ok(result.endsWith('.claude-status'));
		});

		test('should return .lanes/session_management path for getSessionFilePath', async () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getSessionFilePath(worktreePath);

			assert.ok(result.includes('.lanes/session_management'));
			assert.ok(result.endsWith('.claude-session'));
		});
	});
});
