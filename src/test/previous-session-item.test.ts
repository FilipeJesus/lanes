import * as assert from 'assert';
import * as vscode from 'vscode';
import { PreviousSessionItem } from '../PreviousSessionProvider';

suite('PreviousSessionItem', () => {

	test('should display correct label matching session name', () => {
		const sessionName = 'my-feature-session';
		const promptFilePath = '/path/to/prompts/my-feature-session.txt';

		const item = new PreviousSessionItem(sessionName, promptFilePath);

		assert.strictEqual(item.label, sessionName);
	});

	test('should have promptFilePath containing full path to prompt file', () => {
		const sessionName = 'test-session';
		const promptFilePath = '/absolute/path/to/.lanes/test-session.txt';

		const item = new PreviousSessionItem(sessionName, promptFilePath);

		assert.strictEqual(item.promptFilePath, promptFilePath);
	});

	test('should have ThemeIcon with history id', () => {
		const sessionName = 'icon-test-session';
		const promptFilePath = '/path/to/icon-test-session.txt';

		const item = new PreviousSessionItem(sessionName, promptFilePath);

		assert.ok(item.iconPath instanceof vscode.ThemeIcon);
		assert.strictEqual((item.iconPath as vscode.ThemeIcon).id, 'history');
	});

	test('should have correct command attached', () => {
		const sessionName = 'command-test-session';
		const promptFilePath = '/path/to/command-test-session.txt';

		const item = new PreviousSessionItem(sessionName, promptFilePath);

		assert.ok(item.command);
		assert.strictEqual(item.command.command, 'claudeWorktrees.openPreviousSessionPrompt');
	});

	test('should have command arguments containing the item itself', () => {
		const sessionName = 'args-test-session';
		const promptFilePath = '/path/to/args-test-session.txt';

		const item = new PreviousSessionItem(sessionName, promptFilePath);

		assert.ok(item.command);
		assert.ok(item.command.arguments);
		assert.strictEqual(item.command.arguments.length, 1);
		assert.strictEqual(item.command.arguments[0], item);
	});

	test('should have contextValue of previousSessionItem', () => {
		const sessionName = 'context-test-session';
		const promptFilePath = '/path/to/context-test-session.txt';

		const item = new PreviousSessionItem(sessionName, promptFilePath);

		assert.strictEqual(item.contextValue, 'previousSessionItem');
	});
});
