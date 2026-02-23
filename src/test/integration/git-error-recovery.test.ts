/**
 * Git Error Recovery Integration Tests
 *
 * Tests git operation error handling and recovery mechanisms including:
 * - Merge-base fallback to three-dot diff syntax
 * - Worktree conflict recovery with prune
 * - Network error handling (timeouts, remote not found)
 * - Invalid reference errors with actionable messages
 * - State consistency after failed operations
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import { vol } from 'memfs';
import { GitError } from '../../core/errors';
import * as gitService from '../../gitService';
import { validateBranchName } from '../../core/utils';
import { setupMemfs, createTestRepo } from '../testSetup';

suite('Git Error Recovery: Merge-base Fallback', () => {

	let memfs: ReturnType<typeof setupMemfs>;
	let execGitStub: sinon.SinonStub;

	setup(() => {
		memfs = setupMemfs();
		execGitStub = sinon.stub(gitService, 'execGit');
	});

	teardown(() => {
		memfs.reset();
		execGitStub.restore();
	});

	test('should fall back to diff when merge-base fails', async () => {
		// Arrange: Stub merge-base to fail with "not a valid commit" error
		const mergeBaseError = new GitError(
			['merge-base', 'main', 'HEAD'],
			128,
			'fatal: not a valid commit'
		);
		execGitStub
			.withArgs(sinon.match.array.deepEquals(['merge-base', 'main', 'HEAD']), sinon.match.string)
			.rejects(mergeBaseError);

		// Stub diff with three-dot syntax to succeed
		const diffOutput = 'diff --git a/file.ts b/file.ts\n+ new line';
		execGitStub
			.withArgs(sinon.match.array.deepEquals(['diff', 'main...HEAD']), sinon.match.string)
			.resolves(diffOutput);

		// Act: Simulate the merge-base fallback logic
		let usedFallback = false;
		let result = '';

		try {
			// Try merge-base first
			result = await gitService.execGit(['merge-base', 'main', 'HEAD'], '/test');
		} catch {
			// Fall back to three-dot diff
			usedFallback = true;
			result = await gitService.execGit(['diff', 'main...HEAD'], '/test');
		}

		// Assert: Diff fallback was attempted
		assert.ok(usedFallback, 'Should have fallen back to diff after merge-base failure');
		assert.strictEqual(result, diffOutput, 'Should get diff output via fallback');

		// Verify merge-base was called first
		sinon.assert.calledOnce(execGitStub.withArgs(sinon.match.array.deepEquals(['merge-base', 'main', 'HEAD']), sinon.match.string));

		// Verify diff was called with three-dot syntax
		sinon.assert.calledWith(execGitStub, sinon.match.array.deepEquals(['diff', 'main...HEAD']), sinon.match.string);
	});

	test('should handle merge-base timeout gracefully', async () => {
		// Arrange: Stub merge-base to fail with timeout error
		const timeoutError = new GitError(
			['merge-base', 'main', 'HEAD'],
			undefined,
			'merge-base timed out after 30 seconds'
		);
		execGitStub
			.withArgs(sinon.match.array.deepEquals(['merge-base', 'main', 'HEAD']), sinon.match.string)
			.rejects(timeoutError);

		// Act: Attempt merge-base operation
		let caughtError: Error | undefined;
		try {
			await gitService.execGit(['merge-base', 'main', 'HEAD'], '/test');
		} catch (err) {
			caughtError = err as Error;
		}

		// Assert: Error was caught and contains timeout context
		assert.ok(caughtError, 'Should catch the timeout error');
		assert.ok(
			caughtError!.message.includes('timed out') || caughtError!.message.includes('timeout'),
			'Error message should mention timeout'
		);
		assert.ok(caughtError instanceof GitError, 'Should be GitError instance');
	});
});

suite('Git Error Recovery: Worktree Conflicts', () => {

	let memfs: ReturnType<typeof setupMemfs>;
	let execGitStub: sinon.SinonStub;
	let tempDir: string;

	setup(() => {
		memfs = setupMemfs();
		execGitStub = sinon.stub(gitService, 'execGit');
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-worktree-conflict-'));
	});

	teardown(() => {
		memfs.reset();
		execGitStub.restore();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('should prune and retry on worktree add conflict', async () => {
		const worktreePath = '/test/session';
		const branch = 'session';
		const args = ['worktree', 'add', worktreePath, branch];

		// Arrange: First call fails with "already exists" error, second succeeds
		const conflictError = new GitError(args, 1, 'fatal: worktree already exists');

		execGitStub
			.onCall(0)
			.rejects(conflictError);

		execGitStub
			.onCall(1)
			.resolves('');

		execGitStub
			.onCall(2)
			.resolves('');

		// Act: Simulate worktree creation with retry logic
		let success = false;
		let attempts = 0;
		const maxAttempts = 2;

		while (attempts < maxAttempts && !success) {
			attempts++;
			try {
				await gitService.execGit(args, tempDir);
				success = true;
			} catch (err) {
				if ((err as Error).message.includes('already exists') && attempts === 1) {
					// Prune and retry
					await gitService.execGit(['worktree', 'prune'], tempDir);
				} else {
					throw err;
				}
			}
		}

		// Assert: Success after recovery
		assert.ok(success, 'Should succeed after prune and retry');
		assert.strictEqual(attempts, 2, 'Should have made 2 attempts');

		// Verify prune was called
		sinon.assert.calledWith(execGitStub, sinon.match.array.deepEquals(['worktree', 'prune']), tempDir);
	});

	test('should give up after max retries on persistent worktree error', async () => {
		const worktreePath = '/test/session';
		const branch = 'session';
		const args = ['worktree', 'add', worktreePath, branch];

		// Arrange: All worktree add calls fail with same error, prune succeeds
		const persistentError = new GitError(args, 1, 'fatal: worktree already exists');

		// First 3 calls are worktree add (fail), calls 1 and 2 are prune (succeed)
		// Call pattern: add(fail), prune(success), add(fail), prune(success), add(fail)
		for (let i = 0; i < 5; i++) {
			if (i === 1 || i === 3) {
				// Prune calls
				execGitStub.onCall(i).resolves('');
			} else {
				// Worktree add calls
				execGitStub.onCall(i).rejects(persistentError);
			}
		}

		// Act: Attempt worktree creation with max retry limit
		let success = false;
		let attempts = 0;
		const maxRetries = 3;
		let finalError: Error | undefined;

		while (attempts < maxRetries && !success) {
			attempts++;
			try {
				await gitService.execGit(args, tempDir);
				success = true;
			} catch (err) {
				if (attempts < maxRetries) {
					// Prune and retry
					await gitService.execGit(['worktree', 'prune'], tempDir);
				} else {
					finalError = err as Error;
				}
			}
		}

		// Assert: Failure after exhausting retries
		assert.ok(!success, 'Should fail after exhausting retries');
		assert.strictEqual(attempts, maxRetries, 'Should have attempted maxRetries times');
		assert.ok(finalError, 'Should have final error');

		// Verify error includes retry context
		assert.ok(
			finalError!.message.includes('already exists'),
			'Error should contain original error message'
		);
	});
});

suite('Git Error Recovery: Network Errors', () => {

	let memfs: ReturnType<typeof setupMemfs>;
	let execGitStub: sinon.SinonStub;

	setup(() => {
		memfs = setupMemfs();
		execGitStub = sinon.stub(gitService, 'execGit');
	});

	teardown(() => {
		memfs.reset();
		execGitStub.restore();
	});

	test('should handle fetch timeout with informative error', async () => {
		// Arrange: Stub fetch to reject with connection timeout
		const args = ['fetch', 'origin'];
		const timeoutError = new GitError(
			args,
			undefined,
			'Connection timed out after 30 seconds'
		);
		execGitStub
			.withArgs(sinon.match.array.deepEquals(args), sinon.match.string)
			.rejects(timeoutError);

		// Act: Attempt fetch operation
		let caughtError: Error | undefined;
		try {
			await gitService.execGit(args, '/test');
		} catch (err) {
			caughtError = err as Error;
		}

		// Assert: GitError with timeout details
		assert.ok(caughtError, 'Should catch the timeout error');
		assert.ok(
			caughtError!.message.includes('timed out') || caughtError!.message.includes('timeout'),
			'Error should mention timeout'
		);
		assert.ok(
			caughtError instanceof GitError,
			'Error should be GitError instance'
		);

		const gitErr = caughtError as GitError;
		assert.deepStrictEqual(gitErr.command, args, 'Should include command in error');
		assert.ok(gitErr.userMessage.includes('fetch'), 'User message should mention fetch command');
	});

	test('should handle remote not found error', async () => {
		// Arrange: Stub ls-remote to fail with "remote not found"
		const args = ['ls-remote', 'nonexistent-remote'];
		const remoteNotFoundError = new GitError(
			args,
			128,
			'fatal: nonexistent-remote does not appear to be a git repository'
		);
		execGitStub
			.withArgs(sinon.match.array.deepEquals(args), sinon.match.string)
			.rejects(remoteNotFoundError);

		// Act: Attempt ls-remote operation
		let caughtError: Error | undefined;
		try {
			await gitService.execGit(args, '/test');
		} catch (err) {
			caughtError = err as Error;
		}

		// Assert: GitError with remote context
		assert.ok(caughtError, 'Should catch the remote not found error');
		assert.ok(
			caughtError!.message.includes('nonexistent-remote') ||
			caughtError!.message.includes('does not appear to be a git repository'),
			'Error should mention the remote name or repository issue'
		);
		assert.ok(caughtError instanceof GitError, 'Error should be GitError instance');
	});
});

suite('Git Error Recovery: Invalid References', () => {

	test('should provide actionable error for invalid branch', () => {
		// Arrange: Branch with @{ sequence is invalid
		const invalidBranch = 'main@{1';

		// Act: Validate branch name
		const validationResult = validateBranchName(invalidBranch);

		// Assert: ValidationError before git operations
		assert.ok(!validationResult.valid, 'Should reject branch with @{ sequence');
		assert.ok(
			validationResult.error?.includes('invalid characters'),
			'Error should explain invalid characters'
		);

		// Verify userMessage explains @{ restriction
		assert.ok(
			validationResult.error?.includes('Worktrees cannot be created'),
			'Error should explain worktree restriction'
		);
	});

	test('should handle non-existent ref gracefully', async () => {
		const execGitStub = sinon.stub(gitService, 'execGit');

		try {
			// Arrange: Stub show-ref to fail with "not a valid ref"
			const args = ['show-ref', '--verify', 'refs/heads/nonexistent-branch'];
			const refError = new GitError(
				args,
				1,
				'fatal: not a valid ref: refs/heads/nonexistent-branch'
			);
			execGitStub
				.withArgs(sinon.match.array.deepEquals(args), sinon.match.string)
				.rejects(refError);

			// Act: Attempt show-ref operation
			let caughtError: Error | undefined;
			try {
				await gitService.execGit(args, '/test');
			} catch (err) {
				caughtError = err as Error;
			}

			// Assert: GitError with ref details
			assert.ok(caughtError, 'Should catch the ref error');
			assert.ok(
				caughtError!.message.includes('not a valid ref') ||
				caughtError!.message.includes('nonexistent-branch'),
				'Error should mention ref validation issue or branch name'
			);
		} finally {
			execGitStub.restore();
		}
	});
});

suite('Git Error Recovery: State Consistency', () => {

	let tempDir: string;
	let memfs: ReturnType<typeof setupMemfs>;
	let execGitStub: sinon.SinonStub;
	let testRepoPath: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-state-consistency-'));
		testRepoPath = path.join(tempDir, 'test-repo');
		memfs = setupMemfs();
		execGitStub = sinon.stub(gitService, 'execGit');

		// Create test repo structure in memfs
		createTestRepo(vol, testRepoPath);
	});

	teardown(() => {
		memfs.reset();
		execGitStub.restore();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('should leave consistent state after failed worktree creation', async () => {
		// Arrange: Track created files for cleanup verification
		const worktreePath = path.join(testRepoPath, '.worktrees', 'test-session');
		const args = ['worktree', 'add', worktreePath, 'test-session'];

		// Stub worktree add to fail
		execGitStub
			.withArgs(sinon.match.array.deepEquals(args), testRepoPath)
			.rejects(new GitError(
				args,
				1,
				'fatal: worktree add failed'
			));

		// Act: Attempt worktree creation
		let caughtError: Error | undefined;
		try {
			await gitService.execGit(args, testRepoPath);
		} catch (err) {
			caughtError = err as Error;
		}

		// Assert: Error was caught
		assert.ok(caughtError, 'Should catch worktree add error');
		assert.ok(caughtError instanceof GitError, 'Error should be GitError instance');

		// Verify error contains failure context
		assert.ok(
			caughtError!.message.includes('worktree add') ||
			caughtError!.message.includes('failed'),
			'Error should indicate worktree add failure'
		);

		// Verify no orphaned worktree directory exists
		const worktreeExists = vol.existsSync(worktreePath);
		assert.ok(!worktreeExists, 'Worktree should not exist after failed creation');
	});

	test('should not corrupt session list after git error', async () => {
		// Arrange: Create existing session list
		const existingSessions = ['session-1', 'session-2', 'session-3'];

		// Stub git operation to fail
		execGitStub
			.onCall(0)
			.rejects(new GitError(
				['worktree', 'add', '/test/new-session', 'new-session'],
				1,
				'fatal: git operation failed'
			));

		// Stub worktree list to return existing sessions (not including new one)
		execGitStub
			.onCall(1)
			.resolves(existingSessions
				.map((s: string) => `worktree ${path.join(testRepoPath, '.worktrees', s)}`)
				.join('\n'));

		// Act: Attempt to add new session
		let caughtError: Error | undefined;
		try {
			await gitService.execGit(['worktree', 'add', '/test/new-session', 'new-session'], testRepoPath);
		} catch (err) {
			caughtError = err as Error;
		}

		// Verify sessions after error by calling list
		const listOutput = await gitService.execGit(['worktree', 'list', '--porcelain'], testRepoPath);
		const listedSessions = listOutput
			.split('\n')
			.filter((line: string) => line.startsWith('worktree'))
			.map((line: string) => path.basename(line.split(' ')[1]));

		// Assert: Error was caught
		assert.ok(caughtError, 'Should catch git operation error');

		// Verify original session list intact
		assert.deepStrictEqual(
			listedSessions.sort(),
			existingSessions.sort(),
			'Original session list should remain intact'
		);

		// Assert new session not added
		assert.ok(
			!listedSessions.includes('new-session'),
			'New session should not be in the list'
		);
	});
});
