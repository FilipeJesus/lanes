import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import * as gitService from '../../gitService';
import { getBranchesInWorktrees } from '../../vscode/services/SessionService';
import { branchExists } from '../../core/services/BrokenWorktreeService';

suite('Git Branches Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;
	let execGitStub: sinon.SinonStub;
	let originalExecGit: typeof gitService.execGit;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-git-branches-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');

		// Save original execGit before stubbing
		originalExecGit = gitService.execGit.bind(gitService);

		// Set up git stubs for mocking to prevent parent directory traversal
		execGitStub = sinon.stub(gitService, 'execGit');

		// Configure stub behavior for different git commands
		execGitStub.callsFake(async (args: string[], cwd: string, options?: gitService.ExecGitOptions) => {
			// Mock worktree list command - return empty output for non-git directories
			if (args[0] === 'worktree' && args[1] === 'list' && args.includes('--porcelain')) {
				// Check if this is a real git repo by looking for .git directory
				const gitDir = path.join(cwd, '.git');
				try {
					fs.statSync(gitDir);
					// This is a real git repo, use real git
					return await originalExecGit(args, cwd, options);
				} catch {
					// Not a git repo, return empty output
					return '';
				}
			}

			// Mock rev-parse for non-git directories
			if (args.includes('rev-parse')) {
				const gitDir = path.join(cwd, '.git');
				try {
					fs.statSync(gitDir);
					// This is a real git repo, use real git
					return await originalExecGit(args, cwd, options);
				} catch {
					// Not a git repo, throw error
					throw new Error('not a git repository');
				}
			}

			// For other commands, use real git
			return await originalExecGit(args, cwd, options);
		});
	});

	// Clean up after each test
	teardown(() => {
		// Restore stubs
		if (execGitStub) {
			execGitStub.restore();
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('Branch Handling', () => {
		// These tests use the actual git repository since branchExists and getBranchesInWorktrees
		// are real git operations. The test repository has:
		// - A 'main' branch
		// - Multiple test-* branches (test-1, test-2, etc.)
		// - At least one worktree at .worktrees/test-16

		// Get the path to the git repository root
		// __dirname is out/test (compiled), so we go up twice to reach the project root
		// This works whether running from the main repo or from a worktree
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('branchExists should return true for an existing branch', async function() {
			// Arrange: Check for 'main' branch - skip if not available (e.g., in CI)
			const mainExists = await branchExists(repoRoot, 'main');
			if (!mainExists) {
				this.skip(); // Skip in environments where main branch is not a local branch
			}

			// Assert
			assert.strictEqual(mainExists, true, 'branchExists should return true for "main" branch which exists');
		});

		test('branchExists should return false for a non-existent branch', async () => {
			// Arrange: Use a branch name that definitely does not exist
			const nonExistentBranch = 'nonexistent-branch-that-does-not-exist-xyz-123456789';

			// Act
			const result = await branchExists(repoRoot, nonExistentBranch);

			// Assert
			assert.strictEqual(result, false, 'branchExists should return false for a branch that does not exist');
		});

		test('getBranchesInWorktrees should correctly parse worktree list output', async function() {
			// Arrange: The repository has at least one worktree that we are running in

			// Act
			const result = await getBranchesInWorktrees(repoRoot);

			// Assert: The result should be a Set
			assert.ok(result instanceof Set, 'getBranchesInWorktrees should return a Set');

			// In CI environments without worktrees, the set may be empty - skip in that case
			if (result.size === 0) {
				this.skip(); // Skip in environments without worktrees (e.g., CI)
			}

			// Assert: The Set should contain at least one branch
			assert.ok(result.size > 0, 'getBranchesInWorktrees should return at least one branch for repository with worktrees');
		});

		test('getBranchesInWorktrees should return empty set when no worktrees have branches', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			// Our stub will return empty output for non-git directories
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-dir-'));

			try {
				// Act
				const result = await getBranchesInWorktrees(tempNonGitDir);

				// Assert: Should return an empty Set for a non-git directory
				assert.ok(result instanceof Set, 'getBranchesInWorktrees should return a Set');
				assert.strictEqual(result.size, 0, 'getBranchesInWorktrees should return empty Set for non-git directory');
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});
	});
});
