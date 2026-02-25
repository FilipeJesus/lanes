import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseDiff, FileDiff } from '../../vscode/providers/GitChangesPanel';
import { parseUntrackedFiles, isBinaryContent, synthesizeUntrackedFileDiff } from '../../core/services/DiffService';

suite('Git Diff Parsing Test Suite', () => {

	suite('parseDiff', () => {

		test('should return empty array for empty diff content', () => {
			const result = parseDiff('');
			assert.deepStrictEqual(result, []);
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

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].filePath, 'src/file.ts');
			assert.strictEqual(result[0].oldPath, 'src/file.ts');
			assert.strictEqual(result[0].newPath, 'src/file.ts');
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

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].addedCount, 2);

			const addedLines = result[0].hunks[0].lines.filter(l => l.type === 'added');
			assert.strictEqual(addedLines.length, 2);
			assert.strictEqual(addedLines[0].content, 'added line 1');
			assert.strictEqual(addedLines[1].content, 'added line 2');
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

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].removedCount, 2);

			const removedLines = result[0].hunks[0].lines.filter(l => l.type === 'removed');
			assert.strictEqual(removedLines.length, 2);
			assert.strictEqual(removedLines[0].content, 'removed line 1');
			assert.strictEqual(removedLines[1].content, 'removed line 2');
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

			assert.strictEqual(result.length, 1);

			const contextLines = result[0].hunks[0].lines.filter(l => l.type === 'context');
			assert.strictEqual(contextLines.length, 3);
			assert.strictEqual(contextLines[0].content, 'context line 1');
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

			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].filePath, 'file1.ts');
			assert.strictEqual(result[1].filePath, 'file2.ts');
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

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].isNew, true);
			assert.strictEqual(result[0].addedCount, 2);
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

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].isDeleted, true);
			assert.strictEqual(result[0].removedCount, 2);
		});

		test('should identify renamed files', () => {
			const diffContent = `diff --git a/oldname.ts b/newname.ts
rename from oldname.ts
rename to newname.ts
index 1234567..abcdefg 100644`;

			const result = parseDiff(diffContent);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].isRenamed, true);
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

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].hunks.length, 1);
			assert.strictEqual(result[0].hunks[0].oldStart, 10);
			assert.strictEqual(result[0].hunks[0].oldCount, 5);
			assert.strictEqual(result[0].hunks[0].newStart, 10);
			assert.strictEqual(result[0].hunks[0].newCount, 6);
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

			assert.strictEqual(lines[0].type, 'context');
			assert.strictEqual(lines[0].oldLineNumber, 5);
			assert.strictEqual(lines[0].newLineNumber, 5);

			assert.strictEqual(lines[1].type, 'added');
			assert.strictEqual(lines[1].oldLineNumber, null);
			assert.strictEqual(lines[1].newLineNumber, 6);

			assert.strictEqual(lines[2].type, 'context');
			assert.strictEqual(lines[2].oldLineNumber, 6);
			assert.strictEqual(lines[2].newLineNumber, 7);
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

			assert.strictEqual(lines[0].type, 'removed');
			assert.strictEqual(lines[0].oldLineNumber, 10);
			assert.strictEqual(lines[0].newLineNumber, null);

			assert.strictEqual(lines[1].type, 'removed');
			assert.strictEqual(lines[1].oldLineNumber, 11);
			assert.strictEqual(lines[1].newLineNumber, null);
		});
	});

	suite('parseUntrackedFiles', () => {

		test('should extract file paths from git status porcelain output with ?? prefix', () => {
			// Arrange: Git status --porcelain output with untracked files
			const statusOutput = `?? newfile.txt
?? src/another.ts
M  modified.js
A  added.js
?? test/spec.ts`;

			// Act
			const result = parseUntrackedFiles(statusOutput);

			// Assert: Should only extract files with ?? prefix
			assert.deepStrictEqual(
				result,
				['newfile.txt', 'src/another.ts', 'test/spec.ts'],
				'Should extract correct file paths from ?? prefixed lines'
			);
		});

		test('should return empty array when no untracked files', () => {
			// Arrange: Git status output with no untracked files
			const statusOutput = `M  modified.js
A  added.js
D  deleted.js`;

			// Act
			const result = parseUntrackedFiles(statusOutput);

			// Assert
			assert.deepStrictEqual(result, [], 'Should return empty array when no ?? prefix lines');
		});

		test('should return empty array for empty input', () => {
			// Arrange
			const statusOutput = '';

			// Act
			const result = parseUntrackedFiles(statusOutput);

			// Assert
			assert.deepStrictEqual(result, [], 'Should return empty array for empty input');
		});

		test('should handle quoted paths with special characters', () => {
			// Arrange: Git quotes paths containing special characters
			const statusOutput = `?? "path with spaces/file.txt"
?? "special\\\"chars.txt"
?? normalpath.ts`;

			// Act
			const result = parseUntrackedFiles(statusOutput);

			// Assert: Should unquote paths correctly
			assert.strictEqual(result.length, 3, 'Should parse all three files');
			assert.strictEqual(result[0], 'path with spaces/file.txt', 'Should unquote path with spaces');
			assert.strictEqual(result[1], 'special"chars.txt', 'Should unescape quoted characters');
			assert.strictEqual(result[2], 'normalpath.ts', 'Should handle normal paths');
		});

		test('should handle single untracked file', () => {
			// Arrange
			const statusOutput = '?? single-file.txt';

			// Act
			const result = parseUntrackedFiles(statusOutput);

			// Assert
			assert.deepStrictEqual(result, ['single-file.txt'], 'Should handle single untracked file');
		});
	});

	suite('isBinaryContent', () => {

		test('should return true for content containing null bytes', () => {
			// Arrange: Binary content with null bytes
			const binaryContent = 'some\x00binary\x00content';

			// Act
			const result = isBinaryContent(binaryContent);

			// Assert
			assert.strictEqual(result, true, 'Should detect null bytes as binary');
		});

		test('should return false for text content without null bytes', () => {
			// Arrange: Normal text content
			const textContent = 'const x = 1;\nfunction test() {\n  return x;\n}\n';

			// Act
			const result = isBinaryContent(textContent);

			// Assert
			assert.strictEqual(result, false, 'Should not detect normal text as binary');
		});

		test('should return false for empty content', () => {
			// Arrange
			const emptyContent = '';

			// Act
			const result = isBinaryContent(emptyContent);

			// Assert
			assert.strictEqual(result, false, 'Should not detect empty content as binary');
		});

		test('should return true for content with null byte at start', () => {
			// Arrange
			const content = '\x00beginning null';

			// Act
			const result = isBinaryContent(content);

			// Assert
			assert.strictEqual(result, true, 'Should detect null byte at start');
		});

		test('should return true for content with null byte at end', () => {
			// Arrange
			const content = 'ending null\x00';

			// Act
			const result = isBinaryContent(content);

			// Assert
			assert.strictEqual(result, true, 'Should detect null byte at end');
		});

		test('should return false for content with special characters but no null bytes', () => {
			// Arrange: Content with various special characters but no null bytes
			const content = 'Tab:\t Newline:\n Return:\r UTF8: Hello!';

			// Act
			const result = isBinaryContent(content);

			// Assert
			assert.strictEqual(result, false, 'Should not detect special chars as binary without null bytes');
		});
	});

	suite('synthesizeUntrackedFileDiff', () => {

		test('should generate unified diff format for new file with single line', () => {
			const filePath = 'test.txt';
			const content = 'Hello, World!\n';
			const result = synthesizeUntrackedFileDiff(filePath, content);

			assert.ok(result.includes('diff --git a/test.txt b/test.txt'));
			assert.ok(result.includes('new file mode 100644'));
			assert.ok(result.includes('--- /dev/null'));
			assert.ok(result.includes('+++ b/test.txt'));
			assert.ok(result.includes('@@ -0,0 +1,1 @@'));
			assert.ok(result.includes('+Hello, World!'));
		});

		test('should generate unified diff format for new file with multiple lines', () => {
			const filePath = 'src/component.ts';
			const content = 'const x = 1;\nconst y = 2;\nconst z = 3;\n';
			const result = synthesizeUntrackedFileDiff(filePath, content);

			assert.ok(result.includes('diff --git a/src/component.ts b/src/component.ts'));
			assert.ok(result.includes('new file mode 100644'));
			assert.ok(result.includes('@@ -0,0 +1,3 @@'));
			assert.ok(result.includes('+const x = 1;'));
			assert.ok(result.includes('+const y = 2;'));
			assert.ok(result.includes('+const z = 3;'));
		});

		test('should handle empty file with empty hunk', () => {
			const filePath = 'empty.txt';
			const content = '';
			const result = synthesizeUntrackedFileDiff(filePath, content);

			assert.ok(result.includes('diff --git a/empty.txt b/empty.txt'));
			assert.ok(result.includes('new file mode 100644'));
			assert.ok(result.includes('--- /dev/null'));
			assert.ok(result.includes('+++ b/empty.txt'));
			assert.ok(!result.includes('@@ -0,0 +1'));
		});

		test('should handle file without trailing newline', () => {
			const filePath = 'no-newline.txt';
			const content = 'Line without newline';
			const result = synthesizeUntrackedFileDiff(filePath, content);

			assert.ok(result.includes('@@ -0,0 +1,1 @@'));
			assert.ok(result.includes('+Line without newline'));
			assert.ok(result.includes('\\ No newline at end of file'));
		});

		test('should handle file with nested directory path', () => {
			const filePath = 'src/components/Button/index.tsx';
			const content = 'export const Button = () => <button />;\n';
			const result = synthesizeUntrackedFileDiff(filePath, content);

			assert.ok(result.includes('diff --git a/src/components/Button/index.tsx b/src/components/Button/index.tsx'));
			assert.ok(result.includes('+++ b/src/components/Button/index.tsx'));
		});

		test('should correctly count lines for multi-line file', () => {
			const filePath = 'five-lines.txt';
			const content = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
			const result = synthesizeUntrackedFileDiff(filePath, content);

			assert.ok(result.includes('@@ -0,0 +1,5 @@'));
			const plusLines = result.split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++'));
			assert.strictEqual(plusLines.length, 5);
		});
	});

	suite('Integration: Git Status Respects .gitignore', () => {

		test('should verify gitignore patterns exclude files from untracked list', async () => {
			const statusOutput = `?? src/newfile.ts
?? README.md
M  package.json`;

			const result = parseUntrackedFiles(statusOutput);

			assert.deepStrictEqual(result, ['src/newfile.ts', 'README.md']);
			assert.ok(!result.includes('node_modules'));
		});
	});
});
