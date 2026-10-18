import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentSessionProvider, SessionItem, SessionDetailItem, initializeGlobalStorageContext, getSessionFilePath } from '../../vscode/providers/AgentSessionProvider';

suite('AgentSessionProvider', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	// Create a temp directory structure before tests
	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-provider-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-session-provider-global-storage-'));
		// Initialize global storage context to enable global storage mode
		await initializeGlobalStorageContext(vscode.Uri.file(globalStorageDir), tempDir);
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

	test('should return empty array for a session with no children or workflow', async () => {
		fs.mkdirSync(worktreesDir);
		fs.mkdirSync(path.join(worktreesDir, 'session'));

		const provider = new AgentSessionProvider(tempDir);
		const sessions = await provider.getChildren();

		// Asking for children of a session should return empty
		const children = await provider.getChildren(sessions[0]);
		assert.deepStrictEqual(children, []);
	});

	function createSession(name: string, parentSession?: unknown): string {
		const worktreePath = path.join(worktreesDir, name);
		fs.mkdirSync(worktreePath, { recursive: true });
		const sessionPath = getSessionFilePath(worktreePath);
		fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
		fs.writeFileSync(sessionPath, JSON.stringify({ parentSession }));
		return worktreePath;
	}

	test('nests children and grandchildren under their creating lanes without duplicating roots', async () => {
		createSession('parent');
		createSession('child', 'parent');
		createSession('grandchild', 'child');
		createSession('independent');

		const provider = new AgentSessionProvider(tempDir);
		const roots = await provider.getChildren();
		assert.deepStrictEqual(roots.map(item => item.label), ['independent', 'parent']);
		const parent = roots[1] as SessionItem;
		assert.strictEqual(parent.collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
		const children = await provider.getChildren(parent);
		assert.deepStrictEqual(children.map(item => item.label), ['child']);
		assert.strictEqual(children[0].id, path.join(worktreesDir, 'child'));
		assert.ok(String(children[0].tooltip).includes('Parent session: parent'));
		const grandchildren = await provider.getChildren(children[0]);
		assert.deepStrictEqual(grandchildren.map(item => item.label), ['grandchild']);
		assert.strictEqual(grandchildren[0].collapsibleState, vscode.TreeItemCollapsibleState.None);

		// The hierarchy is read from disk and survives a new provider instance.
		const reloaded = new AgentSessionProvider(tempDir);
		const reloadedRoots = await reloaded.getChildren();
		assert.deepStrictEqual((await reloaded.getChildren(reloadedRoots[1])).map(item => item.label), ['child']);
	});

	test('shows workflow details alongside child sessions', async () => {
		const parentPath = createSession('parent');
		createSession('child', 'parent');
		fs.writeFileSync(path.join(parentPath, 'workflow-state.json'), JSON.stringify({
			status: 'running', workflow: 'feature', step: 'implement', task: { index: 1 }
		}));

		const provider = new AgentSessionProvider(tempDir);
		const [parent] = await provider.getChildren();
		const children = await provider.getChildren(parent);
		assert.strictEqual(children.length, 2);
		assert.ok(children[0] instanceof SessionDetailItem);
		assert.strictEqual(children[0].label, 'implement (Task 2)');
		assert.deepStrictEqual(await provider.getChildren(children[0]), []);
		assert.ok(children[1] instanceof SessionItem);
		assert.strictEqual(children[1].label, 'child');
		assert.strictEqual(children[1].command?.command, 'lanes.openSession');
	});

	test('keeps children visible when their parent is no longer active', async () => {
		const parentPath = createSession('parent');
		createSession('child', 'parent');
		createSession('grandchild', 'child');
		fs.rmSync(parentPath, { recursive: true });

		const provider = new AgentSessionProvider(tempDir);
		const roots = await provider.getChildren();
		assert.deepStrictEqual(roots.map(item => item.label), ['child']);
		assert.deepStrictEqual((await provider.getChildren(roots[0])).map(item => item.label), ['grandchild']);
	});

	test('keeps sessions with missing or malformed parent metadata at the root', async () => {
		createSession('legacy');
		createSession('invalid-parent', { name: 'legacy' });
		const corruptPath = createSession('corrupt');
		fs.writeFileSync(getSessionFilePath(corruptPath), 'invalid json');

		const provider = new AgentSessionProvider(tempDir);
		assert.deepStrictEqual((await provider.getChildren()).map(item => item.label), ['corrupt', 'invalid-parent', 'legacy']);
	});

	test('breaks self references and cycles so every session remains reachable once', async () => {
		createSession('self', 'self');
		createSession('cycle-a', 'cycle-b');
		createSession('cycle-b', 'cycle-c');
		createSession('cycle-c', 'cycle-a');
		createSession('child', 'cycle-a');

		const provider = new AgentSessionProvider(tempDir);
		const visited = new Set<string>();
		async function visit(items: (SessionItem | SessionDetailItem)[]): Promise<void> {
			for (const item of items) {
				assert.ok(!visited.has(item.worktreePath), `${item.label} should only appear once`);
				visited.add(item.worktreePath);
				await visit(await provider.getChildren(item));
			}
		}
		await visit(await provider.getChildren());
		assert.strictEqual(visited.size, 5);
	});

	test('sorts pinned siblings first while keeping pinned children under their parent', async () => {
		createSession('parent');
		createSession('aaa-child', 'parent');
		const pinnedChildPath = createSession('zzz-child', 'parent');
		const pinnedRootPath = createSession('zzz-root');
		const state = new Map<string, unknown>();
		const context = {
			workspaceState: {
				get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
				update: async (key: string, value: unknown) => { state.set(key, value); }
			}
		} as unknown as vscode.ExtensionContext;
		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, context);
		await provider.pinSession(pinnedChildPath);
		await provider.pinSession(pinnedRootPath);

		const roots = await provider.getChildren();
		assert.deepStrictEqual(roots.map(item => item.label), ['zzz-root', 'parent']);
		const children = await provider.getChildren(roots[1]);
		assert.deepStrictEqual(children.map(item => item.label), ['zzz-child', 'aaa-child']);
		assert.strictEqual(children[0].contextValue, 'sessionItemPinned');
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
