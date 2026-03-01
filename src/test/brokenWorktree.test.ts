import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import * as coreGitService from '../core/gitService';
import { detectBrokenWorktrees, repairWorktree } from '../core/services/BrokenWorktreeService';
import type { BrokenWorktree } from '../core/services/BrokenWorktreeService';

suite('Broken Worktree Detection', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-broken-worktree-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		fs.mkdirSync(worktreesDir, { recursive: true });

		// Disable global storage for these tests since we're testing worktree-based file paths
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);
	});

	// Clean up after each test
	teardown(async () => {
		// Reset useGlobalStorage to default
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('should identify worktree with .git file pointing to non-existent metadata directory', async () => {
		// Arrange: Create a worktree directory with a .git file pointing to a non-existent path
		const sessionName = 'broken-session';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Create a .git file with a gitdir reference to a non-existent metadata directory
		const nonExistentMetadataPath = path.join(tempDir, '.git', 'worktrees', sessionName);
		const gitFileContent = `gitdir: ${nonExistentMetadataPath}\n`;
		fs.writeFileSync(path.join(worktreePath, '.git'), gitFileContent);

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should find the broken worktree
		assert.strictEqual(brokenWorktrees.length, 1, 'Should detect one broken worktree');
		assert.strictEqual(brokenWorktrees[0].path, worktreePath, 'Should have correct path');
		assert.strictEqual(brokenWorktrees[0].sessionName, sessionName, 'Should have correct sessionName');
		assert.strictEqual(brokenWorktrees[0].expectedBranch, sessionName, 'Should have correct expectedBranch');
	});

	test('should ignore healthy worktrees where metadata directory exists', async () => {
		// Arrange: Create a worktree directory with a .git file pointing to an existing metadata directory
		const sessionName = 'healthy-session';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Create the metadata directory that the .git file will point to
		const metadataPath = path.join(tempDir, '.git', 'worktrees', sessionName);
		fs.mkdirSync(metadataPath, { recursive: true });

		// Create a .git file pointing to the existing metadata directory
		const gitFileContent = `gitdir: ${metadataPath}\n`;
		fs.writeFileSync(path.join(worktreePath, '.git'), gitFileContent);

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should not find any broken worktrees
		assert.strictEqual(brokenWorktrees.length, 0, 'Should not detect healthy worktree as broken');
	});

	test('should ignore directories without .git file', async () => {
		// Arrange: Create a directory without a .git file
		const sessionName = 'no-git-file';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Create some files but no .git file
		fs.writeFileSync(path.join(worktreePath, 'README.md'), '# Test');

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should not find any broken worktrees
		assert.strictEqual(brokenWorktrees.length, 0, 'Should ignore directories without .git file');
	});

	test('should ignore directories with .git directory (not file)', async () => {
		// Arrange: Create a directory with a .git directory (full repo, not worktree)
		const sessionName = 'full-repo';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Create a .git directory instead of file
		const gitDir = path.join(worktreePath, '.git');
		fs.mkdirSync(gitDir, { recursive: true });
		fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should not find any broken worktrees (it's a full repo, not a worktree)
		assert.strictEqual(brokenWorktrees.length, 0, 'Should ignore directories with .git directory');
	});

	test('should detect multiple broken worktrees', async () => {
		// Arrange: Create multiple broken worktrees
		const sessionNames = ['broken-1', 'broken-2', 'broken-3'];

		for (const sessionName of sessionNames) {
			const worktreePath = path.join(worktreesDir, sessionName);
			fs.mkdirSync(worktreePath, { recursive: true });

			const nonExistentMetadataPath = path.join(tempDir, '.git', 'worktrees', sessionName);
			const gitFileContent = `gitdir: ${nonExistentMetadataPath}\n`;
			fs.writeFileSync(path.join(worktreePath, '.git'), gitFileContent);
		}

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should find all broken worktrees
		assert.strictEqual(brokenWorktrees.length, 3, 'Should detect all broken worktrees');
		const detectedNames = brokenWorktrees.map(w => w.sessionName).sort();
		assert.deepStrictEqual(detectedNames, sessionNames.sort(), 'Should detect all session names');
	});

	test('should return empty array when .worktrees directory does not exist', async () => {
		// Arrange: Remove the .worktrees directory
		fs.rmSync(worktreesDir, { recursive: true, force: true });

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should return empty array
		assert.strictEqual(brokenWorktrees.length, 0, 'Should return empty array when .worktrees does not exist');
	});

	test('should handle mixed healthy and broken worktrees', async () => {
		// Arrange: Create a mix of healthy and broken worktrees
		// Broken worktree
		const brokenSession = 'broken-session';
		const brokenPath = path.join(worktreesDir, brokenSession);
		fs.mkdirSync(brokenPath, { recursive: true });
		const nonExistentMetadataPath = path.join(tempDir, '.git', 'worktrees', brokenSession);
		fs.writeFileSync(path.join(brokenPath, '.git'), `gitdir: ${nonExistentMetadataPath}\n`);

		// Healthy worktree
		const healthySession = 'healthy-session';
		const healthyPath = path.join(worktreesDir, healthySession);
		fs.mkdirSync(healthyPath, { recursive: true });
		const existingMetadataPath = path.join(tempDir, '.git', 'worktrees', healthySession);
		fs.mkdirSync(existingMetadataPath, { recursive: true });
		fs.writeFileSync(path.join(healthyPath, '.git'), `gitdir: ${existingMetadataPath}\n`);

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should only find the broken worktree
		assert.strictEqual(brokenWorktrees.length, 1, 'Should only detect broken worktree');
		assert.strictEqual(brokenWorktrees[0].sessionName, brokenSession, 'Should detect correct broken session');
	});

	test('should handle .git file without gitdir reference', async () => {
		// Arrange: Create a directory with a .git file that doesn't have gitdir reference
		const sessionName = 'malformed-git-file';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Create a .git file with invalid content
		fs.writeFileSync(path.join(worktreePath, '.git'), 'invalid content without gitdir\n');

		// Act: Detect broken worktrees
		const brokenWorktrees = await detectBrokenWorktrees(tempDir, '.worktrees');

		// Assert: Should not detect as broken (can't determine if it's broken without valid gitdir)
		assert.strictEqual(brokenWorktrees.length, 0, 'Should ignore .git files without gitdir reference');
	});
});

suite('Broken Worktree Repair', () => {

	let tempDir: string;
	let worktreesDir: string;
	let isRealGitRepo: boolean = false;
	let execGitStub: sinon.SinonStub;
	let originalExecGit: typeof coreGitService.execGit;
	let branchesThatExist: Set<string> = new Set();
	let repairedWorktrees: Array<{ worktreePath: string; branch: string }> = [];
	let savedGitDir: string | undefined;
	let savedGitWorkTree: string | undefined;
	let savedGitIndexFile: string | undefined;

	// Create a real git repository for integration tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-repair-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');

		// Clear GIT_DIR and GIT_WORK_TREE from the environment.
		// When tests run inside a git hook (e.g., pre-commit), these env vars
		// are inherited and point to the parent repo. Without clearing them,
		// real git commands (init, config, add, commit) would target the parent
		// repo instead of tempDir, contaminating its config and creating commits
		// that delete all tracked files.
		savedGitDir = process.env.GIT_DIR;
		savedGitWorkTree = process.env.GIT_WORK_TREE;
		savedGitIndexFile = process.env.GIT_INDEX_FILE;
		delete process.env.GIT_DIR;
		delete process.env.GIT_WORK_TREE;
		delete process.env.GIT_INDEX_FILE;

		// Disable global storage for these tests
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

		// Reset test state
		branchesThatExist = new Set();
		repairedWorktrees = [];

		// Save original execGit before stubbing
		originalExecGit = coreGitService.execGit.bind(coreGitService);

		// Try to initialize a real git repository for integration tests
		try {
			// Initialize git repo first (this creates the .git directory)
			await originalExecGit(['init'], tempDir);
			// Configure git for the test repo
			await originalExecGit(['config', 'user.email', 'test@test.com'], tempDir);
			await originalExecGit(['config', 'user.name', 'Test User'], tempDir);
			// Create an initial commit (required for worktrees)
			fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo');
			await originalExecGit(['add', '.'], tempDir);
			await originalExecGit(['commit', '-m', 'Initial commit'], tempDir);
			isRealGitRepo = true;
		} catch {
			// Git not available - skip integration tests
			isRealGitRepo = false;
		}

		// Set up git stubs for mocking AFTER real git repo is created
		execGitStub = sinon.stub(coreGitService, 'execGit');

		// Configure stub behavior for different git commands
		execGitStub.callsFake(async (args: string[], cwd: string, options?: coreGitService.ExecGitOptions) => {
			// Mock branch existence check (git show-ref --verify --quiet)
			if (args.includes('show-ref') && args.includes('--verify') && args.includes('--quiet')) {
				const branchArg = args.find(a => a.startsWith('refs/heads/'));
				if (branchArg) {
					const branchName = branchArg.replace('refs/heads/', '');
					if (branchesThatExist.has(branchName)) {
						return ''; // Success
					}
				}
				throw new Error(`branch does not exist`);
			}

			// Mock worktree add command
			if (args[0] === 'worktree' && args[1] === 'add') {
				const worktreePath = args[2];
				const branch = args[3];

				// Create worktree directory structure
				fs.mkdirSync(worktreePath, { recursive: true });

				// Create .git file pointing to metadata
				const metadataPath = path.join(cwd, '.git', 'worktrees', path.basename(worktreePath));
				fs.mkdirSync(metadataPath, { recursive: true });

				// Create gitdir file
				fs.writeFileSync(path.join(metadataPath, 'gitdir'), metadataPath);
				fs.writeFileSync(path.join(metadataPath, 'HEAD'), `ref: refs/heads/${branch}`);
				fs.writeFileSync(path.join(metadataPath, 'commondir'), path.join(cwd, '.git'));

				// Create .git file in worktree
				fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${metadataPath}\n`);

				// Track repair for test assertions
				repairedWorktrees.push({ worktreePath, branch });

				return '';
			}

			// For other commands, use real git
			return await originalExecGit(args, cwd, options);
		});
	});

	// Clean up after each test
	teardown(async () => {
		// Restore GIT_DIR, GIT_WORK_TREE, and GIT_INDEX_FILE env vars
		if (savedGitDir !== undefined) {
			process.env.GIT_DIR = savedGitDir;
		}
		if (savedGitWorkTree !== undefined) {
			process.env.GIT_WORK_TREE = savedGitWorkTree;
		}
		if (savedGitIndexFile !== undefined) {
			process.env.GIT_INDEX_FILE = savedGitIndexFile;
		}

		// Reset useGlobalStorage to default
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

		// Restore stubs
		if (execGitStub) {
			execGitStub.restore();
		}

		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('should successfully repair a broken worktree when the branch exists (mocked)', async function() {
		// Skip if git is not available
		if (!isRealGitRepo) {
			this.skip();
			return;
		}

		// Arrange: Create a broken worktree scenario
		const sessionName = 'repair-test-branch';
		const worktreePath = path.join(worktreesDir, sessionName);

		// Add the branch to the set of existing branches (our mock)
		branchesThatExist.add(sessionName);
		fs.mkdirSync(worktreesDir, { recursive: true });

		// Create a worktree directory with .git file pointing to non-existent metadata
		const nonExistentMetadataPath = path.join(tempDir, '.git', 'worktrees', sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });
		fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${nonExistentMetadataPath}\n`);

		// Create a test file in the worktree (should be preserved after repair)
		const testFilePath = path.join(worktreePath, 'test-file.txt');
		const testFileContent = 'This file should be preserved';
		fs.writeFileSync(testFilePath, testFileContent);

		// Verify it's detected as broken
		const brokenBefore = await detectBrokenWorktrees(tempDir, '.worktrees');
		assert.strictEqual(brokenBefore.length, 1, 'Worktree should be detected as broken');

		// Act: Repair the worktree
		const brokenWorktree: BrokenWorktree = {
			path: worktreePath,
			sessionName: sessionName,
			expectedBranch: sessionName
		};
		const result = await repairWorktree(tempDir, brokenWorktree);

		// Assert: Repair should succeed
		assert.strictEqual(result.success, true, `Repair should succeed. Error: ${result.error}`);
		assert.strictEqual(result.error, undefined, 'Should not have error message');

		// Verify worktree is no longer broken
		const brokenAfter = await detectBrokenWorktrees(tempDir, '.worktrees');
		assert.strictEqual(brokenAfter.length, 0, 'Worktree should no longer be broken');

		// Verify repair was tracked by our mock
		assert.strictEqual(repairedWorktrees.length, 1, 'Should have repaired one worktree');
		assert.strictEqual(repairedWorktrees[0].worktreePath, worktreePath, 'Should have repaired correct worktree');
		assert.strictEqual(repairedWorktrees[0].branch, sessionName, 'Should have used correct branch');
	});

	test('should fail gracefully when the branch does not exist', async function() {
		// Skip if git is not available
		if (!isRealGitRepo) {
			this.skip();
			return;
		}

		// Arrange: Create a mock broken worktree referencing a non-existent branch
		const sessionName = 'non-existent-branch';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Create a .git file pointing to non-existent metadata
		const nonExistentMetadataPath = path.join(tempDir, '.git', 'worktrees', sessionName);
		fs.writeFileSync(path.join(worktreePath, '.git'), `gitdir: ${nonExistentMetadataPath}\n`);

		// Act: Try to repair the worktree
		const brokenWorktree: BrokenWorktree = {
			path: worktreePath,
			sessionName: sessionName,
			expectedBranch: sessionName // Branch does not exist
		};
		const result = await repairWorktree(tempDir, brokenWorktree);

		// Assert: Repair should fail with appropriate error
		assert.strictEqual(result.success, false, 'Repair should fail for non-existent branch');
		assert.ok(result.error, 'Should have an error message');
		assert.ok(
			result.error.includes('does not exist') || result.error.includes(sessionName),
			'Error should mention the branch does not exist'
		);
	});

	test('should succeed when repairing directory without .git file if branch exists (mocked)', async function() {
		// Skip if git is not available
		if (!isRealGitRepo) {
			this.skip();
			return;
		}

		// Arrange: Create a branch and a directory without .git file
		// This simulates a directory that was partially cleaned up or created incorrectly
		const sessionName = 'missing-git-file-branch';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Add the branch to the set of existing branches (our mock)
		branchesThatExist.add(sessionName);

		// Create a test file (should be preserved)
		const testFilePath = path.join(worktreePath, 'untracked-file.txt');
		const testContent = 'This untracked file should be preserved';
		fs.writeFileSync(testFilePath, testContent);

		// Act: Try to repair
		const brokenWorktree: BrokenWorktree = {
			path: worktreePath,
			sessionName: sessionName,
			expectedBranch: sessionName
		};
		const result = await repairWorktree(tempDir, brokenWorktree);

		// Assert: Repair should succeed - the implementation renames and recreates
		assert.strictEqual(result.success, true, `Repair should succeed. Error: ${result.error}`);

		// Verify the worktree is now valid
		assert.ok(fs.existsSync(path.join(worktreePath, '.git')), '.git file should now exist');

		// Verify repair was tracked by our mock
		assert.strictEqual(repairedWorktrees.length, 1, 'Should have repaired one worktree');
		assert.strictEqual(repairedWorktrees[0].branch, sessionName, 'Should have used correct branch');
	});
});
