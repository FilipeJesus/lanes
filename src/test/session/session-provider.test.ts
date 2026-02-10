import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentSessionProvider, SessionItem, initializeGlobalStorageContext } from '../../AgentSessionProvider';

suite('AgentSessionProvider', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-provider-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-session-provider-global-storage-'));
		// Initialize global storage context to enable global storage mode
		initializeGlobalStorageContext(vscode.Uri.file(globalStorageDir), tempDir);
	});

	// Clean up after each test
	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	test('should return empty array when workspace is undefined', async () => {
		const provider = new AgentSessionProvider(undefined);
		const children = await provider.getChildren();

		assert.deepStrictEqual(children, []);
	});

	test('should return empty array when .worktrees folder does not exist', async () => {
		const provider = new AgentSessionProvider(tempDir);
		const children = await provider.getChildren();

		assert.deepStrictEqual(children, []);
	});

	test('should return empty array when .worktrees folder is empty', async () => {
		fs.mkdirSync(worktreesDir);

		const provider = new AgentSessionProvider(tempDir);
		const children = await provider.getChildren();

		assert.deepStrictEqual(children, []);
	});

	test('should discover sessions in .worktrees folder', async () => {
		fs.mkdirSync(worktreesDir);
		fs.mkdirSync(path.join(worktreesDir, 'session-one'));
		fs.mkdirSync(path.join(worktreesDir, 'session-two'));

		const provider = new AgentSessionProvider(tempDir);
		const children = await provider.getChildren();

		assert.strictEqual(children.length, 2);

		const labels = children.map(c => c.label).sort();
		assert.deepStrictEqual(labels, ['session-one', 'session-two']);
	});

	test('should ignore files in .worktrees folder (only directories)', async () => {
		fs.mkdirSync(worktreesDir);
		fs.mkdirSync(path.join(worktreesDir, 'valid-session'));
		fs.writeFileSync(path.join(worktreesDir, 'not-a-session.txt'), 'test');

		const provider = new AgentSessionProvider(tempDir);
		const children = await provider.getChildren();

		assert.strictEqual(children.length, 1);
		assert.strictEqual(children[0].label, 'valid-session');
	});

	test('should set correct worktreePath on discovered sessions', async () => {
		fs.mkdirSync(worktreesDir);
		fs.mkdirSync(path.join(worktreesDir, 'my-session'));

		const provider = new AgentSessionProvider(tempDir);
		const children = await provider.getChildren();

		assert.strictEqual(children[0].worktreePath, path.join(worktreesDir, 'my-session'));
	});

	test('should return empty array for child elements (flat list)', async () => {
		fs.mkdirSync(worktreesDir);
		fs.mkdirSync(path.join(worktreesDir, 'session'));

		const provider = new AgentSessionProvider(tempDir);
		const sessions = await provider.getChildren();

		// Asking for children of a session should return empty
		const children = await provider.getChildren(sessions[0]);
		assert.deepStrictEqual(children, []);
	});

	test('getTreeItem should return the same item', () => {
		const provider = new AgentSessionProvider(tempDir);
		const item = new SessionItem('test', '/path', vscode.TreeItemCollapsibleState.None);

		assert.strictEqual(provider.getTreeItem(item), item);
	});

	test('refresh should fire onDidChangeTreeData event', (done) => {
		const provider = new AgentSessionProvider(tempDir);

		provider.onDidChangeTreeData(() => {
			done();
		});

		provider.refresh();
	});
});
