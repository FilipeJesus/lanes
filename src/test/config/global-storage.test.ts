import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import {
	getSessionNameFromWorktree,
	initializeGlobalStorageContext,
	getStatusFilePath,
	getSessionFilePath,
} from '../../vscode/providers/AgentSessionProvider';
import {
	resolveSessionFilePath,
	resolveStatusFilePath,
	ensureLanesGitignore,
} from '../../core/session/SessionDataService';

/** Compute the old global storage path for backward-compat fallback tests */
function computeGlobalStorageFilePath(globalStorageDir: string, baseRepoPath: string, worktreePath: string, filename: string): string {
	const normalizedPath = path.normalize(baseRepoPath).toLowerCase();
	const hash = crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 8);
	const repoName = path.basename(baseRepoPath).replace(/[^a-zA-Z0-9_-]/g, '_');
	const repoIdentifier = `${repoName}-${hash}`;
	const sessionName = path.basename(worktreePath);
	return path.join(globalStorageDir, repoIdentifier, sessionName, filename);
}

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

		test('should return .lanes/current-sessions path for getStatusFilePath', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const result = getStatusFilePath(worktreePath);

			const expectedPath = path.join(testTempDir, '.lanes', 'current-sessions', 'test-session', '.claude-status');
			assert.strictEqual(result, expectedPath);
		});

		test('should return .lanes/current-sessions path for getSessionFilePath', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'my-feature');
			const result = getSessionFilePath(worktreePath);

			const expectedPath = path.join(testTempDir, '.lanes', 'current-sessions', 'my-feature', '.claude-session');
			assert.strictEqual(result, expectedPath);
		});

		test('should create session-specific subdirectories within .lanes/current-sessions', async () => {
			const session1Path = path.join(testTempDir, '.worktrees', 'session-a');
			const session2Path = path.join(testTempDir, '.worktrees', 'session-b');

			const status1 = getStatusFilePath(session1Path);
			const status2 = getStatusFilePath(session2Path);

			assert.ok(status1.includes('session-a'));
			assert.ok(status2.includes('session-b'));
			assert.ok(status1.includes('.lanes/current-sessions'));
			assert.ok(status2.includes('.lanes/current-sessions'));
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
			const globalPath = computeGlobalStorageFilePath(mockGlobalStorageDir, testTempDir, worktreePath, '.claude-session');

			// Create the file only at the global storage location
			fs.mkdirSync(path.dirname(globalPath), { recursive: true });
			fs.writeFileSync(globalPath, JSON.stringify({ sessionId: 'global-123' }));

			const resolved = await resolveSessionFilePath(worktreePath);
			assert.strictEqual(resolved, globalPath);
		});

		test('should prefer non-global path when file exists in both locations', async () => {
			const worktreePath = path.join(testTempDir, '.worktrees', 'test-session');
			const localPath = getSessionFilePath(worktreePath);
			const globalPath = computeGlobalStorageFilePath(mockGlobalStorageDir, testTempDir, worktreePath, '.claude-session');

			// Create files at both locations
			fs.mkdirSync(path.dirname(localPath), { recursive: true });
			fs.writeFileSync(localPath, JSON.stringify({ sessionId: 'local-123' }));
			fs.mkdirSync(path.dirname(globalPath), { recursive: true });
			fs.writeFileSync(globalPath, JSON.stringify({ sessionId: 'global-123' }));

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
			const globalPath = computeGlobalStorageFilePath(mockGlobalStorageDir, testTempDir, worktreePath, '.claude-status');

			// Create the file only at the global storage location
			fs.mkdirSync(path.dirname(globalPath), { recursive: true });
			fs.writeFileSync(globalPath, JSON.stringify({ status: 'working' }));

			const resolved = await resolveStatusFilePath(worktreePath);
			assert.strictEqual(resolved, globalPath);
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

	suite('ensureLanesGitignore', () => {

		test('should create .lanes/.gitignore with all required entries', async () => {
			const gitignorePath = path.join(tempDir, '.lanes', '.gitignore');

			await ensureLanesGitignore(tempDir);

			assert.ok(fs.existsSync(gitignorePath), '.lanes/.gitignore should exist');
			const content = fs.readFileSync(gitignorePath, 'utf-8');
			const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
			assert.ok(lines.includes('clear-requests'), 'Should contain clear-requests');
			assert.ok(lines.includes('current-sessions'), 'Should contain current-sessions');
			assert.ok(lines.includes('pending-sessions'), 'Should contain pending-sessions');
			assert.ok(lines.includes('prompts'), 'Should contain prompts');
		});

		test('should be idempotent (no duplicates on second call)', async () => {
			await ensureLanesGitignore(tempDir);
			const first = fs.readFileSync(path.join(tempDir, '.lanes', '.gitignore'), 'utf-8');

			await ensureLanesGitignore(tempDir);
			const second = fs.readFileSync(path.join(tempDir, '.lanes', '.gitignore'), 'utf-8');

			assert.strictEqual(first, second, 'Content should be identical after second call');
		});

		test('should preserve existing content and only add missing entries', async () => {
			const lanesDir = path.join(tempDir, '.lanes');
			fs.mkdirSync(lanesDir, { recursive: true });
			fs.writeFileSync(path.join(lanesDir, '.gitignore'), 'custom-entry\ncurrent-sessions\n');

			await ensureLanesGitignore(tempDir);

			const content = fs.readFileSync(path.join(lanesDir, '.gitignore'), 'utf-8');
			assert.ok(content.includes('custom-entry'), 'Should preserve existing entries');
			assert.ok(content.includes('current-sessions'), 'Should keep existing matching entry');
			assert.ok(content.includes('clear-requests'), 'Should add missing entry');
			assert.ok(content.includes('pending-sessions'), 'Should add missing entry');
			assert.ok(content.includes('prompts'), 'Should add missing entry');

			// current-sessions should appear only once
			const matches = content.split('\n').filter(l => l.trim() === 'current-sessions');
			assert.strictEqual(matches.length, 1, 'Should not duplicate existing entries');
		});
	});

	suite('Path functions always return repo-local paths', () => {

		test('should return .lanes/current-sessions path for getStatusFilePath', async () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getStatusFilePath(worktreePath);

			assert.ok(result.includes('.lanes/current-sessions'));
			assert.ok(result.endsWith('.claude-status'));
		});

		test('should return .lanes/current-sessions path for getSessionFilePath', async () => {
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			const result = getSessionFilePath(worktreePath);

			assert.ok(result.includes('.lanes/current-sessions'));
			assert.ok(result.endsWith('.claude-session'));
		});
	});
});
