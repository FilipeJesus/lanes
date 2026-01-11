import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PreviousSessionItem, PreviousSessionProvider, getPromptsDir } from '../PreviousSessionProvider';

/**
 * Test suite for PreviousSessionProvider and related functionality.
 *
 * Tests the ability to display previous (inactive) sessions that have
 * prompt files but no active worktree.
 */
suite('PreviousSessionItem', () => {

	test('should display correct label matching session name', () => {
		// Arrange
		const sessionName = 'my-feature-session';
		const promptFilePath = '/path/to/prompts/my-feature-session.txt';

		// Act
		const item = new PreviousSessionItem(sessionName, promptFilePath);

		// Assert
		assert.strictEqual(
			item.label,
			sessionName,
			'Label should equal the session name'
		);
	});

	test('should have promptFilePath containing full path to prompt file', () => {
		// Arrange
		const sessionName = 'test-session';
		const promptFilePath = '/absolute/path/to/.lanes/test-session.txt';

		// Act
		const item = new PreviousSessionItem(sessionName, promptFilePath);

		// Assert
		assert.strictEqual(
			item.promptFilePath,
			promptFilePath,
			'promptFilePath should contain the full path to the prompt file'
		);
	});

	test('should have ThemeIcon with history id', () => {
		// Arrange
		const sessionName = 'icon-test-session';
		const promptFilePath = '/path/to/icon-test-session.txt';

		// Act
		const item = new PreviousSessionItem(sessionName, promptFilePath);

		// Assert
		assert.ok(
			item.iconPath instanceof vscode.ThemeIcon,
			'iconPath should be a ThemeIcon'
		);
		assert.strictEqual(
			(item.iconPath as vscode.ThemeIcon).id,
			'history',
			'ThemeIcon should have id "history"'
		);
	});

	test('should have correct command attached', () => {
		// Arrange
		const sessionName = 'command-test-session';
		const promptFilePath = '/path/to/command-test-session.txt';

		// Act
		const item = new PreviousSessionItem(sessionName, promptFilePath);

		// Assert
		assert.ok(item.command, 'Item should have a command');
		assert.strictEqual(
			item.command.command,
			'claudeWorktrees.openPreviousSessionPrompt',
			'Command should be claudeWorktrees.openPreviousSessionPrompt'
		);
	});

	test('should have command arguments containing the item itself', () => {
		// Arrange
		const sessionName = 'args-test-session';
		const promptFilePath = '/path/to/args-test-session.txt';

		// Act
		const item = new PreviousSessionItem(sessionName, promptFilePath);

		// Assert
		assert.ok(item.command, 'Item should have a command');
		assert.ok(item.command.arguments, 'Command should have arguments');
		assert.strictEqual(item.command.arguments.length, 1, 'Should have one argument');
		assert.strictEqual(
			item.command.arguments[0],
			item,
			'First argument should be the item itself'
		);
	});

	test('should have contextValue of previousSessionItem', () => {
		// Arrange
		const sessionName = 'context-test-session';
		const promptFilePath = '/path/to/context-test-session.txt';

		// Act
		const item = new PreviousSessionItem(sessionName, promptFilePath);

		// Assert
		assert.strictEqual(
			item.contextValue,
			'previousSessionItem',
			'contextValue should equal previousSessionItem'
		);
	});
});

suite('PreviousSessionProvider', () => {

	let tempDir: string;
	let worktreesDir: string;
	let promptsDir: string;

	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'previous-session-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		promptsDir = path.join(tempDir, '.lanes');

		// Reset configuration to default
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);
		await config.update('worktreesFolder', undefined, vscode.ConfigurationTarget.Global);
	});

	teardown(async () => {
		fs.rmSync(tempDir, { recursive: true, force: true });

		// Reset configuration
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);
		await config.update('worktreesFolder', undefined, vscode.ConfigurationTarget.Global);
	});

	test('should return empty array when no prompts folder exists', async () => {
		// Arrange: tempDir exists but no prompts folder
		const provider = new PreviousSessionProvider(tempDir);

		// Act
		const children = await provider.getChildren();

		// Assert
		assert.ok(Array.isArray(children), 'Should return an array');
		assert.strictEqual(children.length, 0, 'Should return empty array when no prompts folder exists');

		// Cleanup
		provider.dispose();
	});

	test('should return empty array when workspaceRoot is undefined', async () => {
		// Arrange
		const provider = new PreviousSessionProvider(undefined);

		// Act
		const children = await provider.getChildren();

		// Assert
		assert.ok(Array.isArray(children), 'Should return an array');
		assert.strictEqual(children.length, 0, 'Should return empty array when workspaceRoot is undefined');

		// Cleanup
		provider.dispose();
	});

	test('should filter out active sessions correctly', async () => {
		// Arrange: Create prompts folder with 3 prompt files
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'session-a.txt'), 'Prompt for session A');
		fs.writeFileSync(path.join(promptsDir, 'session-b.txt'), 'Prompt for session B');
		fs.writeFileSync(path.join(promptsDir, 'session-c.txt'), 'Prompt for session C');

		// Create active worktrees for session-a and session-c
		fs.mkdirSync(path.join(worktreesDir, 'session-a'), { recursive: true });
		fs.mkdirSync(path.join(worktreesDir, 'session-c'), { recursive: true });

		const provider = new PreviousSessionProvider(tempDir);

		// Act
		const children = await provider.getChildren();

		// Assert
		assert.strictEqual(children.length, 1, 'Should return only 1 item (session-b is not active)');
		assert.strictEqual(children[0].label, 'session-b', 'The returned item should be session-b');

		// Cleanup
		provider.dispose();
	});

	test('should return correct items for non-active prompts only', async () => {
		// Arrange: Create prompts folder with prompt files
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'old-session.txt'), 'Old session prompt');
		fs.writeFileSync(path.join(promptsDir, 'another-old-session.txt'), 'Another old session');
		fs.writeFileSync(path.join(promptsDir, 'active-session.txt'), 'Active session prompt');

		// Create active worktree only for active-session
		fs.mkdirSync(path.join(worktreesDir, 'active-session'), { recursive: true });

		const provider = new PreviousSessionProvider(tempDir);

		// Act
		const children = await provider.getChildren();

		// Assert
		assert.strictEqual(children.length, 2, 'Should return 2 items (non-active sessions)');

		const labels = children.map(child => child.label);
		assert.ok(labels.includes('old-session'), 'Should include old-session');
		assert.ok(labels.includes('another-old-session'), 'Should include another-old-session');
		assert.ok(!labels.includes('active-session'), 'Should NOT include active-session');

		// Verify all returned items are PreviousSessionItems
		for (const child of children) {
			assert.ok(child instanceof PreviousSessionItem, 'Each child should be a PreviousSessionItem');
			assert.strictEqual(child.contextValue, 'previousSessionItem', 'Each item should have correct contextValue');
		}

		// Cleanup
		provider.dispose();
	});

	test('should strip .txt extension from prompt file names in labels', async () => {
		// Arrange
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'my-feature.txt'), 'Feature prompt');

		const provider = new PreviousSessionProvider(tempDir);

		// Act
		const children = await provider.getChildren();

		// Assert
		assert.strictEqual(children.length, 1, 'Should return 1 item');
		assert.strictEqual(children[0].label, 'my-feature', 'Label should be filename without .txt extension');

		// Cleanup
		provider.dispose();
	});

	test('should fire onDidChangeTreeData event when refresh is called', async () => {
		// Arrange
		const provider = new PreviousSessionProvider(tempDir);
		let eventFired = false;

		provider.onDidChangeTreeData(() => {
			eventFired = true;
		});

		// Act
		provider.refresh();

		// Assert
		assert.strictEqual(eventFired, true, 'onDidChangeTreeData event should fire when refresh is called');

		// Cleanup
		provider.dispose();
	});

	test('should only read .txt files from prompts folder', async () => {
		// Arrange: Create prompts folder with various files
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'valid-session.txt'), 'Valid prompt');
		fs.writeFileSync(path.join(promptsDir, 'readme.md'), 'Not a prompt file');
		fs.writeFileSync(path.join(promptsDir, 'config.json'), '{}');
		fs.mkdirSync(path.join(promptsDir, 'subdirectory'));

		const provider = new PreviousSessionProvider(tempDir);

		// Act
		const children = await provider.getChildren();

		// Assert
		assert.strictEqual(children.length, 1, 'Should return only 1 item (the .txt file)');
		assert.strictEqual(children[0].label, 'valid-session', 'Should return the .txt file without extension');

		// Cleanup
		provider.dispose();
	});

	test('should return tree item unchanged from getTreeItem', () => {
		// Arrange
		const provider = new PreviousSessionProvider(tempDir);
		const item = new PreviousSessionItem('test-session', '/path/to/test-session.txt');

		// Act
		const result = provider.getTreeItem(item);

		// Assert
		assert.strictEqual(result, item, 'getTreeItem should return the same item');

		// Cleanup
		provider.dispose();
	});

	test('should return empty array when getChildren is called with an element', async () => {
		// Arrange
		const provider = new PreviousSessionProvider(tempDir);
		const item = new PreviousSessionItem('test-session', '/path/to/test-session.txt');

		// Act
		const children = await provider.getChildren(item);

		// Assert
		assert.ok(Array.isArray(children), 'Should return an array');
		assert.strictEqual(children.length, 0, 'Should return empty array for child elements (flat list)');

		// Cleanup
		provider.dispose();
	});

	test('should use baseRepoPath for finding sessions when provided', async () => {
		// Arrange: Create a second temp dir to simulate base repo
		const baseRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-repo-'));
		const basePromptsDir = path.join(baseRepoDir, '.lanes');

		try {
			fs.mkdirSync(basePromptsDir, { recursive: true });
			fs.writeFileSync(path.join(basePromptsDir, 'base-session.txt'), 'Base prompt');

			// Provider with worktree path but baseRepoPath pointing to base
			const provider = new PreviousSessionProvider(tempDir, baseRepoDir);

			// Act
			const children = await provider.getChildren();

			// Assert: Should find sessions from baseRepoPath, not workspaceRoot
			assert.strictEqual(children.length, 1, 'Should find session from baseRepoPath');
			assert.strictEqual(children[0].label, 'base-session', 'Should find base-session from base repo');

			// Cleanup
			provider.dispose();
		} finally {
			fs.rmSync(baseRepoDir, { recursive: true, force: true });
		}
	});
});

suite('getPromptsDir', () => {
	const testRepoRoot = '/test/repo';

	teardown(async () => {
		// Reset configuration after each test
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);
	});

	test('should return legacy path when not configured and global storage not initialized', async () => {
		// Arrange: Ensure configuration is not set
		// Note: In test environment, global storage is not initialized, so it falls back to legacy
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert - falls back to legacy .lanes when global storage not initialized
		assert.strictEqual(
			result,
			path.join(testRepoRoot, '.lanes'),
			'Should return legacy path when global storage not initialized'
		);
	});

	test('should return legacy path when configuration is empty string', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, '.lanes'),
			'Should return legacy path when config is empty string'
		);
	});

	test('should return legacy path when configuration is only whitespace', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '   ', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, '.lanes'),
			'Should return legacy path when config is only whitespace'
		);
	});

	test('should return configured path when valid path is set', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', 'custom/prompts', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, 'custom/prompts'),
			'Should return the configured path joined with repoRoot'
		);
	});

	test('should trim whitespace from configured path', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '  custom/prompts  ', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, 'custom/prompts'),
			'Should trim whitespace from configured path'
		);
	});

	test('should reject path with parent directory traversal (..) and use global storage fallback', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '../../../etc', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert - falls back to legacy when global storage not initialized
		assert.strictEqual(
			result,
			path.join(testRepoRoot, '.lanes'),
			'Should reject path traversal and fall back to legacy path'
		);
	});

	test('should strip leading slashes and use as relative path', async () => {
		// Arrange
		// Note: The implementation strips leading/trailing slashes before checking isAbsolute,
		// so '/etc/passwd' becomes 'etc/passwd' (a relative path) rather than being rejected.
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '/custom/prompts', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, 'custom/prompts'),
			'Absolute paths are transformed to relative by stripping leading slashes'
		);
	});

	test('should normalize backslashes to forward slashes', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', 'custom\\prompts\\folder', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, 'custom/prompts/folder'),
			'Should normalize backslashes to forward slashes'
		);
	});

	test('should remove leading and trailing slashes', async () => {
		// Arrange
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '/custom/prompts/', vscode.ConfigurationTarget.Global);

		// Act
		const result = getPromptsDir(testRepoRoot);

		// Assert
		assert.strictEqual(
			result,
			path.join(testRepoRoot, 'custom/prompts'),
			'Should remove leading and trailing slashes'
		);
	});
});
