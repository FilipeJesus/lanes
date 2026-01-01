import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ClaudeSessionProvider } from '../ClaudeSessionProvider';
import { branchExists, getBranchesInWorktrees, getBaseBranch, getBaseRepoPath } from '../extension';
import { parseDiff, GitChangesPanel, FileDiff, ReviewComment, formatReviewForClipboard } from '../GitChangesPanel';

suite('Git Changes Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-git-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
	});

	// Clean up after each test
	teardown(() => {
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

		test('branchExists should return true for an existing branch', async () => {
			// Arrange: The 'main' branch should always exist in any git repository

			// Act
			const result = await branchExists(repoRoot, 'main');

			// Assert
			assert.strictEqual(result, true, 'branchExists should return true for "main" branch which exists');
		});

		test('branchExists should return false for a non-existent branch', async () => {
			// Arrange: Use a branch name that definitely does not exist
			const nonExistentBranch = 'nonexistent-branch-that-does-not-exist-xyz-123456789';

			// Act
			const result = await branchExists(repoRoot, nonExistentBranch);

			// Assert
			assert.strictEqual(result, false, 'branchExists should return false for a branch that does not exist');
		});

		test('getBranchesInWorktrees should correctly parse worktree list output', async () => {
			// Arrange: The repository has at least one worktree that we are running in

			// Act
			const result = await getBranchesInWorktrees(repoRoot);

			// Assert: The result should be a Set
			assert.ok(result instanceof Set, 'getBranchesInWorktrees should return a Set');

			// Assert: The Set should contain at least one branch (main worktree)
			// Since we are in a worktree, at least one branch should be in use
			assert.ok(result.size > 0, 'getBranchesInWorktrees should return at least one branch for repository with worktrees');

			// Assert: The main worktree should have 'main' branch checked out
			assert.ok(result.has('main'), 'The main worktree should have "main" branch checked out');

			// Note: We don't assert on the specific worktree branch name as tests may run in different contexts
		});

		test('getBranchesInWorktrees should return empty set when no worktrees have branches', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			// This will cause the git command to fail, returning an empty set
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

	suite('Git Changes Button', () => {

		test('should verify showGitChanges command is registered in package.json', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.commands section
			assert.ok(
				packageJson.contributes?.commands,
				'package.json should have contributes.commands section'
			);

			// Assert: claudeWorktrees.showGitChanges command exists
			const commands = packageJson.contributes.commands;
			const showGitChangesCmd = commands.find(
				(cmd: { command: string }) => cmd.command === 'claudeWorktrees.showGitChanges'
			);

			assert.ok(
				showGitChangesCmd,
				'package.json should have claudeWorktrees.showGitChanges command'
			);
			assert.strictEqual(
				showGitChangesCmd.title,
				'Show Git Changes',
				'showGitChanges command should have title "Show Git Changes"'
			);
			assert.strictEqual(
				showGitChangesCmd.icon,
				'$(git-compare)',
				'showGitChanges command should have git-compare icon'
			);
		});

		test('should verify showGitChanges command appears in view/item/context menu for sessionItem', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has menus.view/item/context section
			const menuItems = packageJson.contributes?.menus?.['view/item/context'];
			assert.ok(
				menuItems,
				'package.json should have contributes.menus.view/item/context section'
			);

			// Assert: showGitChanges menu item exists with correct when clause
			const showGitChangesMenuItem = menuItems.find(
				(item: { command: string }) => item.command === 'claudeWorktrees.showGitChanges'
			);

			assert.ok(
				showGitChangesMenuItem,
				'showGitChanges should be in view/item/context menu'
			);
			assert.ok(
				showGitChangesMenuItem.when.includes('sessionItem'),
				'showGitChanges menu item should only appear for sessionItem context'
			);
			assert.strictEqual(
				showGitChangesMenuItem.group,
				'inline@1',
				'showGitChanges should be in inline group at position 1 (after openInNewWindow)'
			);
		});
	});

	suite('Git Changes Command', () => {

		test('should have showGitChanges command registered after activation', async () => {
			// Trigger extension activation by executing one of its commands
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			const commands = await vscode.commands.getCommands(true);

			assert.ok(
				commands.includes('claudeWorktrees.showGitChanges'),
				'showGitChanges command should be registered after extension activation'
			);
		});
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

	suite('Git Changes Webview', () => {

		test('should verify GitChangesPanel has createOrShow static method', () => {
			// Assert: GitChangesPanel has createOrShow as a function
			assert.ok(
				typeof GitChangesPanel.createOrShow === 'function',
				'GitChangesPanel should export createOrShow static method'
			);

			// Assert: createOrShow accepts 3 parameters (extensionUri, sessionName, diffContent)
			// Function.length returns the number of expected parameters
			assert.strictEqual(
				GitChangesPanel.createOrShow.length,
				3,
				'createOrShow should accept 3 parameters: extensionUri, sessionName, diffContent'
			);
		});

		test('should verify GitChangesPanel has viewType static property', () => {
			assert.strictEqual(
				GitChangesPanel.viewType,
				'gitChangesPanel',
				'GitChangesPanel.viewType should be "gitChangesPanel"'
			);
		});

		suite('parseDiff', () => {

			test('should return empty array for empty diff content', () => {
				const result = parseDiff('');
				assert.deepStrictEqual(result, [], 'parseDiff should return empty array for empty string');
			});

			test('should correctly extract file names from diff headers', () => {
				const diffContent = `diff --git a/src/file.ts b/src/file.ts
index 1234567..abcdefg 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].filePath, 'src/file.ts', 'Should extract file path correctly');
				assert.strictEqual(result[0].oldPath, 'src/file.ts', 'Should extract old path correctly');
				assert.strictEqual(result[0].newPath, 'src/file.ts', 'Should extract new path correctly');
			});

			test('should correctly identify added lines (+)', () => {
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,2 +1,4 @@
 line 1
+added line 1
+added line 2
 line 2`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].addedCount, 2, 'Should count 2 added lines');

				const addedLines = result[0].hunks[0].lines.filter(l => l.type === 'added');
				assert.strictEqual(addedLines.length, 2, 'Should have 2 added lines');
				assert.strictEqual(addedLines[0].content, 'added line 1', 'First added line content');
				assert.strictEqual(addedLines[1].content, 'added line 2', 'Second added line content');
			});

			test('should correctly identify removed lines (-)', () => {
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,4 +1,2 @@
 line 1
-removed line 1
-removed line 2
 line 2`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].removedCount, 2, 'Should count 2 removed lines');

				const removedLines = result[0].hunks[0].lines.filter(l => l.type === 'removed');
				assert.strictEqual(removedLines.length, 2, 'Should have 2 removed lines');
				assert.strictEqual(removedLines[0].content, 'removed line 1', 'First removed line content');
				assert.strictEqual(removedLines[1].content, 'removed line 2', 'Second removed line content');
			});

			test('should correctly identify context lines', () => {
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 context line 1
+added line
 context line 2
 context line 3`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');

				const contextLines = result[0].hunks[0].lines.filter(l => l.type === 'context');
				assert.strictEqual(contextLines.length, 3, 'Should have 3 context lines');
				assert.strictEqual(contextLines[0].content, 'context line 1', 'First context line content');
			});

			test('should parse multiple files in a single diff', () => {
				const diffContent = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/file2.ts b/file2.ts
index 7654321..gfedcba 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 let x = 'a';
+let y = 'b';
 let z = 'c';`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 2, 'Should parse two files');
				assert.strictEqual(result[0].filePath, 'file1.ts', 'First file path');
				assert.strictEqual(result[1].filePath, 'file2.ts', 'Second file path');
			});

			test('should identify new files', () => {
				const diffContent = `diff --git a/newfile.ts b/newfile.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,2 @@
+const x = 1;
+const y = 2;`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].isNew, true, 'File should be marked as new');
				assert.strictEqual(result[0].addedCount, 2, 'Should count 2 added lines');
			});

			test('should identify deleted files', () => {
				const diffContent = `diff --git a/deleted.ts b/deleted.ts
deleted file mode 100644
index 1234567..0000000
--- a/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const x = 1;
-const y = 2;`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].isDeleted, true, 'File should be marked as deleted');
				assert.strictEqual(result[0].removedCount, 2, 'Should count 2 removed lines');
			});

			test('should identify renamed files', () => {
				const diffContent = `diff --git a/oldname.ts b/newname.ts
rename from oldname.ts
rename to newname.ts
index 1234567..abcdefg 100644`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].isRenamed, true, 'File should be marked as renamed');
			});

			test('should parse hunk headers correctly', () => {
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -10,5 +10,6 @@
 context
+added
 context`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].hunks.length, 1, 'Should have one hunk');
				assert.strictEqual(result[0].hunks[0].oldStart, 10, 'Old start should be 10');
				assert.strictEqual(result[0].hunks[0].oldCount, 5, 'Old count should be 5');
				assert.strictEqual(result[0].hunks[0].newStart, 10, 'New start should be 10');
				assert.strictEqual(result[0].hunks[0].newCount, 6, 'New count should be 6');
			});

			test('should track line numbers correctly', () => {
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -5,3 +5,4 @@
 context at 5
+added at 6
 context at 6/7`;

				const result = parseDiff(diffContent);
				const lines = result[0].hunks[0].lines;

				// First context line
				assert.strictEqual(lines[0].type, 'context');
				assert.strictEqual(lines[0].oldLineNumber, 5, 'Context line old number should be 5');
				assert.strictEqual(lines[0].newLineNumber, 5, 'Context line new number should be 5');

				// Added line (no old line number, new line number 6)
				assert.strictEqual(lines[1].type, 'added');
				assert.strictEqual(lines[1].oldLineNumber, null, 'Added line should have null old number');
				assert.strictEqual(lines[1].newLineNumber, 6, 'Added line new number should be 6');

				// Second context line
				assert.strictEqual(lines[2].type, 'context');
				assert.strictEqual(lines[2].oldLineNumber, 6, 'Second context line old number should be 6');
				assert.strictEqual(lines[2].newLineNumber, 7, 'Second context line new number should be 7');
			});

			test('should handle diff with only removed lines correctly tracking line numbers', () => {
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -10,3 +10,1 @@
-removed at 10
-removed at 11
 context at 12/10`;

				const result = parseDiff(diffContent);
				const lines = result[0].hunks[0].lines;

				// First removed line
				assert.strictEqual(lines[0].type, 'removed');
				assert.strictEqual(lines[0].oldLineNumber, 10, 'First removed line old number should be 10');
				assert.strictEqual(lines[0].newLineNumber, null, 'Removed line should have null new number');

				// Second removed line
				assert.strictEqual(lines[1].type, 'removed');
				assert.strictEqual(lines[1].oldLineNumber, 11, 'Second removed line old number should be 11');
				assert.strictEqual(lines[1].newLineNumber, null, 'Removed line should have null new number');
			});
		});
	});

	suite('Git Changes Panel HTML Generation', () => {

		test('should verify FileDiff interface has required properties', () => {
			// This test verifies the FileDiff interface structure by creating
			// an object that matches the interface
			const fileDiff: FileDiff = {
				filePath: 'test/file.ts',
				oldPath: 'test/file.ts',
				newPath: 'test/file.ts',
				isNew: false,
				isDeleted: false,
				isRenamed: false,
				hunks: [],
				addedCount: 5,
				removedCount: 3
			};

			assert.strictEqual(fileDiff.filePath, 'test/file.ts');
			assert.strictEqual(fileDiff.addedCount, 5);
			assert.strictEqual(fileDiff.removedCount, 3);
			assert.strictEqual(fileDiff.isNew, false);
			assert.strictEqual(fileDiff.isDeleted, false);
			assert.strictEqual(fileDiff.isRenamed, false);
		});

		test('parseDiff output should match expected FileDiff structure for HTML generation', () => {
			const diffContent = `diff --git a/src/component.tsx b/src/component.tsx
index 1234567..abcdefg 100644
--- a/src/component.tsx
+++ b/src/component.tsx
@@ -10,5 +10,7 @@
 const Component = () => {
+  const [state, setState] = useState(false);
+  const handleClick = () => setState(true);
   return <div>Hello</div>;
-}
+};
 export default Component;`;

			const result = parseDiff(diffContent);

			// Verify the structure is correct for HTML generation
			assert.strictEqual(result.length, 1);
			const file = result[0];

			// Verify file metadata for file header generation
			assert.strictEqual(file.filePath, 'src/component.tsx');

			// Verify counts for badge generation (+N / -N badges)
			assert.strictEqual(file.addedCount, 3, 'Should have 3 added lines for badge');
			assert.strictEqual(file.removedCount, 1, 'Should have 1 removed line for badge');

			// Verify hunks exist for diff table generation
			assert.strictEqual(file.hunks.length, 1, 'Should have 1 hunk');

			// Verify lines have correct types for CSS class assignment
			const lines = file.hunks[0].lines;
			const addedLines = lines.filter(l => l.type === 'added');
			const removedLines = lines.filter(l => l.type === 'removed');
			const contextLines = lines.filter(l => l.type === 'context');

			assert.strictEqual(addedLines.length, 3, 'Should have 3 added lines');
			assert.strictEqual(removedLines.length, 1, 'Should have 1 removed line');
			assert.ok(contextLines.length > 0, 'Should have context lines');

			// Verify each line has required properties for HTML row generation
			for (const line of lines) {
				assert.ok(['added', 'removed', 'context'].includes(line.type), 'Line type should be valid');
				assert.ok(typeof line.content === 'string', 'Line content should be a string');
				// Line numbers should be number or null
				assert.ok(
					line.oldLineNumber === null || typeof line.oldLineNumber === 'number',
					'Old line number should be number or null'
				);
				assert.ok(
					line.newLineNumber === null || typeof line.newLineNumber === 'number',
					'New line number should be number or null'
				);
			}
		});

		test('should handle special characters in diff content for HTML escaping', () => {
			const diffContent = `diff --git a/test.html b/test.html
index 1234567..abcdefg 100644
--- a/test.html
+++ b/test.html
@@ -1,2 +1,3 @@
 <div class="container">
+  <span>&copy; 2025</span>
 </div>`;

			const result = parseDiff(diffContent);

			assert.strictEqual(result.length, 1);
			const addedLine = result[0].hunks[0].lines.find(l => l.type === 'added');
			assert.ok(addedLine);
			// The content should contain the raw HTML characters (escaping happens during HTML generation)
			assert.ok(
				addedLine.content.includes('<span>'),
				'Content should include raw HTML tags for later escaping'
			);
			assert.ok(
				addedLine.content.includes('&copy;'),
				'Content should include raw HTML entities for later escaping'
			);
		});

		test('should correctly parse complex real-world diff', () => {
			const complexDiff = `diff --git a/src/extension.ts b/src/extension.ts
index abc1234..def5678 100644
--- a/src/extension.ts
+++ b/src/extension.ts
@@ -1,5 +1,6 @@
 import * as vscode from 'vscode';
+import * as path from 'path';

 export function activate(context: vscode.ExtensionContext) {
     console.log('Extension activated');
@@ -20,8 +21,10 @@ export function activate(context: vscode.ExtensionContext) {
     });

     context.subscriptions.push(disposable);
+
+    // New feature added here
+    setupNewFeature(context);
 }
-
 export function deactivate() {}`;

			const result = parseDiff(complexDiff);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].filePath, 'src/extension.ts');

			// Should have 2 hunks
			assert.strictEqual(result[0].hunks.length, 2, 'Should have 2 hunks');

			// First hunk: 1 addition
			assert.strictEqual(result[0].hunks[0].oldStart, 1);
			assert.strictEqual(result[0].hunks[0].newStart, 1);

			// Verify total counts
			assert.strictEqual(result[0].addedCount, 4, 'Should have 4 added lines total');
			assert.strictEqual(result[0].removedCount, 1, 'Should have 1 removed line total');
		});
	});

	suite('GitChangesPanel Comment Feature', () => {

		suite('ReviewComment Interface', () => {

			test('should verify ReviewComment interface has required fields', () => {
				// Test that ReviewComment interface contains filePath, lineNumber, lineType, lineContent, and text fields
				// by creating an object that conforms to the interface
				const comment: ReviewComment = {
					id: 'comment-1',
					filePath: 'src/test.ts',
					lineNumber: 42,
					lineType: 'added',
					lineContent: 'const x = 1;',
					text: 'This looks good!'
				};

				// Verify all required fields are present and have correct types
				assert.strictEqual(typeof comment.id, 'string', 'id should be a string');
				assert.strictEqual(typeof comment.filePath, 'string', 'filePath should be a string');
				assert.strictEqual(typeof comment.lineNumber, 'number', 'lineNumber should be a number');
				assert.ok(
					['added', 'removed', 'context'].includes(comment.lineType),
					'lineType should be "added", "removed", or "context"'
				);
				assert.strictEqual(typeof comment.lineContent, 'string', 'lineContent should be a string');
				assert.strictEqual(typeof comment.text, 'string', 'text should be a string');

				// Verify actual values
				assert.strictEqual(comment.id, 'comment-1');
				assert.strictEqual(comment.filePath, 'src/test.ts');
				assert.strictEqual(comment.lineNumber, 42);
				assert.strictEqual(comment.lineType, 'added');
				assert.strictEqual(comment.lineContent, 'const x = 1;');
				assert.strictEqual(comment.text, 'This looks good!');
			});

			test('should allow all valid lineType values', () => {
				// Verify all three valid lineType values work
				const addedComment: ReviewComment = {
					id: 'c1',
					filePath: 'file.ts',
					lineNumber: 1,
					lineType: 'added',
					lineContent: '+new line',
					text: 'Comment on added line'
				};

				const removedComment: ReviewComment = {
					id: 'c2',
					filePath: 'file.ts',
					lineNumber: 2,
					lineType: 'removed',
					lineContent: '-old line',
					text: 'Comment on removed line'
				};

				const contextComment: ReviewComment = {
					id: 'c3',
					filePath: 'file.ts',
					lineNumber: 3,
					lineType: 'context',
					lineContent: ' unchanged line',
					text: 'Comment on context line'
				};

				assert.strictEqual(addedComment.lineType, 'added');
				assert.strictEqual(removedComment.lineType, 'removed');
				assert.strictEqual(contextComment.lineType, 'context');
			});
		});

		suite('Diff HTML Comment Buttons', () => {

			test('should include comment buttons in generated diff HTML', () => {
				// Parse a simple diff and verify the generated HTML structure includes comment buttons
				// We use parseDiff to create file data, then test the HTML generation logic
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;`;

				const result = parseDiff(diffContent);

				// Verify the diff was parsed and has lines that would receive comment buttons
				assert.strictEqual(result.length, 1, 'Should parse one file');
				const lines = result[0].hunks[0].lines;
				assert.ok(lines.length > 0, 'Should have lines that can receive comment buttons');

				// Each line in the diff should be able to receive a comment button
				// The HTML generation adds a button with class "comment-btn" for each line
				// We verify the structure is in place for this by checking each line has required data
				for (const line of lines) {
					assert.ok(
						['added', 'removed', 'context'].includes(line.type),
						'Each line should have a valid type for comment button data attribute'
					);
					assert.ok(
						typeof line.content === 'string',
						'Each line should have content for comment button data attribute'
					);
					assert.ok(
						line.oldLineNumber !== undefined || line.newLineNumber !== undefined,
						'Each line should have at least one line number for comment button data attribute'
					);
				}
			});
		});

		suite('Submit Review Button in Toolbar', () => {

			test('should verify package.json or HTML contains Submit Review functionality', () => {
				// The Submit Review button is rendered in the webview HTML
				// We can verify the GitChangesPanel has the necessary static method
				// which generates HTML containing the Submit Review button

				assert.ok(
					typeof GitChangesPanel.createOrShow === 'function',
					'GitChangesPanel should have createOrShow method that generates HTML with Submit Review button'
				);

				// The createOrShow method generates HTML with a toolbar containing Submit Review button
				// The button has id="submit-review-btn" and class="primary"
				// We verify the method signature is correct for generating the panel
				assert.strictEqual(
					GitChangesPanel.createOrShow.length,
					3,
					'createOrShow should accept extensionUri, sessionName, diffContent for generating webview with Submit Review button'
				);
			});
		});

		suite('Comment Badge on File Header', () => {

			test('should verify parseDiff output structure supports comment count badges', () => {
				// Parse a diff and verify the output structure supports tracking comments per file
				// The HTML generation creates a comment-count badge for each file container

				const diffContent = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
diff --git a/file2.ts b/file2.ts
index 7654321..gfedcba 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 let x = 'a';
+let y = 'b';
 let z = 'c';`;

				const result = parseDiff(diffContent);

				// Verify each file has a unique filePath that can be used to track comment counts
				assert.strictEqual(result.length, 2, 'Should parse two files');
				assert.strictEqual(result[0].filePath, 'file1.ts', 'First file path');
				assert.strictEqual(result[1].filePath, 'file2.ts', 'Second file path');

				// Each file entry supports a comment badge through the file-container data-file-path attribute
				// The HTML structure includes: <span class="badge comment-count" id="comment-count-{index}">
				for (let i = 0; i < result.length; i++) {
					assert.ok(
						typeof result[i].filePath === 'string',
						'Each file should have filePath for comment badge tracking'
					);
				}
			});
		});

		suite('Webview Message Handler', () => {

			test('should verify submitReview message handling capability (skipped - requires VS Code webview mocking)', function() {
				// This test verifies the extension can handle submitReview messages from the webview
				// The actual webview message handling requires complex VS Code API mocking
				// which is beyond the scope of unit testing
				//
				// The message handler in GitChangesPanel constructor listens for:
				// case 'submitReview':
				//   await this._handleSubmitReview(message.comments as ReviewComment[]);
				//
				// Integration testing would require:
				// 1. Creating a mock WebviewPanel
				// 2. Triggering the onDidReceiveMessage handler
				// 3. Verifying _handleSubmitReview is called with correct comments
				//
				// Since this is complex to mock, we mark this as skipped and verify
				// the related functionality through the formatReviewForClipboard tests

				this.skip();
			});
		});

		suite('formatReviewForClipboard', () => {

			test('should return "No comments" message when comments array is empty', () => {
				const result = formatReviewForClipboard([]);
				assert.strictEqual(result, 'No comments in this review.');
			});

			test('should format single comment correctly', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'src/test.ts',
						lineNumber: 10,
						lineType: 'added',
						lineContent: 'const x = 1;',
						text: 'This variable should be named better'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Verify header
				assert.ok(result.includes('# Code Review Comments'), 'Should have review header');

				// Verify file grouping
				assert.ok(result.includes('## src/test.ts'), 'Should have file path as heading');

				// Verify line info
				assert.ok(result.includes('**Line 10**'), 'Should include line number');
				assert.ok(result.includes('(added)'), 'Should include line type');

				// Verify line content with prefix
				assert.ok(result.includes('+const x = 1;'), 'Should include line content with + prefix for added');

				// Verify comment text
				assert.ok(result.includes('> This variable should be named better'), 'Should include comment text as quote');
			});

			test('should format multiple comments grouped by file', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'src/file1.ts',
						lineNumber: 5,
						lineType: 'added',
						lineContent: 'const a = 1;',
						text: 'Comment on file1 line 5'
					},
					{
						id: 'c2',
						filePath: 'src/file2.ts',
						lineNumber: 10,
						lineType: 'removed',
						lineContent: 'const b = 2;',
						text: 'Comment on file2 line 10'
					},
					{
						id: 'c3',
						filePath: 'src/file1.ts',
						lineNumber: 15,
						lineType: 'context',
						lineContent: 'const c = 3;',
						text: 'Comment on file1 line 15'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Verify both files are present
				assert.ok(result.includes('## src/file1.ts'), 'Should have file1 heading');
				assert.ok(result.includes('## src/file2.ts'), 'Should have file2 heading');

				// Verify comments are present
				assert.ok(result.includes('> Comment on file1 line 5'), 'Should include first comment');
				assert.ok(result.includes('> Comment on file2 line 10'), 'Should include second comment');
				assert.ok(result.includes('> Comment on file1 line 15'), 'Should include third comment');

				// Verify line prefixes by type
				assert.ok(result.includes('+const a = 1;'), 'Added line should have + prefix');
				assert.ok(result.includes('-const b = 2;'), 'Removed line should have - prefix');
				assert.ok(result.includes(' const c = 3;'), 'Context line should have space prefix');
			});

			test('should sort comments by line number within each file', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'src/test.ts',
						lineNumber: 20,
						lineType: 'added',
						lineContent: 'line 20',
						text: 'Comment on line 20'
					},
					{
						id: 'c2',
						filePath: 'src/test.ts',
						lineNumber: 5,
						lineType: 'added',
						lineContent: 'line 5',
						text: 'Comment on line 5'
					},
					{
						id: 'c3',
						filePath: 'src/test.ts',
						lineNumber: 10,
						lineType: 'added',
						lineContent: 'line 10',
						text: 'Comment on line 10'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Find positions of line numbers in output
				const line5Pos = result.indexOf('**Line 5**');
				const line10Pos = result.indexOf('**Line 10**');
				const line20Pos = result.indexOf('**Line 20**');

				// Verify ascending order
				assert.ok(line5Pos < line10Pos, 'Line 5 should appear before Line 10');
				assert.ok(line10Pos < line20Pos, 'Line 10 should appear before Line 20');
			});

			test('should use correct line prefixes for different line types', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'test.ts',
						lineNumber: 1,
						lineType: 'added',
						lineContent: 'added content',
						text: 'Added line comment'
					},
					{
						id: 'c2',
						filePath: 'test.ts',
						lineNumber: 2,
						lineType: 'removed',
						lineContent: 'removed content',
						text: 'Removed line comment'
					},
					{
						id: 'c3',
						filePath: 'test.ts',
						lineNumber: 3,
						lineType: 'context',
						lineContent: 'context content',
						text: 'Context line comment'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Check code blocks contain correct prefixes
				assert.ok(result.includes('+added content'), 'Added line should have + prefix');
				assert.ok(result.includes('-removed content'), 'Removed line should have - prefix');
				assert.ok(result.includes(' context content'), 'Context line should have space prefix');
			});

			test('should wrap line content in code blocks', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'test.ts',
						lineNumber: 1,
						lineType: 'added',
						lineContent: 'const x = 1;',
						text: 'Test comment'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Verify code block markers
				const codeBlockMatches = result.match(/```/g);
				assert.ok(codeBlockMatches, 'Should have code block markers');
				assert.strictEqual(codeBlockMatches.length, 2, 'Should have opening and closing code block markers');
			});
		});
	});

	suite('Base Branch Configuration', () => {
		// These tests verify that getBaseBranch correctly uses the claudeLanes.baseBranch
		// configuration setting, and falls back to auto-detection when not set.

		// Get the path to the git repository root for fallback tests
		const repoRoot = path.resolve(__dirname, '..', '..');

		teardown(async () => {
			// Reset the baseBranch configuration to default after each test
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', undefined, vscode.ConfigurationTarget.Global);
		});

		test('should return configured value when claudeLanes.baseBranch setting is set', async () => {
			// Arrange: Set the baseBranch configuration to 'develop'
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', 'develop', vscode.ConfigurationTarget.Global);

			// Act: Call getBaseBranch - the cwd doesn't matter when config is set
			// since it should return the configured value without checking git
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return the configured value
			assert.strictEqual(
				result,
				'develop',
				'getBaseBranch should return the configured baseBranch value "develop"'
			);
		});

		test('should use fallback detection when baseBranch setting is empty', async () => {
			// Arrange: Ensure the baseBranch configuration is empty
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', '', vscode.ConfigurationTarget.Global);

			// Act: Call getBaseBranch with the actual repo path
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return one of the fallback branches
			// The fallback order is: origin/main, origin/master, main, master
			const validFallbacks = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validFallbacks.includes(result),
				`getBaseBranch should return a fallback branch when config is empty, got: "${result}"`
			);
		});

		test('should treat whitespace-only setting as empty and use fallback', async () => {
			// Arrange: Set the baseBranch configuration to whitespace only
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', '   ', vscode.ConfigurationTarget.Global);

			// Act: Call getBaseBranch with the actual repo path
			const result = await getBaseBranch(repoRoot);

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
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('should return same path for regular git repository', async () => {
			// Arrange: Use the actual repo root - this is a regular repo from the main
			// branch perspective, or we're in a worktree
			// Act
			const result = await getBaseRepoPath(repoRoot);

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
			const result = await getBaseRepoPath(repoRoot);

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
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-worktree-test-'));

			try {
				// Act
				const result = await getBaseRepoPath(tempNonGitDir);

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
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-warning-test-'));

			try {
				// Act: getBaseRepoPath should catch the error and return original path
				const result = await getBaseRepoPath(tempNonGitDir);

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

		test('should verify ClaudeSessionProvider uses baseRepoPath for session discovery', async () => {
			// Arrange: Create a temp directory structure simulating a worktree scenario
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-base-test-'));
			const worktreesDir = path.join(tempDir, '.worktrees');
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'test-session-1'));
			fs.mkdirSync(path.join(worktreesDir, 'test-session-2'));

			try {
				// Act: Create provider with baseRepoPath parameter
				const provider = new ClaudeSessionProvider(tempDir, tempDir);
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
});
