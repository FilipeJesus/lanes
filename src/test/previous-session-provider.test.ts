import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PreviousSessionProvider, PreviousSessionItem, getPromptsDir } from '../vscode/providers/PreviousSessionProvider';

suite('PreviousSessionProvider', () => {

	let tempDir: string;
	let worktreesDir: string;
	let promptsDir: string;

	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'previous-session-provider-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		promptsDir = path.join(tempDir, '.lanes');
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '.lanes', vscode.ConfigurationTarget.Global);
	});

	teardown(async () => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);
		await config.update('worktreesFolder', undefined, vscode.ConfigurationTarget.Global);
	});

	test('should return empty array when no prompts folder exists', async () => {
		const provider = new PreviousSessionProvider(tempDir);

		const children = await provider.getChildren();

		assert.ok(Array.isArray(children));
		assert.strictEqual(children.length, 0);

		provider.dispose();
	});

	test('should return empty array when workspaceRoot is undefined', async () => {
		const provider = new PreviousSessionProvider(undefined);

		const children = await provider.getChildren();

		assert.ok(Array.isArray(children));
		assert.strictEqual(children.length, 0);

		provider.dispose();
	});

	test('should filter out active sessions correctly', async () => {
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'session-a.txt'), 'Prompt for session A');
		fs.writeFileSync(path.join(promptsDir, 'session-b.txt'), 'Prompt for session B');
		fs.writeFileSync(path.join(promptsDir, 'session-c.txt'), 'Prompt for session C');

		fs.mkdirSync(path.join(worktreesDir, 'session-a'), { recursive: true });
		fs.mkdirSync(path.join(worktreesDir, 'session-c'), { recursive: true });

		const provider = new PreviousSessionProvider(tempDir);

		const children = await provider.getChildren();

		assert.strictEqual(children.length, 1);
		assert.strictEqual(children[0].label, 'session-b');

		provider.dispose();
	});

	test('should return correct items for non-active prompts only', async () => {
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'old-session.txt'), 'Old session prompt');
		fs.writeFileSync(path.join(promptsDir, 'another-old-session.txt'), 'Another old session');
		fs.writeFileSync(path.join(promptsDir, 'active-session.txt'), 'Active session prompt');

		fs.mkdirSync(path.join(worktreesDir, 'active-session'), { recursive: true });

		const provider = new PreviousSessionProvider(tempDir);

		const children = await provider.getChildren();

		assert.strictEqual(children.length, 2);

		const labels = children.map(child => child.label);
		assert.ok(labels.includes('old-session'));
		assert.ok(labels.includes('another-old-session'));
		assert.ok(!labels.includes('active-session'));

		for (const child of children) {
			assert.ok(child instanceof PreviousSessionItem);
			assert.strictEqual(child.contextValue, 'previousSessionItem');
		}

		provider.dispose();
	});

	test('should strip .txt extension from prompt file names in labels', async () => {
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'my-feature.txt'), 'Feature prompt');

		const provider = new PreviousSessionProvider(tempDir);

		const children = await provider.getChildren();

		assert.strictEqual(children.length, 1);
		assert.strictEqual(children[0].label, 'my-feature');

		provider.dispose();
	});

	test('should fire onDidChangeTreeData event when refresh is called', async () => {
		const provider = new PreviousSessionProvider(tempDir);
		let eventFired = false;

		provider.onDidChangeTreeData(() => {
			eventFired = true;
		});

		provider.refresh();

		assert.strictEqual(eventFired, true);

		provider.dispose();
	});

	test('should only read .txt files from prompts folder', async () => {
		fs.mkdirSync(promptsDir, { recursive: true });
		fs.writeFileSync(path.join(promptsDir, 'valid-session.txt'), 'Valid prompt');
		fs.writeFileSync(path.join(promptsDir, 'readme.md'), 'Not a prompt file');
		fs.writeFileSync(path.join(promptsDir, 'config.json'), '{}');
		fs.mkdirSync(path.join(promptsDir, 'subdirectory'));

		const provider = new PreviousSessionProvider(tempDir);

		const children = await provider.getChildren();

		assert.strictEqual(children.length, 1);
		assert.strictEqual(children[0].label, 'valid-session');

		provider.dispose();
	});

	test('should return tree item unchanged from getTreeItem', () => {
		const provider = new PreviousSessionProvider(tempDir);
		const item = new PreviousSessionItem('test-session', '/path/to/test-session.txt');

		const result = provider.getTreeItem(item);

		assert.strictEqual(result, item);

		provider.dispose();
	});

	test('should return empty array when getChildren is called with an element', async () => {
		const provider = new PreviousSessionProvider(tempDir);
		const item = new PreviousSessionItem('test-session', '/path/to/test-session.txt');

		const children = await provider.getChildren(item);

		assert.ok(Array.isArray(children));
		assert.strictEqual(children.length, 0);

		provider.dispose();
	});

	test('should use baseRepoPath for finding sessions when provided', async () => {
		const baseRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-repo-'));
		const basePromptsDir = path.join(baseRepoDir, '.lanes');

		try {
			fs.mkdirSync(basePromptsDir, { recursive: true });
			fs.writeFileSync(path.join(basePromptsDir, 'base-session.txt'), 'Base prompt');

			const provider = new PreviousSessionProvider(tempDir, baseRepoDir);

			const children = await provider.getChildren();

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].label, 'base-session');
		} finally {
			fs.rmSync(baseRepoDir, { recursive: true, force: true });
		}
	});
});

suite('getPromptsDir', () => {
	const testRepoRoot = '/test/repo';

	teardown(async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);
	});

	test('should return global storage path when not configured but global storage is initialized', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.ok(result);
	});

	test('should return configured path when valid path is set', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '.lanes', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.strictEqual(result, path.join(testRepoRoot, '.lanes'));
	});

	test('should trim whitespace from configured path', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '  .lanes  ', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.strictEqual(result, path.join(testRepoRoot, '.lanes'));
	});

	test('should return global storage path when configuration is empty string', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.ok(result);
	});

	test('should return global storage path when configuration is only whitespace', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '   ', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.ok(result);
	});

	test('should strip leading slashes and use as relative path', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '/custom/prompts', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.strictEqual(result, path.join(testRepoRoot, 'custom/prompts'));
	});

	test('should normalize backslashes to forward slashes', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', 'custom\\prompts\\folder', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.strictEqual(result, path.join(testRepoRoot, 'custom/prompts/folder'));
	});

	test('should remove leading and trailing slashes', async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', '/custom/prompts/', vscode.ConfigurationTarget.Global);

		const result = getPromptsDir(testRepoRoot);

		assert.strictEqual(result, path.join(testRepoRoot, 'custom/prompts'));
	});
});
