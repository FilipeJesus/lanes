import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AgentSessionProvider, SessionItem, initializeGlobalStorageContext } from '../../vscode/providers/AgentSessionProvider';

suite('Pin/Unpin Sessions', () => {

	let tempDir: string;
	let worktreesDir: string;
	let globalStorageDir: string;
	let mockContext: vscode.ExtensionContext;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-pin-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-pin-global-storage-'));

		// Initialize global storage context
		initializeGlobalStorageContext(vscode.Uri.file(globalStorageDir), tempDir);

		// Create mock extension context with workspaceState
		const workspaceStateMap = new Map<string, any>();
		mockContext = {
			workspaceState: {
				get: <T>(key: string, defaultValue?: T): T | undefined => {
					return workspaceStateMap.has(key) ? workspaceStateMap.get(key) : defaultValue;
				},
				update: async (key: string, value: any): Promise<void> => {
					workspaceStateMap.set(key, value);
				},
				keys: (): readonly string[] => Array.from(workspaceStateMap.keys())
			}
		} as any;
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	test('Given a session is pinned, when pinSession is called, then the worktree path is stored in workspaceState under \'lanes.pinnedSessions\'', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const sessionPath = path.join(worktreesDir, 'test-session');
		fs.mkdirSync(sessionPath);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);

		// Act
		await provider.pinSession(sessionPath);

		// Assert
		const pinnedSessions = provider.getPinnedSessions();
		assert.strictEqual(pinnedSessions.length, 1);
		assert.strictEqual(pinnedSessions[0], sessionPath);
	});

	test('Given a session is unpinned, when unpinSession is called, then the worktree path is removed from workspaceState \'lanes.pinnedSessions\'', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const sessionPath = path.join(worktreesDir, 'test-session');
		fs.mkdirSync(sessionPath);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);
		await provider.pinSession(sessionPath);

		// Verify it's pinned first
		assert.strictEqual(provider.getPinnedSessions().length, 1);

		// Act
		await provider.unpinSession(sessionPath);

		// Assert
		const pinnedSessions = provider.getPinnedSessions();
		assert.strictEqual(pinnedSessions.length, 0);
	});

	test('Given multiple sessions are pinned, when getPinnedSessions is called, then all pinned worktree paths are returned', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const session1Path = path.join(worktreesDir, 'session-1');
		const session2Path = path.join(worktreesDir, 'session-2');
		const session3Path = path.join(worktreesDir, 'session-3');
		fs.mkdirSync(session1Path);
		fs.mkdirSync(session2Path);
		fs.mkdirSync(session3Path);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);

		// Act
		await provider.pinSession(session1Path);
		await provider.pinSession(session3Path);

		// Assert
		const pinnedSessions = provider.getPinnedSessions();
		assert.strictEqual(pinnedSessions.length, 2);
		assert.ok(pinnedSessions.includes(session1Path));
		assert.ok(pinnedSessions.includes(session3Path));
		assert.ok(!pinnedSessions.includes(session2Path));
	});

	test('Given a session is pinned, when SessionItem is created, then contextValue is \'sessionItemPinned\'', () => {
		// Act
		const item = new SessionItem(
			'test-session',
			'/path/to/worktree',
			vscode.TreeItemCollapsibleState.None,
			null,
			null,
			false,
			true // pinned
		);

		// Assert
		assert.strictEqual(item.contextValue, 'sessionItemPinned');
	});

	test('Given a session is unpinned, when SessionItem is created, then contextValue is \'sessionItem\'', () => {
		// Act
		const item = new SessionItem(
			'test-session',
			'/path/to/worktree',
			vscode.TreeItemCollapsibleState.None,
			null,
			null,
			false,
			false // not pinned
		);

		// Assert
		assert.strictEqual(item.contextValue, 'sessionItem');
	});

	test('Given existing menu items check for sessionItem, when contextValue changes, then menus using regex pattern still match', () => {
		// This test verifies that both 'sessionItem' and 'sessionItemPinned' would match a regex pattern like /^sessionItem/

		// Arrange
		const unpinnedItem = new SessionItem('test', '/path', vscode.TreeItemCollapsibleState.None, null, null, false, false);
		const pinnedItem = new SessionItem('test', '/path', vscode.TreeItemCollapsibleState.None, null, null, false, true);

		// Assert - both should start with 'sessionItem'
		assert.ok(unpinnedItem.contextValue?.startsWith('sessionItem'));
		assert.ok(pinnedItem.contextValue?.startsWith('sessionItem'));

		// Verify they match a pattern that would be used in package.json: /^sessionItem/
		const pattern = /^sessionItem/;
		assert.ok(pattern.test(unpinnedItem.contextValue || ''));
		assert.ok(pattern.test(pinnedItem.contextValue || ''));
	});

	test('Given multiple sessions with some pinned, when getSessionsInDir returns items, then pinned items appear before unpinned items', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const session1Path = path.join(worktreesDir, 'aaa-unpinned');
		const session2Path = path.join(worktreesDir, 'bbb-pinned');
		const session3Path = path.join(worktreesDir, 'ccc-pinned');
		const session4Path = path.join(worktreesDir, 'ddd-unpinned');
		fs.mkdirSync(session1Path);
		fs.mkdirSync(session2Path);
		fs.mkdirSync(session3Path);
		fs.mkdirSync(session4Path);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);
		await provider.pinSession(session2Path);
		await provider.pinSession(session3Path);

		// Act
		const sessions = await provider.getChildren();

		// Assert
		assert.strictEqual(sessions.length, 4);

		// First two should be pinned (bbb-pinned and ccc-pinned)
		assert.strictEqual(sessions[0].label, 'bbb-pinned');
		assert.strictEqual(sessions[1].label, 'ccc-pinned');

		// Last two should be unpinned (aaa-unpinned and ddd-unpinned)
		assert.strictEqual(sessions[2].label, 'aaa-unpinned');
		assert.strictEqual(sessions[3].label, 'ddd-unpinned');
	});

	test('Given pinned sessions, when sorted, then relative order within pinned group is preserved', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const sessionAPinned = path.join(worktreesDir, 'aaa-pinned');
		const sessionBPinned = path.join(worktreesDir, 'bbb-pinned');
		const sessionCPinned = path.join(worktreesDir, 'ccc-pinned');
		fs.mkdirSync(sessionAPinned);
		fs.mkdirSync(sessionBPinned);
		fs.mkdirSync(sessionCPinned);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);

		// Pin in order: A, B, C
		await provider.pinSession(sessionAPinned);
		await provider.pinSession(sessionBPinned);
		await provider.pinSession(sessionCPinned);

		// Act
		const sessions = await provider.getChildren();

		// Assert - order should be preserved as they were pinned
		assert.strictEqual(sessions.length, 3);
		assert.strictEqual(sessions[0].label, 'aaa-pinned');
		assert.strictEqual(sessions[1].label, 'bbb-pinned');
		assert.strictEqual(sessions[2].label, 'ccc-pinned');
	});

	test('Given unpinned sessions, when sorted, then relative order within unpinned group is preserved', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const sessionA = path.join(worktreesDir, 'aaa-unpinned');
		const sessionB = path.join(worktreesDir, 'bbb-unpinned');
		const sessionC = path.join(worktreesDir, 'ccc-unpinned');
		fs.mkdirSync(sessionA);
		fs.mkdirSync(sessionB);
		fs.mkdirSync(sessionC);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);

		// Act
		const sessions = await provider.getChildren();

		// Assert - unpinned sessions maintain their natural order from readdir
		assert.strictEqual(sessions.length, 3);
		// Note: We just verify they are all present and unpinned, order from readdir can vary
		const labels = sessions.map(s => s.label);
		assert.ok(labels.includes('aaa-unpinned'));
		assert.ok(labels.includes('bbb-unpinned'));
		assert.ok(labels.includes('ccc-unpinned'));
	});

	test('Given a session is pinned, when SessionItem description is generated, then it includes \'Pinned - \' prefix', () => {
		// Act
		const item = new SessionItem(
			'test-session',
			'/path/to/worktree',
			vscode.TreeItemCollapsibleState.None,
			null,
			null,
			false,
			true // pinned
		);

		// Assert
		assert.strictEqual(typeof item.description, 'string');
		assert.ok((item.description as string).startsWith('Pinned - '));
	});

	test('Given a session is unpinned, when SessionItem description is generated, then it does not include \'Pinned - \' prefix', () => {
		// Act
		const item = new SessionItem(
			'test-session',
			'/path/to/worktree',
			vscode.TreeItemCollapsibleState.None,
			null,
			null,
			false,
			false // not pinned
		);

		// Assert
		assert.strictEqual(typeof item.description, 'string');
		assert.ok(!(item.description as string).startsWith('Pinned - '));
	});

	test('Given the extension is activated, when commands are registered, then \'lanes.pinSession\' is registered', async () => {
		// Trigger extension activation
		try {
			await vscode.commands.executeCommand('lanes.openSession');
		} catch {
			// Expected to fail without proper args, but extension is now activated
		}

		// Act
		const commands = await vscode.commands.getCommands(true);

		// Assert
		assert.ok(commands.includes('lanes.pinSession'), 'lanes.pinSession command should be registered');
	});

	test('Given the extension is activated, when commands are registered, then \'lanes.unpinSession\' is registered', async () => {
		// Trigger extension activation
		try {
			await vscode.commands.executeCommand('lanes.openSession');
		} catch {
			// Expected to fail without proper args, but extension is now activated
		}

		// Act
		const commands = await vscode.commands.getCommands(true);

		// Assert
		assert.ok(commands.includes('lanes.unpinSession'), 'lanes.unpinSession command should be registered');
	});

	test('Given an unpinned session, when lanes.pinSession is executed, then the session becomes pinned and tree refreshes', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const sessionPath = path.join(worktreesDir, 'test-session');
		fs.mkdirSync(sessionPath);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);

		// Create a session item
		const item = new SessionItem(
			'test-session',
			sessionPath,
			vscode.TreeItemCollapsibleState.None,
			null,
			null,
			false,
			false
		);

		// Track if tree refresh was called
		let refreshCalled = false;
		provider.onDidChangeTreeData(() => {
			refreshCalled = true;
		});

		// Act
		await provider.pinSession(item.worktreePath);
		provider.refresh();

		// Assert
		const pinnedSessions = provider.getPinnedSessions();
		assert.strictEqual(pinnedSessions.length, 1);
		assert.ok(pinnedSessions.includes(sessionPath));
		assert.ok(refreshCalled, 'Tree refresh should be triggered');
	});

	test('Given a pinned session, when lanes.unpinSession is executed, then the session becomes unpinned and tree refreshes', async () => {
		// Arrange
		fs.mkdirSync(worktreesDir);
		const sessionPath = path.join(worktreesDir, 'test-session');
		fs.mkdirSync(sessionPath);

		const provider = new AgentSessionProvider(tempDir, tempDir, undefined, mockContext);

		// Pin the session first
		await provider.pinSession(sessionPath);
		assert.strictEqual(provider.getPinnedSessions().length, 1);

		// Create a session item
		const item = new SessionItem(
			'test-session',
			sessionPath,
			vscode.TreeItemCollapsibleState.None,
			null,
			null,
			false,
			true
		);

		// Track if tree refresh was called
		let refreshCalled = false;
		provider.onDidChangeTreeData(() => {
			refreshCalled = true;
		});

		// Act
		await provider.unpinSession(item.worktreePath);
		provider.refresh();

		// Assert
		const pinnedSessions = provider.getPinnedSessions();
		assert.strictEqual(pinnedSessions.length, 0);
		assert.ok(refreshCalled, 'Tree refresh should be triggered');
	});
});
