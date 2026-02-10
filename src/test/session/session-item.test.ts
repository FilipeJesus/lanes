import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { SessionItem, AgentSessionStatus, initializeGlobalStorageContext } from '../../AgentSessionProvider';

suite('SessionItem', () => {

	test('should create item with correct label and path', () => {
		const item = new SessionItem(
			'test-session',
			'/path/to/worktree',
			vscode.TreeItemCollapsibleState.None
		);

		assert.strictEqual(item.label, 'test-session');
		assert.strictEqual(item.worktreePath, '/path/to/worktree');
	});

	test('should have correct tooltip', () => {
		const item = new SessionItem(
			'my-session',
			'/some/path',
			vscode.TreeItemCollapsibleState.None
		);

		assert.strictEqual(item.tooltip, 'Path: /some/path');
	});

	test('should have "Active" description', () => {
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None
		);

		assert.strictEqual(item.description, 'Active');
	});

	test('should have git-branch icon', () => {
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None
		);

		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'git-branch');
	});

	test('should have openSession command attached', () => {
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None
		);

		assert.ok(item.command);
		assert.strictEqual(item.command.command, 'lanes.openSession');
		assert.deepStrictEqual(item.command.arguments, [item]);
	});

	test('should have sessionItem context value', () => {
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None
		);

		assert.strictEqual(item.contextValue, 'sessionItem');
	});
});

suite('SessionItem Visual Indicators', () => {

	let tempDir: string;
	let globalStorageDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-visual-test-'));
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-session-visual-global-storage-'));
		initializeGlobalStorageContext(vscode.Uri.file(globalStorageDir), tempDir);
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	test('should display bell icon with yellow color for waiting_for_user status', () => {
		// Arrange
		const claudeStatus: AgentSessionStatus = { status: 'waiting_for_user' };

		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			claudeStatus
		);

		// Assert
		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		const themeIcon = item.iconPath as vscode.ThemeIcon;
		assert.strictEqual(themeIcon.id, 'bell');
		assert.ok(themeIcon.color, 'Icon should have a color');
	});

	test('should display sync~spin icon for working status', () => {
		// Arrange
		const claudeStatus: AgentSessionStatus = { status: 'working' };

		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			claudeStatus
		);

		// Assert
		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		const themeIcon = item.iconPath as vscode.ThemeIcon;
		assert.strictEqual(themeIcon.id, 'sync~spin');
	});

	test('should display error icon with red color for error status', () => {
		// Arrange
		const claudeStatus: AgentSessionStatus = { status: 'error' };

		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			claudeStatus
		);

		// Assert
		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		const themeIcon = item.iconPath as vscode.ThemeIcon;
		assert.strictEqual(themeIcon.id, 'error');
		assert.ok(themeIcon.color, 'Icon should have a color');
	});

	test('should display git-branch icon for idle status', () => {
		// Arrange
		const claudeStatus: AgentSessionStatus = { status: 'idle' };

		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			claudeStatus
		);

		// Assert
		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		const themeIcon = item.iconPath as vscode.ThemeIcon;
		assert.strictEqual(themeIcon.id, 'git-branch');
	});

	test('should display git-branch icon when claudeStatus is null', () => {
		// Arrange & Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			null
		);

		// Assert
		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		const themeIcon = item.iconPath as vscode.ThemeIcon;
		assert.strictEqual(themeIcon.id, 'git-branch');
	});

	test('should display "Waiting" description for waiting_for_user status', () => {
		// Arrange
		const claudeStatus: AgentSessionStatus = { status: 'waiting_for_user' };

		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			claudeStatus
		);

		// Assert - step/task info now shown in child SessionDetailItem, main line shows only status
		assert.strictEqual(item.description, 'Waiting');
	});

	test('should display "Working" description for working status', () => {
		// Arrange
		const claudeStatus: AgentSessionStatus = { status: 'working' };

		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None,
			claudeStatus
		);

		// Assert - step/task info now shown in child SessionDetailItem, main line shows only status
		assert.strictEqual(item.description, 'Working');
	});

	test('should display "Active" when claudeStatus is undefined', () => {
		// Act
		const item = new SessionItem(
			'session',
			'/path',
			vscode.TreeItemCollapsibleState.None
		);

		// Assert: Should show default description
		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		const themeIcon = item.iconPath as vscode.ThemeIcon;
		assert.strictEqual(themeIcon.id, 'git-branch');
		assert.strictEqual(item.description, 'Active');
	});
});
