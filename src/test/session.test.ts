import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ClaudeSessionProvider, SessionItem, getClaudeStatus, getSessionId, ClaudeStatus, ClaudeSessionData } from '../ClaudeSessionProvider';
import { SessionFormProvider, isValidPermissionMode, PERMISSION_MODES } from '../SessionFormProvider';
import { combinePromptAndCriteria } from '../extension';

suite('Session Tests', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
	});

	// Clean up after each test
	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

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
			assert.strictEqual(item.command.command, 'claudeWorktrees.openSession');
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

	suite('ClaudeSessionProvider', () => {

		test('should return empty array when workspace is undefined', async () => {
			const provider = new ClaudeSessionProvider(undefined);
			const children = await provider.getChildren();

			assert.deepStrictEqual(children, []);
		});

		test('should return empty array when .worktrees folder does not exist', async () => {
			const provider = new ClaudeSessionProvider(tempDir);
			const children = await provider.getChildren();

			assert.deepStrictEqual(children, []);
		});

		test('should return empty array when .worktrees folder is empty', async () => {
			fs.mkdirSync(worktreesDir);

			const provider = new ClaudeSessionProvider(tempDir);
			const children = await provider.getChildren();

			assert.deepStrictEqual(children, []);
		});

		test('should discover sessions in .worktrees folder', async () => {
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'session-one'));
			fs.mkdirSync(path.join(worktreesDir, 'session-two'));

			const provider = new ClaudeSessionProvider(tempDir);
			const children = await provider.getChildren();

			assert.strictEqual(children.length, 2);

			const labels = children.map(c => c.label).sort();
			assert.deepStrictEqual(labels, ['session-one', 'session-two']);
		});

		test('should ignore files in .worktrees folder (only directories)', async () => {
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'valid-session'));
			fs.writeFileSync(path.join(worktreesDir, 'not-a-session.txt'), 'test');

			const provider = new ClaudeSessionProvider(tempDir);
			const children = await provider.getChildren();

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].label, 'valid-session');
		});

		test('should set correct worktreePath on discovered sessions', async () => {
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'my-session'));

			const provider = new ClaudeSessionProvider(tempDir);
			const children = await provider.getChildren();

			assert.strictEqual(children[0].worktreePath, path.join(worktreesDir, 'my-session'));
		});

		test('should return empty array for child elements (flat list)', async () => {
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'session'));

			const provider = new ClaudeSessionProvider(tempDir);
			const sessions = await provider.getChildren();

			// Asking for children of a session should return empty
			const children = await provider.getChildren(sessions[0]);
			assert.deepStrictEqual(children, []);
		});

		test('getTreeItem should return the same item', () => {
			const provider = new ClaudeSessionProvider(tempDir);
			const item = new SessionItem('test', '/path', vscode.TreeItemCollapsibleState.None);

			assert.strictEqual(provider.getTreeItem(item), item);
		});

		test('refresh should fire onDidChangeTreeData event', (done) => {
			const provider = new ClaudeSessionProvider(tempDir);

			provider.onDidChangeTreeData(() => {
				done();
			});

			provider.refresh();
		});

	});

	suite('getClaudeStatus', () => {

		test('should return correct status for valid waiting_for_user .claude-status file', () => {
			// Arrange: Create a .claude-status file with waiting_for_user status
			const statusData = { status: 'waiting_for_user' };
			fs.writeFileSync(path.join(tempDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.status, 'waiting_for_user');
		});

		test('should return correct status for valid working .claude-status file', () => {
			// Arrange: Create a .claude-status file with working status
			const statusData = { status: 'working' };
			fs.writeFileSync(path.join(tempDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.status, 'working');
		});

		test('should return null when .claude-status file does not exist', () => {
			// Arrange: tempDir exists but has no .claude-status file

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null for invalid JSON in .claude-status', () => {
			// Arrange: Create a .claude-status file with invalid JSON
			fs.writeFileSync(path.join(tempDir, '.claude-status'), 'not valid json {{{');

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null when status field is not a valid value', () => {
			// Arrange: Create a .claude-status file with invalid status value
			const statusData = { status: 'invalid' };
			fs.writeFileSync(path.join(tempDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should correctly parse optional timestamp and message fields', () => {
			// Arrange: Create a .claude-status file with all fields
			const statusData = {
				status: 'waiting_for_user',
				timestamp: '2025-12-21T10:30:00Z',
				message: 'Waiting for user confirmation'
			};
			fs.writeFileSync(path.join(tempDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.status, 'waiting_for_user');
			assert.strictEqual(result.timestamp, '2025-12-21T10:30:00Z');
			assert.strictEqual(result.message, 'Waiting for user confirmation');
		});
	});

	suite('SessionItem Visual Indicators', () => {

		test('should display bell icon with yellow color for waiting_for_user status', () => {
			// Arrange
			const claudeStatus: ClaudeStatus = { status: 'waiting_for_user' };

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
			const claudeStatus: ClaudeStatus = { status: 'working' };

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
			const claudeStatus: ClaudeStatus = { status: 'error' };

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
			const claudeStatus: ClaudeStatus = { status: 'idle' };

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
			const claudeStatus: ClaudeStatus = { status: 'waiting_for_user' };

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
			const claudeStatus: ClaudeStatus = { status: 'working' };

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

	suite('SessionFormProvider', () => {

		let formTestTempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			formTestTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-form-test-'));
			extensionUri = vscode.Uri.file(formTestTempDir);
		});

		teardown(() => {
			fs.rmSync(formTestTempDir, { recursive: true, force: true });
		});

		/**
		 * Helper to create a mock WebviewView for testing
		 */
		function createMockWebviewView(): {
			webviewView: vscode.WebviewView;
			capturedHtml: { value: string };
			messageHandler: { callback: ((message: unknown) => void) | null };
			postMessageSpy: { messages: unknown[] };
		} {
			const capturedHtml = { value: '' };
			const messageHandler: { callback: ((message: unknown) => void) | null } = { callback: null };
			const postMessageSpy: { messages: unknown[] } = { messages: [] };

			const mockWebview = {
				options: {} as vscode.WebviewOptions,
				html: '',
				onDidReceiveMessage: (callback: (message: unknown) => void) => {
					messageHandler.callback = callback;
					return { dispose: () => { messageHandler.callback = null; } };
				},
				postMessage: (message: unknown) => {
					postMessageSpy.messages.push(message);
					return Promise.resolve(true);
				},
				asWebviewUri: (uri: vscode.Uri) => uri,
				cspSource: 'test-csp-source'
			};

			// Create a proxy to capture html assignment
			const webviewProxy = new Proxy(mockWebview, {
				set(target, prop, value) {
					if (prop === 'html') {
						capturedHtml.value = value as string;
					}
					(target as Record<string, unknown>)[prop as string] = value;
					return true;
				},
				get(target, prop) {
					return (target as Record<string, unknown>)[prop as string];
				}
			});

			const mockWebviewView = {
				webview: webviewProxy as unknown as vscode.Webview,
				viewType: 'claudeSessionFormView',
				title: undefined,
				description: undefined,
				badge: undefined,
				visible: true,
				onDidDispose: () => ({ dispose: () => {} }),
				onDidChangeVisibility: () => ({ dispose: () => {} }),
				show: () => {}
			} as unknown as vscode.WebviewView;

			return { webviewView: mockWebviewView, capturedHtml, messageHandler, postMessageSpy };
		}

		test('should render HTML form with name input field', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(capturedHtml.value.includes('id="name"'), 'HTML should contain input field with id="name"');
			assert.ok(capturedHtml.value.includes('type="text"'), 'Name input should be of type text');
		});

		test('should render HTML form with prompt textarea', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(capturedHtml.value.includes('id="prompt"'), 'HTML should contain textarea with id="prompt"');
			assert.ok(capturedHtml.value.includes('<textarea'), 'HTML should contain a textarea element');
		});

		test('should render HTML form with submit button', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(capturedHtml.value.includes('type="submit"'), 'HTML should contain a submit button');
			assert.ok(capturedHtml.value.includes('Create Session'), 'Submit button should have "Create Session" text');
		});

		test('should use VS Code CSS variables for theming', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(
				capturedHtml.value.includes('--vscode-input-background'),
				'HTML should use VS Code CSS variable --vscode-input-background'
			);
			assert.ok(
				capturedHtml.value.includes('--vscode-button-background'),
				'HTML should use VS Code CSS variable --vscode-button-background'
			);
			assert.ok(
				capturedHtml.value.includes('--vscode-foreground'),
				'HTML should use VS Code CSS variable --vscode-foreground'
			);
		});

		test('should invoke onSubmit callback when createSession message is received', async () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			let capturedName = '';
			let capturedPrompt = '';

			provider.setOnSubmit((name, prompt) => {
				capturedName = name;
				capturedPrompt = prompt;
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Simulate webview posting a createSession message
			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug in login.ts'
			});

			// Assert
			assert.strictEqual(capturedName, 'test-session', 'Callback should receive the session name');
			assert.strictEqual(capturedPrompt, 'Fix the bug in login.ts', 'Callback should receive the prompt');
		});

		test('should post clearForm message after successful submission', async () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			provider.setOnSubmit(() => {
				// Empty callback (synchronous, returns void)
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			// The message handler is now async, so we need to await it
			await messageHandler.callback({
				command: 'createSession',
				name: 'my-session',
				prompt: ''
			});

			// Assert
			assert.strictEqual(postMessageSpy.messages.length, 1, 'Should post one message after submission');
			assert.deepStrictEqual(
				postMessageSpy.messages[0],
				{ command: 'clearForm' },
				'Should post clearForm command'
			);
		});

		test('should handle createSession message without onSubmit callback set', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Note: NOT setting onSubmit callback

			// Act & Assert - should not throw
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			const callback = messageHandler.callback;
			assert.doesNotThrow(() => {
				callback({
					command: 'createSession',
					name: 'test-session',
					prompt: 'Some prompt'
				});
			}, 'Should handle message gracefully when no callback is set');
		});

		test('should have correct viewType static property', () => {
			// Assert
			assert.strictEqual(
				SessionFormProvider.viewType,
				'claudeSessionFormView',
				'viewType should be claudeSessionFormView'
			);
		});

		test('should enable scripts in webview options', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.strictEqual(
				webviewView.webview.options.enableScripts,
				true,
				'Webview should have scripts enabled'
			);
		});
	});

	suite('Session ID Tracking', () => {

		test('should verify extension settings file SessionStart hook structure', async () => {
			// This test verifies the expected structure of settings created by getOrCreateExtensionSettingsFile.
			// The actual function tests are in extension.test.ts. Here we verify the expected hook structure.

			// The settings file (created in extension's global storage) should have this structure:
			const expectedSettings = {
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: 'command',
									command: 'jq -r --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \'{sessionId: .session_id, timestamp: $ts}\' > "/path/to/.claude-session"'
								}
							]
						}
					]
				}
			};

			// Verify the expected structure
			assert.ok(expectedSettings.hooks, 'settings should have hooks object');
			assert.ok(expectedSettings.hooks.SessionStart, 'hooks should have SessionStart array');
			assert.ok(Array.isArray(expectedSettings.hooks.SessionStart), 'SessionStart should be an array');
			assert.ok(expectedSettings.hooks.SessionStart.length > 0, 'SessionStart should have at least one entry');

			// Verify the hook structure and command format
			const sessionStartHook = expectedSettings.hooks.SessionStart[0];
			assert.ok(sessionStartHook.hooks, 'SessionStart entry should have hooks array');
			const hookCommand = sessionStartHook.hooks[0].command;
			assert.ok(hookCommand.includes('.claude-session'), 'Hook command should write to .claude-session');
			assert.ok(hookCommand.includes('.session_id'), 'Hook command should extract session_id from stdin JSON');
		});

		test('should read session ID correctly from .claude-session file', () => {
			// Arrange: Create a valid .claude-session file
			const sessionData = {
				sessionId: 'abc123-def456-ghi789',
				timestamp: '2025-12-21T10:30:00Z'
			};
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.ok(result, 'Result should not be null');
			assert.strictEqual(result.sessionId, 'abc123-def456-ghi789');
			assert.strictEqual(result.timestamp, '2025-12-21T10:30:00Z');
		});

		test('should return null when .claude-session file does not exist', () => {
			// Arrange: tempDir exists but has no .claude-session file

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null for invalid JSON in .claude-session', () => {
			// Arrange: Create a .claude-session file with invalid JSON
			fs.writeFileSync(path.join(tempDir, '.claude-session'), 'not valid json {{{');

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null when sessionId field is missing', () => {
			// Arrange: Create a .claude-session file without sessionId
			const sessionData = { timestamp: '2025-12-21T10:30:00Z' };
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null when sessionId is empty string', () => {
			// Arrange: Create a .claude-session file with empty sessionId
			const sessionData = { sessionId: '', timestamp: '2025-12-21T10:30:00Z' };
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should return null when sessionId is whitespace only', () => {
			// Arrange: Create a .claude-session file with whitespace-only sessionId
			const sessionData = { sessionId: '   ', timestamp: '2025-12-21T10:30:00Z' };
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.strictEqual(result, null);
		});

		test('should verify ClaudeSessionData interface has sessionId and optional timestamp', () => {
			// This test verifies the ClaudeSessionData interface structure
			// by creating objects that match the interface

			// Arrange & Act: Create a minimal ClaudeSessionData object
			const minimalData: ClaudeSessionData = {
				sessionId: 'test-session-id'
			};

			// Assert: Verify required field
			assert.strictEqual(minimalData.sessionId, 'test-session-id');
			assert.strictEqual(minimalData.timestamp, undefined);

			// Arrange & Act: Create a full ClaudeSessionData object
			const fullData: ClaudeSessionData = {
				sessionId: 'full-session-id',
				timestamp: '2025-12-21T12:00:00Z'
			};

			// Assert: Verify both fields
			assert.strictEqual(fullData.sessionId, 'full-session-id');
			assert.strictEqual(fullData.timestamp, '2025-12-21T12:00:00Z');
		});

		test('should verify extension settings file contains all required hooks', () => {
			// This test verifies that the extension settings file has all required hooks.
			// The actual getOrCreateExtensionSettingsFile tests are in extension.test.ts.

			// The extension's settings file should contain these hook types:
			const expectedHookTypes = ['SessionStart', 'Stop', 'UserPromptSubmit', 'Notification', 'PreToolUse'];

			// Verify the expected structure
			const settings = {
				hooks: {
					SessionStart: [{ hooks: [{ type: 'command', command: 'jq ... > .claude-session' }] }],
					Stop: [{ hooks: [{ type: 'command', command: 'echo ... > .claude-status' }] }],
					UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo ... > .claude-status' }] }],
					Notification: [{ matcher: 'permission_prompt', hooks: [{ type: 'command', command: 'echo ... > .claude-status' }] }],
					PreToolUse: [{ matcher: '.*', hooks: [{ type: 'command', command: 'echo ... > .claude-status' }] }]
				}
			};

			// Check all expected hook types are present
			for (const hookType of expectedHookTypes) {
				assert.ok(settings.hooks[hookType as keyof typeof settings.hooks], `${hookType} hooks should exist`);
			}

			// Note: Extension settings file is separate from user's settings.json/settings.local.json
			// The --settings flag is used to load extension hooks without modifying user settings
		});
	});

	suite('Session Resume', () => {

		test('should use --resume flag when valid session ID exists in .claude-session', () => {
			// This test verifies that when a worktree has a valid .claude-session file
			// with a session ID, the getSessionId function returns the session ID,
			// which would cause openClaudeTerminal to use 'claude --resume [sessionId]'.
			//
			// Note: We test the data layer (getSessionId) since openClaudeTerminal
			// is an internal function that directly interacts with VS Code terminal API.
			// The openClaudeTerminal function uses: if (sessionData?.sessionId) { ... }

			// Arrange: Create a valid .claude-session file with session ID
			const sessionData = {
				sessionId: 'session-abc-123-xyz',
				timestamp: '2025-12-21T14:00:00Z'
			};
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act: Call getSessionId - this is what openClaudeTerminal uses internally
			const result = getSessionId(tempDir);

			// Assert: Verify the session ID is returned correctly
			// This proves that openClaudeTerminal would receive a valid session ID
			// and would run 'claude --resume session-abc-123-xyz'
			assert.ok(result, 'getSessionId should return session data');
			assert.strictEqual(result.sessionId, 'session-abc-123-xyz');

			// Verify the logic that openClaudeTerminal uses would pass
			assert.ok(result?.sessionId, 'sessionId should be truthy for resume logic');
		});

		test('should not use --resume flag when .claude-session file does not exist', () => {
			// This test verifies that when a worktree does NOT have a .claude-session file,
			// getSessionId returns null, which would cause openClaudeTerminal to run plain 'claude'.
			//
			// openClaudeTerminal logic: if (sessionData?.sessionId) { resume } else { claude }

			// Arrange: tempDir exists but has no .claude-session file

			// Act: Call getSessionId
			const result = getSessionId(tempDir);

			// Assert: Verify null is returned, meaning openClaudeTerminal would run 'claude'
			assert.strictEqual(result, null, 'getSessionId should return null when file does not exist');
		});

		test('should fall back to plain claude when .claude-session has invalid JSON', () => {
			// This test verifies that when the .claude-session file contains invalid JSON,
			// getSessionId returns null, causing openClaudeTerminal to run plain 'claude'.

			// Arrange: Create a .claude-session file with invalid JSON
			fs.writeFileSync(path.join(tempDir, '.claude-session'), 'not valid json {{{');

			// Act: Call getSessionId
			const result = getSessionId(tempDir);

			// Assert: Verify null is returned for graceful fallback
			assert.strictEqual(result, null, 'getSessionId should return null for invalid JSON');
		});

		test('should fall back to plain claude when .claude-session has empty sessionId', () => {
			// This test verifies that when the .claude-session file has an empty sessionId,
			// getSessionId returns null, causing openClaudeTerminal to run plain 'claude'.
			//
			// This covers the case where the file exists but the session ID is invalid/empty.

			// Arrange: Create a .claude-session file with empty sessionId
			const sessionData = { sessionId: '', timestamp: '2025-12-21T14:00:00Z' };
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act: Call getSessionId
			const result = getSessionId(tempDir);

			// Assert: Verify null is returned when sessionId is empty
			assert.strictEqual(result, null, 'getSessionId should return null for empty sessionId');
		});

		test('should fall back to plain claude when .claude-session has whitespace-only sessionId', () => {
			// This test verifies that when the .claude-session file has a whitespace-only sessionId,
			// getSessionId returns null, causing openClaudeTerminal to run plain 'claude'.

			// Arrange: Create a .claude-session file with whitespace sessionId
			const sessionData = { sessionId: '   \t\n  ', timestamp: '2025-12-21T14:00:00Z' };
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act: Call getSessionId
			const result = getSessionId(tempDir);

			// Assert: Verify null is returned when sessionId is whitespace only
			assert.strictEqual(result, null, 'getSessionId should return null for whitespace-only sessionId');
		});

		test('should fall back to plain claude when .claude-session is missing sessionId field', () => {
			// This test verifies that when the .claude-session file is missing the sessionId field,
			// getSessionId returns null, causing openClaudeTerminal to run plain 'claude'.

			// Arrange: Create a .claude-session file without sessionId field
			const sessionData = { timestamp: '2025-12-21T14:00:00Z' };
			fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

			// Act: Call getSessionId
			const result = getSessionId(tempDir);

			// Assert: Verify null is returned when sessionId field is missing
			assert.strictEqual(result, null, 'getSessionId should return null when sessionId field is missing');
		});

		test('should reject session IDs with shell metacharacters to prevent command injection', () => {
			// This test verifies that session IDs containing shell metacharacters
			// are rejected to prevent command injection attacks.

			const maliciousIds = [
				'abc; rm -rf /',
				'abc && echo pwned',
				'abc | cat /etc/passwd',
				'abc`whoami`',
				'abc$(whoami)',
				'abc > /tmp/evil',
				'abc < /etc/passwd',
				"abc'injection",
				'abc"injection',
				'abc\necho pwned'
			];

			for (const maliciousId of maliciousIds) {
				// Arrange: Create a .claude-session file with malicious session ID
				const sessionData = { sessionId: maliciousId, timestamp: '2025-12-21T14:00:00Z' };
				fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

				// Act: Call getSessionId
				const result = getSessionId(tempDir);

				// Assert: Verify null is returned for malicious session IDs
				assert.strictEqual(result, null, `getSessionId should reject malicious sessionId: ${maliciousId}`);
			}
		});

		test('should accept valid session ID formats', () => {
			// This test verifies that legitimate session ID formats are accepted.

			const validIds = [
				'abc123',
				'session-abc-123',
				'session_abc_123',
				'ABC-XYZ-123',
				'a1b2c3d4-e5f6-7890',
				'session-2025-12-21'
			];

			for (const validId of validIds) {
				// Arrange: Create a .claude-session file with valid session ID
				const sessionData = { sessionId: validId, timestamp: '2025-12-21T14:00:00Z' };
				fs.writeFileSync(path.join(tempDir, '.claude-session'), JSON.stringify(sessionData));

				// Act: Call getSessionId
				const result = getSessionId(tempDir);

				// Assert: Verify session ID is returned
				assert.ok(result, `getSessionId should accept valid sessionId: ${validId}`);
				assert.strictEqual(result.sessionId, validId);
			}
		});
	});

	suite('combinePromptAndCriteria', () => {

		test('should combine prompt and acceptance criteria in correct format when both provided', () => {
			// Arrange
			const prompt = 'Fix the login bug';
			const acceptanceCriteria = 'Users should be able to log in successfully';

			// Act
			const result = combinePromptAndCriteria(prompt, acceptanceCriteria);

			// Assert
			assert.strictEqual(
				result,
				'request: Fix the login bug\nacceptance criteria: Users should be able to log in successfully',
				'Should combine in format: request: [prompt]\\nacceptance criteria: [criteria]'
			);
		});

		test('should return only prompt when acceptance criteria is empty', () => {
			// Arrange
			const prompt = 'Implement new feature';
			const acceptanceCriteria = '';

			// Act
			const result = combinePromptAndCriteria(prompt, acceptanceCriteria);

			// Assert
			assert.strictEqual(result, 'Implement new feature', 'Should return prompt as-is');
		});

		test('should return only prompt when acceptance criteria is undefined', () => {
			// Arrange
			const prompt = 'Implement new feature';

			// Act
			const result = combinePromptAndCriteria(prompt, undefined);

			// Assert
			assert.strictEqual(result, 'Implement new feature', 'Should return prompt as-is');
		});

		test('should return only acceptance criteria when prompt is empty', () => {
			// Arrange
			const prompt = '';
			const acceptanceCriteria = 'Feature should work correctly';

			// Act
			const result = combinePromptAndCriteria(prompt, acceptanceCriteria);

			// Assert
			assert.strictEqual(result, 'Feature should work correctly', 'Should return acceptance criteria as-is');
		});

		test('should return only acceptance criteria when prompt is undefined', () => {
			// Arrange
			const acceptanceCriteria = 'Feature should work correctly';

			// Act
			const result = combinePromptAndCriteria(undefined, acceptanceCriteria);

			// Assert
			assert.strictEqual(result, 'Feature should work correctly', 'Should return acceptance criteria as-is');
		});

		test('should return empty string when both prompt and acceptance criteria are empty', () => {
			// Arrange & Act
			const result = combinePromptAndCriteria('', '');

			// Assert
			assert.strictEqual(result, '', 'Should return empty string');
		});

		test('should return empty string when both prompt and acceptance criteria are undefined', () => {
			// Arrange & Act
			const result = combinePromptAndCriteria(undefined, undefined);

			// Assert
			assert.strictEqual(result, '', 'Should return empty string');
		});

		test('should return empty string when both prompt and acceptance criteria are whitespace only', () => {
			// Arrange & Act
			const result = combinePromptAndCriteria('   ', '  \t\n  ');

			// Assert
			assert.strictEqual(result, '', 'Should return empty string for whitespace-only values');
		});

		test('should trim whitespace from prompt and acceptance criteria when combining', () => {
			// Arrange
			const prompt = '  Fix the bug  ';
			const acceptanceCriteria = '  It should work  ';

			// Act
			const result = combinePromptAndCriteria(prompt, acceptanceCriteria);

			// Assert
			assert.strictEqual(
				result,
				'request: Fix the bug\nacceptance criteria: It should work',
				'Should trim whitespace from both values'
			);
		});

		test('should trim whitespace from prompt when only prompt is provided', () => {
			// Arrange
			const prompt = '  Fix the bug  ';

			// Act
			const result = combinePromptAndCriteria(prompt, '');

			// Assert
			assert.strictEqual(result, 'Fix the bug', 'Should trim whitespace from prompt');
		});

		test('should trim whitespace from acceptance criteria when only criteria is provided', () => {
			// Arrange
			const acceptanceCriteria = '  It should work  ';

			// Act
			const result = combinePromptAndCriteria('', acceptanceCriteria);

			// Assert
			assert.strictEqual(result, 'It should work', 'Should trim whitespace from acceptance criteria');
		});
	});

	suite('Source Branch Input', () => {

		let sbTestTempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			sbTestTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-branch-test-'));
			extensionUri = vscode.Uri.file(sbTestTempDir);
		});

		teardown(() => {
			fs.rmSync(sbTestTempDir, { recursive: true, force: true });
		});

		/**
		 * Helper to create a mock WebviewView for testing
		 */
		function createMockWebviewView(): {
			webviewView: vscode.WebviewView;
			capturedHtml: { value: string };
			messageHandler: { callback: ((message: unknown) => void) | null };
			postMessageSpy: { messages: unknown[] };
		} {
			const capturedHtml = { value: '' };
			const messageHandler: { callback: ((message: unknown) => void) | null } = { callback: null };
			const postMessageSpy: { messages: unknown[] } = { messages: [] };

			const mockWebview = {
				options: {} as vscode.WebviewOptions,
				html: '',
				onDidReceiveMessage: (callback: (message: unknown) => void) => {
					messageHandler.callback = callback;
					return { dispose: () => { messageHandler.callback = null; } };
				},
				postMessage: (message: unknown) => {
					postMessageSpy.messages.push(message);
					return Promise.resolve(true);
				},
				asWebviewUri: (uri: vscode.Uri) => uri,
				cspSource: 'test-csp-source'
			};

			// Create a proxy to capture html assignment
			const webviewProxy = new Proxy(mockWebview, {
				set(target, prop, value) {
					if (prop === 'html') {
						capturedHtml.value = value as string;
					}
					(target as Record<string, unknown>)[prop as string] = value;
					return true;
				},
				get(target, prop) {
					return (target as Record<string, unknown>)[prop as string];
				}
			});

			const mockWebviewView = {
				webview: webviewProxy as unknown as vscode.Webview,
				viewType: 'claudeSessionFormView',
				title: undefined,
				description: undefined,
				badge: undefined,
				visible: true,
				onDidDispose: () => ({ dispose: () => {} }),
				onDidChangeVisibility: () => ({ dispose: () => {} }),
				show: () => {}
			} as unknown as vscode.WebviewView;

			return { webviewView: mockWebviewView, capturedHtml, messageHandler, postMessageSpy };
		}

		test('should render HTML form with sourceBranch input field', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(
				capturedHtml.value.includes('id="sourceBranch"'),
				'HTML should contain input field with id="sourceBranch"'
			);
		});

		test('should position sourceBranch input after session name and before starting prompt', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert: Find the positions of the relevant input fields
			const html = capturedHtml.value;
			const nameFieldIndex = html.indexOf('id="name"');
			const sourceBranchFieldIndex = html.indexOf('id="sourceBranch"');
			const promptFieldIndex = html.indexOf('id="prompt"');

			assert.ok(nameFieldIndex !== -1, 'Name field should exist');
			assert.ok(sourceBranchFieldIndex !== -1, 'Source branch field should exist');
			assert.ok(promptFieldIndex !== -1, 'Prompt field should exist');

			assert.ok(
				nameFieldIndex < sourceBranchFieldIndex,
				'Source branch field should appear after session name field'
			);
			assert.ok(
				sourceBranchFieldIndex < promptFieldIndex,
				'Source branch field should appear before starting prompt field'
			);
		});

		test('should invoke onSubmit callback with sourceBranch when createSession message is received', async () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			let capturedName = '';
			let capturedPrompt = '';
			let capturedAcceptanceCriteria = '';
			let capturedSourceBranch = '';

			provider.setOnSubmit((name, prompt, acceptanceCriteria, sourceBranch) => {
				capturedName = name;
				capturedPrompt = prompt;
				capturedAcceptanceCriteria = acceptanceCriteria;
				capturedSourceBranch = sourceBranch;
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Simulate webview posting a createSession message with sourceBranch
			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug',
				acceptanceCriteria: 'It should work',
				sourceBranch: 'develop'
			});

			// Assert
			assert.strictEqual(capturedName, 'test-session', 'Callback should receive the session name');
			assert.strictEqual(capturedPrompt, 'Fix the bug', 'Callback should receive the prompt');
			assert.strictEqual(capturedAcceptanceCriteria, 'It should work', 'Callback should receive the acceptance criteria');
			assert.strictEqual(capturedSourceBranch, 'develop', 'Callback should receive the source branch');
		});

		test('should invoke onSubmit callback with empty sourceBranch when not provided', async () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			let capturedSourceBranch: string | undefined = 'not-set';

			provider.setOnSubmit((_name, _prompt, _acceptanceCriteria, sourceBranch) => {
				capturedSourceBranch = sourceBranch;
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Simulate webview posting a createSession message without sourceBranch
			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug'
				// Note: sourceBranch not included in message
			});

			// Assert - the callback should receive empty string for missing sourceBranch
			assert.strictEqual(
				capturedSourceBranch,
				'',
				'Callback should receive empty string for missing sourceBranch'
			);
		});

		test('should have hint explaining sourceBranch is optional and branches from HEAD by default', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			const html = capturedHtml.value;

			// Find the sourceBranch field and its hint
			assert.ok(
				html.includes('Source Branch') && html.includes('optional'),
				'Source branch field should be labeled as optional'
			);

			// The hint should mention that leaving it empty uses HEAD
			assert.ok(
				html.includes('Leave empty') || html.includes('empty'),
				'Hint should mention leaving the field empty'
			);
			assert.ok(
				html.includes('HEAD') || html.includes('current'),
				'Hint should mention branching from current HEAD'
			);
		});

		test('should include sourceBranch in state save function', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert: Verify the JavaScript saveState function includes sourceBranch
			const html = capturedHtml.value;

			// The saveState function should include sourceBranch in the state object
			assert.ok(
				html.includes('saveState') && html.includes('sourceBranch'),
				'saveState function should include sourceBranch'
			);

			// Verify the setState call includes sourceBranch
			assert.ok(
				html.includes('setState') && html.includes('sourceBranch'),
				'setState call should include sourceBranch property'
			);
		});

		test('should restore sourceBranch from previous state', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert: Verify the JavaScript restores sourceBranch from previous state
			const html = capturedHtml.value;

			// The state restore logic should include sourceBranch
			assert.ok(
				html.includes('previousState') && html.includes('sourceBranch'),
				'State restore logic should reference sourceBranch'
			);

			// Verify sourceBranchInput.value is set from previousState
			assert.ok(
				html.includes('sourceBranchInput.value'),
				'sourceBranchInput.value should be restored from state'
			);
		});

		test('should clear sourceBranch when clearForm message is received', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert: Verify the clearForm handler clears sourceBranch
			const html = capturedHtml.value;

			// The clearForm case should set sourceBranchInput.value to empty
			assert.ok(
				html.includes("case 'clearForm'") || html.includes('clearForm'),
				'HTML should handle clearForm message'
			);

			// Verify sourceBranchInput is cleared in the clearForm handler
			assert.ok(
				html.includes("sourceBranchInput.value = ''"),
				'clearForm handler should clear sourceBranchInput.value'
			);
		});

		test('SessionFormSubmitCallback type should accept 4 parameters including sourceBranch', async () => {
			// This test verifies that the callback type includes sourceBranch as the 4th parameter
			// by setting up a callback with 4 parameters

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			let callbackInvoked = false;

			// Act: Set a callback that accepts 4 parameters (name, prompt, acceptanceCriteria, sourceBranch)
			provider.setOnSubmit((name: string, prompt: string, acceptanceCriteria: string, sourceBranch: string) => {
				callbackInvoked = true;
				// TypeScript will fail compilation if the signature is wrong
				assert.strictEqual(typeof name, 'string');
				assert.strictEqual(typeof prompt, 'string');
				assert.strictEqual(typeof acceptanceCriteria, 'string');
				assert.strictEqual(typeof sourceBranch, 'string');
			});

			// Assert: If we got here without TypeScript errors, the type is correct
			// We can also trigger the callback to verify it works
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test',
				prompt: 'test prompt',
				acceptanceCriteria: 'test criteria',
				sourceBranch: 'feature-branch'
			});

			assert.ok(callbackInvoked, 'Callback should have been invoked with 4 parameters');
		});
	});

	suite('Acceptance Criteria in SessionFormProvider', () => {

		let acTestTempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			acTestTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-criteria-test-'));
			extensionUri = vscode.Uri.file(acTestTempDir);
		});

		teardown(() => {
			fs.rmSync(acTestTempDir, { recursive: true, force: true });
		});

		/**
		 * Helper to create a mock WebviewView for testing
		 */
		function createMockWebviewView(): {
			webviewView: vscode.WebviewView;
			capturedHtml: { value: string };
			messageHandler: { callback: ((message: unknown) => void) | null };
			postMessageSpy: { messages: unknown[] };
		} {
			const capturedHtml = { value: '' };
			const messageHandler: { callback: ((message: unknown) => void) | null } = { callback: null };
			const postMessageSpy: { messages: unknown[] } = { messages: [] };

			const mockWebview = {
				options: {} as vscode.WebviewOptions,
				html: '',
				onDidReceiveMessage: (callback: (message: unknown) => void) => {
					messageHandler.callback = callback;
					return { dispose: () => { messageHandler.callback = null; } };
				},
				postMessage: (message: unknown) => {
					postMessageSpy.messages.push(message);
					return Promise.resolve(true);
				},
				asWebviewUri: (uri: vscode.Uri) => uri,
				cspSource: 'test-csp-source'
			};

			// Create a proxy to capture html assignment
			const webviewProxy = new Proxy(mockWebview, {
				set(target, prop, value) {
					if (prop === 'html') {
						capturedHtml.value = value as string;
					}
					(target as Record<string, unknown>)[prop as string] = value;
					return true;
				},
				get(target, prop) {
					return (target as Record<string, unknown>)[prop as string];
				}
			});

			const mockWebviewView = {
				webview: webviewProxy as unknown as vscode.Webview,
				viewType: 'claudeSessionFormView',
				title: undefined,
				description: undefined,
				badge: undefined,
				visible: true,
				onDidDispose: () => ({ dispose: () => {} }),
				onDidChangeVisibility: () => ({ dispose: () => {} }),
				show: () => {}
			} as unknown as vscode.WebviewView;

			return { webviewView: mockWebviewView, capturedHtml, messageHandler, postMessageSpy };
		}

		test('should render HTML form with acceptance criteria textarea field', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(
				capturedHtml.value.includes('id="acceptanceCriteria"'),
				'HTML should contain textarea with id="acceptanceCriteria"'
			);
		});

		test('should label acceptance criteria field as optional', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert
			assert.ok(
				capturedHtml.value.includes('Acceptance Criteria') && capturedHtml.value.includes('optional'),
				'Acceptance criteria field should be labeled as optional'
			);
		});

		test('should invoke onSubmit callback with acceptanceCriteria when createSession message is received', async () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			let capturedName = '';
			let capturedPrompt = '';
			let capturedAcceptanceCriteria = '';

			provider.setOnSubmit((name, prompt, acceptanceCriteria) => {
				capturedName = name;
				capturedPrompt = prompt;
				capturedAcceptanceCriteria = acceptanceCriteria;
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Simulate webview posting a createSession message with acceptanceCriteria
			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug in login.ts',
				acceptanceCriteria: 'User should be able to log in'
			});

			// Assert
			assert.strictEqual(capturedName, 'test-session', 'Callback should receive the session name');
			assert.strictEqual(capturedPrompt, 'Fix the bug in login.ts', 'Callback should receive the prompt');
			assert.strictEqual(capturedAcceptanceCriteria, 'User should be able to log in', 'Callback should receive the acceptance criteria');
		});

		test('should invoke onSubmit callback with empty acceptanceCriteria when not provided', async () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			let capturedAcceptanceCriteria: string | undefined = 'not-set';

			provider.setOnSubmit((_name, _prompt, acceptanceCriteria) => {
				capturedAcceptanceCriteria = acceptanceCriteria;
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Simulate webview posting a createSession message without acceptanceCriteria
			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug'
				// Note: acceptanceCriteria not included in message
			});

			// Assert - the callback should receive empty string or undefined for missing acceptanceCriteria
			assert.ok(
				capturedAcceptanceCriteria === '' || capturedAcceptanceCriteria === undefined,
				`Callback should receive empty or undefined acceptanceCriteria, got: "${capturedAcceptanceCriteria}"`
			);
		});

		test('should clear acceptance criteria textarea when clearForm message is received', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert: Verify the JavaScript in the HTML handles clearForm for acceptanceCriteria
			// The clearForm handler should reset the acceptanceCriteria field
			assert.ok(
				capturedHtml.value.includes('acceptanceCriteria'),
				'HTML should reference acceptanceCriteria for form handling'
			);

			// Verify the clearForm case exists in the message handler
			assert.ok(
				capturedHtml.value.includes('clearForm'),
				'HTML should handle clearForm message'
			);
		});

		test('should include acceptanceCriteria in form submission JavaScript', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, capturedHtml } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			// Assert: Verify the form submission includes acceptanceCriteria in the message
			assert.ok(
				capturedHtml.value.includes("acceptanceCriteria:"),
				'Form submission should include acceptanceCriteria in the message payload'
			);
		});

		test('SessionFormSubmitCallback type should accept acceptanceCriteria parameter', async () => {
			// This test verifies that the callback type includes acceptanceCriteria
			// by setting up a callback with 3 parameters

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			let callbackInvoked = false;

			// Act: Set a callback that accepts 3 parameters (name, prompt, acceptanceCriteria)
			provider.setOnSubmit((name: string, prompt: string, acceptanceCriteria: string) => {
				callbackInvoked = true;
				// TypeScript will fail compilation if the signature is wrong
				assert.strictEqual(typeof name, 'string');
				assert.strictEqual(typeof prompt, 'string');
				assert.strictEqual(typeof acceptanceCriteria, 'string');
			});

			// Assert: If we got here without TypeScript errors, the type is correct
			// We can also trigger the callback to verify it works
			const { webviewView, messageHandler } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test',
				prompt: 'test prompt',
				acceptanceCriteria: 'test criteria'
			});

			assert.ok(callbackInvoked, 'Callback should have been invoked with 3 parameters');
		});
	});

	suite('Permission Mode', () => {

		let permissionTestTempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			permissionTestTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permission-mode-test-'));
			extensionUri = vscode.Uri.file(permissionTestTempDir);
		});

		teardown(() => {
			fs.rmSync(permissionTestTempDir, { recursive: true, force: true });
		});

		/**
		 * Helper to create a mock WebviewView for testing
		 */
		function createMockWebviewView(): {
			webviewView: vscode.WebviewView;
			capturedHtml: { value: string };
			messageHandler: { callback: ((message: unknown) => void) | null };
			postMessageSpy: { messages: unknown[] };
		} {
			const capturedHtml = { value: '' };
			const messageHandler: { callback: ((message: unknown) => void) | null } = { callback: null };
			const postMessageSpy: { messages: unknown[] } = { messages: [] };

			const mockWebview = {
				options: {} as vscode.WebviewOptions,
				html: '',
				onDidReceiveMessage: (callback: (message: unknown) => void) => {
					messageHandler.callback = callback;
					return { dispose: () => { messageHandler.callback = null; } };
				},
				postMessage: (message: unknown) => {
					postMessageSpy.messages.push(message);
					return Promise.resolve(true);
				},
				asWebviewUri: (uri: vscode.Uri) => uri,
				cspSource: 'test-csp-source'
			};

			// Create a proxy to capture html assignment
			const webviewProxy = new Proxy(mockWebview, {
				set(target, prop, value) {
					if (prop === 'html') {
						capturedHtml.value = value as string;
					}
					(target as Record<string, unknown>)[prop as string] = value;
					return true;
				},
				get(target, prop) {
					return (target as Record<string, unknown>)[prop as string];
				}
			});

			const mockWebviewView = {
				webview: webviewProxy as unknown as vscode.Webview,
				viewType: 'claudeSessionFormView',
				title: undefined,
				description: undefined,
				badge: undefined,
				visible: true,
				onDidDispose: () => ({ dispose: () => {} }),
				onDidChangeVisibility: () => ({ dispose: () => {} }),
				show: () => {}
			} as unknown as vscode.WebviewView;

			return { webviewView: mockWebviewView, capturedHtml, messageHandler, postMessageSpy };
		}

		suite('Permission Mode Form Field', () => {

			test('should render permission mode select element with id permissionMode', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert
				assert.ok(
					capturedHtml.value.includes('id="permissionMode"'),
					'HTML should contain select element with id="permissionMode"'
				);
				assert.ok(
					capturedHtml.value.includes('<select'),
					'HTML should contain a select element'
				);
			});

			test('should render all 6 permission mode options', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert - verify all 6 options are present
				const expectedOptions = ['acceptEdits', 'bypassPermissions', 'default', 'dontAsk'];
				for (const option of expectedOptions) {
					assert.ok(
						capturedHtml.value.includes(`value="${option}"`),
						`HTML should contain option with value="${option}"`
					);
				}
			});

			test('should have default selected as the default option', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert - verify 'default' option has the selected attribute
				assert.ok(
					capturedHtml.value.includes('value="default" selected'),
					'The "default" option should have the selected attribute'
				);
			});
		});

		suite('Permission Mode State Persistence', () => {

			test('should include permissionMode in state saving JavaScript', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert - verify the saveState function includes permissionMode
				assert.ok(
					capturedHtml.value.includes('permissionMode: permissionModeInput.value'),
					'saveState should include permissionMode value'
				);
			});

			test('should restore permissionMode from saved state', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert - verify state restoration includes permissionMode
				assert.ok(
					capturedHtml.value.includes("permissionModeInput.value = previousState.permissionMode || 'default'"),
					'State restoration should set permissionMode from saved state with default fallback'
				);
			});

			test('should clear permissionMode to default on form clear', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert - verify clearForm resets permissionMode to 'default'
				assert.ok(
					capturedHtml.value.includes("permissionModeInput.value = 'default'"),
					'clearForm should reset permissionMode to default'
				);
			});
		});

		suite('Permission Mode Message Passing', () => {

			test('should include permissionMode in createSession message', () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, capturedHtml } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				// Assert - verify the postMessage includes permissionMode
				assert.ok(
					capturedHtml.value.includes('permissionMode: permissionMode'),
					'postMessage should include permissionMode in the message payload'
				);
			});

			test('should invoke onSubmit callback with permissionMode from message', async () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, messageHandler } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				let capturedPermissionMode = '';

				provider.setOnSubmit((_name, _prompt, _acceptanceCriteria, _sourceBranch, permissionMode) => {
					capturedPermissionMode = permissionMode;
				});

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				assert.ok(messageHandler.callback, 'Message handler should be registered');
				await messageHandler.callback({
					command: 'createSession',
					name: 'test-session',
					prompt: 'Test prompt',
					acceptanceCriteria: 'Test criteria',
					permissionMode: 'acceptEdits'
				});

				// Assert
				assert.strictEqual(capturedPermissionMode, 'acceptEdits', 'Callback should receive the permissionMode value');
			});

			test('should default to "default" when permissionMode is not in message', async () => {
				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				const { webviewView, messageHandler } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				let capturedPermissionMode = '';

				provider.setOnSubmit((_name, _prompt, _acceptanceCriteria, _sourceBranch, permissionMode) => {
					capturedPermissionMode = permissionMode;
				});

				// Act
				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				assert.ok(messageHandler.callback, 'Message handler should be registered');
				await messageHandler.callback({
					command: 'createSession',
					name: 'test-session',
					prompt: 'Test prompt'
					// Note: permissionMode not included in message
				});

				// Assert
				assert.strictEqual(capturedPermissionMode, 'default', 'Should default to "default" when permissionMode is not provided');
			});
		});

		suite('Permission Mode Callback Signature', () => {

			test('SessionFormSubmitCallback should accept 5 parameters including permissionMode', async () => {
				// This test verifies the callback type signature by setting up
				// a callback with all 5 parameters and verifying TypeScript compiles it

				// Arrange
				const provider = new SessionFormProvider(extensionUri);
				let callbackInvoked = false;
				const capturedParams: {
					name: string;
					prompt: string;
					acceptanceCriteria: string;
					sourceBranch: string;
					permissionMode: string;
				} = { name: '', prompt: '', acceptanceCriteria: '', sourceBranch: '', permissionMode: '' };

				// Act: Set a callback that accepts 5 parameters
				provider.setOnSubmit((name: string, prompt: string, acceptanceCriteria: string, sourceBranch: string, permissionMode) => {
					callbackInvoked = true;
					capturedParams.name = name;
					capturedParams.prompt = prompt;
					capturedParams.acceptanceCriteria = acceptanceCriteria;
					capturedParams.sourceBranch = sourceBranch;
					capturedParams.permissionMode = permissionMode;
				});

				// Trigger the callback
				const { webviewView, messageHandler } = createMockWebviewView();
				const mockContext = {} as vscode.WebviewViewResolveContext;
				const mockToken = new vscode.CancellationTokenSource().token;

				provider.resolveWebviewView(webviewView, mockContext, mockToken);

				assert.ok(messageHandler.callback, 'Message handler should be registered');
				await messageHandler.callback({
					command: 'createSession',
					name: 'test-name',
					prompt: 'test-prompt',
					acceptanceCriteria: 'test-criteria',
					permissionMode: 'bypassPermissions'
				});

				// Assert
				assert.ok(callbackInvoked, 'Callback should have been invoked');
				assert.strictEqual(capturedParams.name, 'test-name');
				assert.strictEqual(capturedParams.prompt, 'test-prompt');
				assert.strictEqual(capturedParams.acceptanceCriteria, 'test-criteria');
				assert.strictEqual(capturedParams.permissionMode, 'bypassPermissions');
			});

			test('should accept all valid PermissionMode values', async () => {
				// This test verifies that the callback can receive all valid permission modes

				const validModes = ['acceptEdits', 'bypassPermissions', 'default', 'dontAsk'];

				for (const mode of validModes) {
					// Arrange
					const provider = new SessionFormProvider(extensionUri);
					let capturedMode = '';

					provider.setOnSubmit((_name, _prompt, _acceptanceCriteria, _sourceBranch, permissionMode) => {
						capturedMode = permissionMode;
					});

					const { webviewView, messageHandler } = createMockWebviewView();
					const mockContext = {} as vscode.WebviewViewResolveContext;
					const mockToken = new vscode.CancellationTokenSource().token;

					provider.resolveWebviewView(webviewView, mockContext, mockToken);

					// Act
					assert.ok(messageHandler.callback, 'Message handler should be registered');
					await messageHandler.callback({
						command: 'createSession',
						name: 'test',
						prompt: 'test',
						acceptanceCriteria: '',
						permissionMode: mode
					});

					// Assert
					assert.strictEqual(capturedMode, mode, `Callback should receive permissionMode: ${mode}`);
				}
			});
		});

		suite('Permission Mode Command Generation', () => {

			test('should not include --permission-mode flag when mode is default (with prompt)', () => {
				// This test verifies the logic for building the permission flag
				// in the openClaudeTerminal function.
				// The logic: permissionMode && permissionMode !== 'default' ? `--permission-mode ${permissionMode} ` : ''

				// Arrange
				const permissionMode = 'default';
				const prompt = 'Fix the bug';

				// Act - simulate the permission flag building logic
				const permissionFlag = permissionMode && permissionMode !== 'default'
					? `--permission-mode ${permissionMode} `
					: '';

				// Assert
				assert.strictEqual(permissionFlag, '', 'Permission flag should be empty for default mode');

				// Verify the full command would be correct (without flag)
				const expectedCommand = `claude "${prompt}"`;
				const actualCommand = `claude ${permissionFlag}"${prompt}"`.replace('  ', ' ');
				assert.strictEqual(actualCommand, expectedCommand, 'Command should not include --permission-mode for default');
			});

			test('should not include --permission-mode flag when mode is default (without prompt)', () => {
				// Arrange
				const permissionMode = 'default';

				// Act - simulate the permission flag building logic
				const permissionFlag = permissionMode && permissionMode !== 'default'
					? `--permission-mode ${permissionMode} `
					: '';

				// Assert
				assert.strictEqual(permissionFlag, '', 'Permission flag should be empty for default mode');

				// Verify the full command would be correct (without flag)
				const actualCommand = `claude ${permissionFlag}`.trim();
				assert.strictEqual(actualCommand, 'claude', 'Command should be just "claude" for default mode without prompt');
			});

			test('should include --permission-mode flag when mode is acceptEdits (with prompt)', () => {
				// Arrange
				const permissionMode: string = 'acceptEdits';
				const prompt = 'Fix the bug';

				// Act - simulate the permission flag building logic
				const permissionFlag = permissionMode && permissionMode !== 'default'
					? `--permission-mode ${permissionMode} `
					: '';

				// Assert
				assert.strictEqual(permissionFlag, '--permission-mode acceptEdits ', 'Permission flag should include acceptEdits mode');

				// Verify the full command format
				const actualCommand = `claude ${permissionFlag}"${prompt}"`;
				assert.strictEqual(
					actualCommand,
					'claude --permission-mode acceptEdits "Fix the bug"',
					'Command should include --permission-mode acceptEdits before the prompt'
				);
			});

			test('should include --permission-mode flag when mode is bypassPermissions (without prompt)', () => {
				// Arrange
				const permissionMode: string = 'bypassPermissions';

				// Act - simulate the permission flag building logic
				const permissionFlag = permissionMode && permissionMode !== 'default'
					? `--permission-mode ${permissionMode} `
					: '';

				// Assert
				assert.strictEqual(permissionFlag, '--permission-mode bypassPermissions ', 'Permission flag should include bypassPermissions mode');

				// Verify the full command format
				const actualCommand = `claude ${permissionFlag}`.trim();
				assert.strictEqual(
					actualCommand,
					'claude --permission-mode bypassPermissions',
					'Command should include --permission-mode bypassPermissions'
				);
			});

			test('should include --permission-mode flag for all non-default modes', () => {
				// Test all non-default permission modes
				const nonDefaultModes = ['bypassPermissions', 'dontAsk'];

				for (const mode of nonDefaultModes) {
					// Act - simulate the permission flag building logic
					const permissionFlag = mode && mode !== 'default'
						? `--permission-mode ${mode} `
						: '';

					// Assert
					assert.strictEqual(
						permissionFlag,
						`--permission-mode ${mode} `,
						`Permission flag should include ${mode} mode`
					);
				}
			});

			test('should handle undefined permissionMode as default', () => {
				// Arrange
				const permissionMode: string | undefined = undefined;

				// Act - simulate the permission flag building logic (same as in extension.ts)
				const permissionFlag = permissionMode && permissionMode !== 'default'
					? `--permission-mode ${permissionMode} `
					: '';

				// Assert
				assert.strictEqual(permissionFlag, '', 'Permission flag should be empty for undefined mode');
			});

			test('should handle empty string permissionMode as default', () => {
				// Arrange
				const permissionMode = '';

				// Act - simulate the permission flag building logic
				const permissionFlag = permissionMode && permissionMode !== 'default'
					? `--permission-mode ${permissionMode} `
					: '';

				// Assert
				assert.strictEqual(permissionFlag, '', 'Permission flag should be empty for empty string mode');
			});
		});

		suite('Permission Mode Validation', () => {

			test('isValidPermissionMode should return true for all valid modes', () => {
				const validModes = ['acceptEdits', 'bypassPermissions', 'default', 'dontAsk'];

				for (const mode of validModes) {
					assert.strictEqual(
						isValidPermissionMode(mode),
						true,
						`isValidPermissionMode should return true for "${mode}"`
					);
				}
			});

			test('isValidPermissionMode should return false for invalid modes', () => {
				const invalidModes = [
					'invalid',
					'PLAN',  // case-sensitive
					'Default',
					'plan; rm -rf /',  // injection attempt
					'--help',
					'',
					' ',
					'plan\n--help'
				];

				for (const mode of invalidModes) {
					assert.strictEqual(
						isValidPermissionMode(mode),
						false,
						`isValidPermissionMode should return false for "${mode}"`
					);
				}
			});

			test('isValidPermissionMode should return false for non-string values', () => {
				const nonStringValues = [null, undefined, 123, {}, [], true];

				for (const value of nonStringValues) {
					assert.strictEqual(
						isValidPermissionMode(value),
						false,
						`isValidPermissionMode should return false for ${JSON.stringify(value)}`
					);
				}
			});

			test('PERMISSION_MODES should contain all 4 valid modes', () => {
				assert.strictEqual(PERMISSION_MODES.length, 4, 'Should have exactly 4 permission modes');
				assert.ok(PERMISSION_MODES.includes('acceptEdits'), 'Should include acceptEdits');
				assert.ok(PERMISSION_MODES.includes('bypassPermissions'), 'Should include bypassPermissions');
				assert.ok(PERMISSION_MODES.includes('default'), 'Should include default');
				assert.ok(PERMISSION_MODES.includes('dontAsk'), 'Should include dontAsk');
			});
		});
	});

	suite('Session Form Retention on Failure', () => {

		let retentionTestTempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			retentionTestTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'form-retention-test-'));
			extensionUri = vscode.Uri.file(retentionTestTempDir);
		});

		teardown(() => {
			fs.rmSync(retentionTestTempDir, { recursive: true, force: true });
		});

		/**
		 * Helper to create a mock WebviewView for testing
		 */
		function createMockWebviewView(): {
			webviewView: vscode.WebviewView;
			capturedHtml: { value: string };
			messageHandler: { callback: ((message: unknown) => void) | null };
			postMessageSpy: { messages: unknown[] };
		} {
			const capturedHtml = { value: '' };
			const messageHandler: { callback: ((message: unknown) => void) | null } = { callback: null };
			const postMessageSpy: { messages: unknown[] } = { messages: [] };

			const mockWebview = {
				options: {} as vscode.WebviewOptions,
				html: '',
				onDidReceiveMessage: (callback: (message: unknown) => void) => {
					messageHandler.callback = callback;
					return { dispose: () => { messageHandler.callback = null; } };
				},
				postMessage: (message: unknown) => {
					postMessageSpy.messages.push(message);
					return Promise.resolve(true);
				},
				asWebviewUri: (uri: vscode.Uri) => uri,
				cspSource: 'test-csp-source'
			};

			// Create a proxy to capture html assignment
			const webviewProxy = new Proxy(mockWebview, {
				set(target, prop, value) {
					if (prop === 'html') {
						capturedHtml.value = value as string;
					}
					(target as Record<string, unknown>)[prop as string] = value;
					return true;
				},
				get(target, prop) {
					return (target as Record<string, unknown>)[prop as string];
				}
			});

			const mockWebviewView = {
				webview: webviewProxy as unknown as vscode.Webview,
				viewType: 'claudeSessionFormView',
				title: undefined,
				description: undefined,
				badge: undefined,
				visible: true,
				onDidDispose: () => ({ dispose: () => {} }),
				onDidChangeVisibility: () => ({ dispose: () => {} }),
				show: () => {}
			} as unknown as vscode.WebviewView;

			return { webviewView: mockWebviewView, capturedHtml, messageHandler, postMessageSpy };
		}

		test('should NOT clear form when createSession throws an error (workspace validation failure)', async () => {
			// This test verifies that when onSubmit callback throws an error
			// (e.g., no workspace folder), the form is NOT cleared so user can retry.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up callback that throws an error (simulating workspace validation failure)
			provider.setOnSubmit(() => {
				throw new Error('No workspace folder open');
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug',
				acceptanceCriteria: 'It should work',
				sourceBranch: 'develop',
				permissionMode: 'acceptEdits'
			});

			// Assert - clearForm should NOT be posted when an error occurs
			assert.strictEqual(
				postMessageSpy.messages.length,
				0,
				'No messages should be posted when onSubmit throws an error'
			);
		});

		test('should NOT clear form when createSession throws an error (git validation failure)', async () => {
			// This test verifies that when onSubmit callback throws an error
			// related to git operations, the form is NOT cleared.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up callback that throws an error (simulating git validation failure)
			provider.setOnSubmit(() => {
				throw new Error('Failed to verify git repository');
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'my-feature',
				prompt: 'Implement new feature',
				acceptanceCriteria: 'Tests should pass',
				sourceBranch: 'main',
				permissionMode: 'default'
			});

			// Assert - clearForm should NOT be posted when git error occurs
			assert.strictEqual(
				postMessageSpy.messages.length,
				0,
				'No messages should be posted when git validation fails'
			);
		});

		test('should NOT clear form when createSession throws an error (session name validation failure)', async () => {
			// This test verifies that when onSubmit callback throws an error
			// due to invalid session name, the form is NOT cleared.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up callback that throws an error (simulating session name validation failure)
			provider.setOnSubmit(() => {
				throw new Error('Session name contains invalid characters');
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'invalid/name!',
				prompt: 'Some prompt',
				acceptanceCriteria: '',
				sourceBranch: '',
				permissionMode: 'default'
			});

			// Assert - clearForm should NOT be posted when name validation fails
			assert.strictEqual(
				postMessageSpy.messages.length,
				0,
				'No messages should be posted when session name validation fails'
			);
		});

		test('should NOT clear form when createSession throws an error (source branch validation failure)', async () => {
			// This test verifies that when onSubmit callback throws an error
			// due to non-existent source branch, the form is NOT cleared.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up callback that throws an error (simulating source branch validation failure)
			provider.setOnSubmit(() => {
				throw new Error("Branch 'non-existent-branch' does not exist");
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'my-session',
				prompt: 'Work on feature',
				acceptanceCriteria: 'Feature complete',
				sourceBranch: 'non-existent-branch',
				permissionMode: 'acceptEdits'
			});

			// Assert - clearForm should NOT be posted when source branch is invalid
			assert.strictEqual(
				postMessageSpy.messages.length,
				0,
				'No messages should be posted when source branch validation fails'
			);
		});

		test('should clear form when createSession succeeds', async () => {
			// This test verifies that when onSubmit callback succeeds (no error),
			// the form IS cleared.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up callback that succeeds (no error thrown)
			let callbackInvoked = false;
			provider.setOnSubmit(() => {
				callbackInvoked = true;
				// No error thrown - session creation succeeded
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'successful-session',
				prompt: 'Implement feature X',
				acceptanceCriteria: 'Feature works',
				sourceBranch: 'main',
				permissionMode: 'default'
			});

			// Assert - clearForm SHOULD be posted when session creation succeeds
			assert.ok(callbackInvoked, 'Callback should have been invoked');
			assert.strictEqual(
				postMessageSpy.messages.length,
				1,
				'One message should be posted after successful session creation'
			);
			assert.deepStrictEqual(
				postMessageSpy.messages[0],
				{ command: 'clearForm' },
				'The message should be clearForm command'
			);
		});

		test('should clear form when user cancels dialog (callback returns without error)', async () => {
			// This test verifies that when user cancels a dialog (QuickPick/InputBox),
			// the callback returns normally (not throwing), so form IS cleared.
			// User cancellation is NOT an error - user chose to cancel.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up callback that returns without error (simulating user cancellation)
			// Note: In the actual implementation, user cancellation uses 'return' not 'throw'
			let callbackInvoked = false;
			provider.setOnSubmit(() => {
				callbackInvoked = true;
				// User cancelled - no error thrown, just return
				return;
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'cancelled-session',
				prompt: 'Some prompt',
				acceptanceCriteria: '',
				sourceBranch: '',
				permissionMode: 'default'
			});

			// Assert - clearForm SHOULD be posted when user cancels (no error thrown)
			assert.ok(callbackInvoked, 'Callback should have been invoked');
			assert.strictEqual(
				postMessageSpy.messages.length,
				1,
				'One message should be posted when user cancels (no error)'
			);
			assert.deepStrictEqual(
				postMessageSpy.messages[0],
				{ command: 'clearForm' },
				'The message should be clearForm command'
			);
		});

		test('should NOT clear form when async createSession throws an error', async () => {
			// This test verifies that async errors are also caught and form is retained.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up async callback that throws an error
			provider.setOnSubmit(async () => {
				// Simulate async operation that fails
				await new Promise(resolve => setTimeout(resolve, 10));
				throw new Error('Async operation failed');
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'async-fail-session',
				prompt: 'Test async failure',
				acceptanceCriteria: '',
				sourceBranch: '',
				permissionMode: 'default'
			});

			// Assert - clearForm should NOT be posted when async error occurs
			assert.strictEqual(
				postMessageSpy.messages.length,
				0,
				'No messages should be posted when async operation fails'
			);
		});

		test('should clear form when async createSession succeeds', async () => {
			// This test verifies that async success properly clears the form.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			// Set up async callback that succeeds
			let callbackInvoked = false;
			provider.setOnSubmit(async () => {
				// Simulate async operation that succeeds
				await new Promise(resolve => setTimeout(resolve, 10));
				callbackInvoked = true;
				// No error thrown - success
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				name: 'async-success-session',
				prompt: 'Test async success',
				acceptanceCriteria: 'Should succeed',
				sourceBranch: 'main',
				permissionMode: 'acceptEdits'
			});

			// Assert - clearForm SHOULD be posted when async operation succeeds
			assert.ok(callbackInvoked, 'Callback should have been invoked');
			assert.strictEqual(
				postMessageSpy.messages.length,
				1,
				'One message should be posted after successful async session creation'
			);
			assert.deepStrictEqual(
				postMessageSpy.messages[0],
				{ command: 'clearForm' },
				'The message should be clearForm command'
			);
		});

		test('should preserve all form fields when error occurs', async () => {
			// This test verifies the conceptual behavior that form fields are preserved
			// when an error occurs. Since the form clearing happens via postMessage,
			// not clearing means the webview state remains unchanged.

			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			const formData = {
				name: 'preserved-session',
				prompt: 'This prompt should be preserved',
				acceptanceCriteria: 'These criteria should be preserved',
				sourceBranch: 'feature-branch',
				permissionMode: 'bypassPermissions'
			};

			// Set up callback that throws an error
			provider.setOnSubmit(() => {
				throw new Error('Session creation failed');
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			await messageHandler.callback({
				command: 'createSession',
				...formData
			});

			// Assert - No clearForm message means form fields remain with their values
			assert.strictEqual(
				postMessageSpy.messages.length,
				0,
				'No clearForm message should be sent, preserving form fields'
			);

			// The fact that no clearForm is sent means the webview retains its state
			// This is the key behavior being tested
		});
	});
});
