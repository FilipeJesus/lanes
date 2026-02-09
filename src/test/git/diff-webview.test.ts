import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import * as gitService from '../../gitService';
import { parseDiff, GitChangesPanel, FileDiff } from '../../GitChangesPanel';

suite('Git Diff Webview Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;
	let execGitStub: sinon.SinonStub;
	let originalExecGit: typeof gitService.execGit;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-git-webview-test-'));
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

	suite('Git Changes Webview', () => {

		test('should verify GitChangesPanel has createOrShow static method', () => {
			// Assert: GitChangesPanel has createOrShow as a function
			assert.ok(
				typeof GitChangesPanel.createOrShow === 'function',
				'GitChangesPanel should export createOrShow static method'
			);

			// Assert: createOrShow accepts 5 parameters (extensionUri, sessionName, diffContent, worktreePath?, currentBaseBranch?)
			// Function.length returns the number of expected parameters (including optional ones)
			assert.strictEqual(
				GitChangesPanel.createOrShow.length,
				5,
				'createOrShow should accept 5 parameters: extensionUri, sessionName, diffContent, worktreePath?, currentBaseBranch?'
			);
		});

		test('should verify GitChangesPanel has viewType static property', () => {
			assert.strictEqual(
				GitChangesPanel.viewType,
				'gitChangesPanel',
				'GitChangesPanel.viewType should be "gitChangesPanel"'
			);
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
});
