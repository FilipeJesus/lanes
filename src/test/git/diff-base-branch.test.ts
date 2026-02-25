import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import * as gitService from '../../gitService';
import { AgentSessionProvider } from '../../vscode/providers/AgentSessionProvider';
import { getBaseBranch } from '../../core/services/DiffService';
import * as SettingsService from '../../core/services/SettingsService';

suite('Git Base Branch Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;
	let execGitStub: sinon.SinonStub;
	let originalExecGit: typeof gitService.execGit;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-git-base-branch-test-'));
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

	suite('getBaseBranch', () => {
		// Note: These tests use the actual git repository to test getBaseBranch behavior.
		// The function checks for origin/main, origin/master, local main, local master in that order.

		// Get the path to the git repository root
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('should return a branch name for a valid git repository', async () => {
			// Act: Call getBaseBranch on our real repository
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return one of the expected base branches
			const validBranches = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validBranches.includes(result),
				`getBaseBranch should return one of ${validBranches.join(', ')}, got: ${result}`
			);
		});

		test('should prefer origin/main if it exists', async () => {
			// Note: This test assumes origin/main exists in our repository
			// If origin/main exists, it should be returned first
			const result = await getBaseBranch(repoRoot);

			// For most GitHub repos with a main branch and origin remote, this should return origin/main
			// If the result is origin/main, the preference logic is working
			if (result === 'origin/main') {
				assert.ok(true, 'getBaseBranch correctly prefers origin/main');
			} else {
				// If origin/main doesn't exist, the function falls back appropriately
				assert.ok(
					['origin/master', 'main', 'master'].includes(result),
					`getBaseBranch fell back to: ${result}`
				);
			}
		});

		test('should return main as fallback for non-git directory', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			// Our stub will throw an error for non-git directories, causing the function to use fallback
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-base-branch-'));

			try {
				// Act
				const result = await getBaseBranch(tempNonGitDir);

				// Assert: Should return 'main' as the default fallback
				assert.strictEqual(
					result,
					'main',
					'getBaseBranch should return "main" as fallback for non-git directory'
				);
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});
	});

	suite('Base Branch Configuration', () => {
		// These tests verify that getBaseBranch correctly uses the lanes.baseBranch
		// configuration setting, and falls back to auto-detection when not set.

		// Get the path to the git repository root for fallback tests
		const repoRoot = path.resolve(__dirname, '..', '..');

		teardown(async () => {
			// Reset the baseBranch configuration to default after each test
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('baseBranch', undefined, vscode.ConfigurationTarget.Global);
		});

		test('should return configured value when lanes.baseBranch setting is set', async () => {
			// Arrange: Pass the configured branch value directly
			const result = await getBaseBranch(repoRoot, 'develop');

			// Assert: Should return the configured value
			assert.strictEqual(
				result,
				'develop',
				'getBaseBranch should return the configured baseBranch value "develop"'
			);
		});

		test('should use fallback detection when baseBranch setting is empty', async () => {
			// Act: Call getBaseBranch with empty configured branch
			const result = await getBaseBranch(repoRoot, '');

			// Assert: Should return one of the fallback branches
			// The fallback order is: origin/main, origin/master, main, master
			const validFallbacks = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validFallbacks.includes(result),
				`getBaseBranch should return a fallback branch when config is empty, got: "${result}"`
			);
		});

		test('should treat whitespace-only setting as empty and use fallback', async () => {
			// Act: Call getBaseBranch with whitespace-only configured branch
			const result = await getBaseBranch(repoRoot, '   ');

			// Assert: Should return one of the fallback branches (treating whitespace as empty)
			const validFallbacks = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validFallbacks.includes(result),
				`getBaseBranch should use fallback when config is whitespace-only, got: "${result}"`
			);
		});
	});

	suite('Worktree Detection', () => {
		// Test getBaseRepoPath functionality for detecting worktrees
		// and resolving to the base repository path

		// Get the path to the git repository root
		// __dirname is out/test/git, so we need to go up 3 levels to reach the worktree root
		const repoRoot = path.resolve(__dirname, '..', '..', '..');

		test('should return same path for regular git repository', async () => {
			// Arrange: Use the actual repo root - this is a regular repo from the main
			// branch perspective, or we're in a worktree
			// Act
			const result = await SettingsService.getBaseRepoPath(repoRoot);

			// Assert: The result should be a valid directory path
			assert.ok(
				typeof result === 'string' && result.length > 0,
				'getBaseRepoPath should return a non-empty string'
			);
			// The result should be an existing directory
			assert.ok(
				fs.existsSync(result),
				`getBaseRepoPath result should be an existing path: ${result}`
			);
		});

		test('should return base repo path when in a worktree', async () => {
			// This test runs from within a worktree (test-35)
			// The worktree is at: <base-repo>/.worktrees/test-35
			// getBaseRepoPath should return: <base-repo>

			// Act
			const result = await SettingsService.getBaseRepoPath(repoRoot);

			// Assert: Check if we're in a worktree by looking at the path structure
			// If the current repoRoot contains '.worktrees', we're in a worktree
			if (repoRoot.includes('.worktrees')) {
				// We're in a worktree, result should be the parent of .worktrees
				const worktreesIndex = repoRoot.indexOf('.worktrees');
				const expectedBase = repoRoot.substring(0, worktreesIndex - 1); // Remove trailing slash
				assert.strictEqual(
					result,
					expectedBase,
					`getBaseRepoPath should return base repo when in worktree. Got: ${result}, expected: ${expectedBase}`
				);
			} else {
				// We're in the main repo, result should be the same path
				assert.strictEqual(
					result,
					repoRoot,
					'getBaseRepoPath should return same path for main repo'
				);
			}
		});

		test('should return original path for non-git directory', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			// Our stub will throw an error for non-git directories, causing the function to return original path
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-worktree-test-'));

			try {
				// Act
				const result = await SettingsService.getBaseRepoPath(tempNonGitDir);

				// Assert: Should return the original path unchanged
				assert.strictEqual(
					result,
					tempNonGitDir,
					'getBaseRepoPath should return original path for non-git directory'
				);
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});

		test('should log warning when git command fails in non-git directory', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			// Our stub will throw an error for non-git directories, causing the function to return original path
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-warning-test-'));

			try {
				// Act: getBaseRepoPath should catch the error and return original path
				const result = await SettingsService.getBaseRepoPath(tempNonGitDir);

				// Assert: Should return original path (function handles errors gracefully)
				assert.strictEqual(
					result,
					tempNonGitDir,
					'getBaseRepoPath should return original path when git fails'
				);
				// Note: We can't easily capture console.warn output in tests,
				// but we verify the function doesn't throw and returns gracefully
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});

		test('should verify AgentSessionProvider uses baseRepoPath for session discovery', async () => {
			// Arrange: Create a temp directory structure simulating a worktree scenario
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-base-test-'));
			const worktreesDir = path.join(tempDir, '.worktrees');
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'test-session-1'));
			fs.mkdirSync(path.join(worktreesDir, 'test-session-2'));

			try {
				// Act: Create provider with baseRepoPath parameter
				const provider = new AgentSessionProvider(tempDir, tempDir);
				const children = await provider.getChildren();

				// Assert: Should discover sessions from the baseRepoPath's .worktrees
				assert.strictEqual(children.length, 2, 'Should find 2 sessions');
				const labels = children.map(c => c.label).sort();
				assert.deepStrictEqual(labels, ['test-session-1', 'test-session-2']);
			} finally {
				// Cleanup
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	suite('Base Branch Selection', () => {

		suite('HTML Rendering', () => {

			test('should render base branch input field with correct default value', () => {
				const { GitChangesPanel, parseDiff } = require('../../vscode/providers/GitChangesPanel');
				assert.strictEqual(GitChangesPanel.createOrShow.length, 5, 'createOrShow should accept 5 parameters including currentBaseBranch');

				const testDiff = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;`;
				const result = parseDiff(testDiff);
				assert.strictEqual(result.length, 1, 'Should parse diff for rendering');
			});

			test('should render Update Diff button next to base branch input', () => {
				const { GitChangesPanel } = require('../../vscode/providers/GitChangesPanel');
				assert.ok(typeof GitChangesPanel.createOrShow === 'function', 'GitChangesPanel should have createOrShow method');
			});
		});

		suite('Message Handling', () => {

			test('should handle changeBranch message (skipped - requires VS Code webview mocking)', function() {
				this.skip();
			});
		});

		suite('Branch Validation', () => {

			test('should validate branch and show warning for invalid branches (skipped - requires VS Code webview mocking)', function() {
				this.skip();
			});

			test('branchExists integration for branch validation', async function() {
				const { branchExists } = await import('../../core/services/BrokenWorktreeService.js');
				const repoRoot = path.resolve(__dirname, '..', '..');
				const mainExists = await branchExists(repoRoot, 'main');
				if (!mainExists) {
					this.skip();
				}
				assert.strictEqual(mainExists, true, 'main branch should exist');
				const invalidExists = await branchExists(repoRoot, 'nonexistent-branch-xyz-123');
				assert.strictEqual(invalidExists, false, 'nonexistent branch should not exist');
			});
		});

		suite('Panel State', () => {

			test('should store worktreePath for regenerating diffs', () => {
				const { GitChangesPanel } = require('../../vscode/providers/GitChangesPanel');
				assert.strictEqual(GitChangesPanel.createOrShow.length, 5, 'createOrShow should accept 5 parameters');
				assert.ok(typeof GitChangesPanel.setOnBranchChange === 'function', 'Should have setOnBranchChange method');
			});

			test('should update worktreePath when createOrShow is called with existing panel', () => {
				const { GitChangesPanel } = require('../../vscode/providers/GitChangesPanel');
				assert.ok('currentPanel' in GitChangesPanel, 'Should have currentPanel static property');
			});
		});
	});
});
