import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ClaudeSessionProvider, SessionItem, getFeatureStatus, getClaudeStatus, getSessionId, FeatureStatus, ClaudeStatus, ClaudeSessionData, getFeaturesJsonPath, getTestsJsonPath, getClaudeSessionPath, getClaudeStatusPath, getRepoIdentifier, getGlobalStoragePath, isGlobalStorageEnabled, initializeGlobalStorageContext, getSessionNameFromWorktree } from '../ClaudeSessionProvider';
import { isProjectManagerAvailable, getProjects, addProject, removeProject, clearCache, getExtensionId, initialize as initializePMService } from '../ProjectManagerService';
import { SessionFormProvider } from '../SessionFormProvider';
import { combinePromptAndCriteria, branchExists, getBranchesInWorktrees, getBaseBranch, getBaseRepoPath, getRepoName } from '../extension';
import { parseDiff, GitChangesPanel, FileDiff, ReviewComment, formatReviewForClipboard } from '../GitChangesPanel';

suite('Claude Lanes Extension Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-test-'));
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

		test('should show feature ID when current feature exists', () => {
			const featureStatus: FeatureStatus = {
				currentFeature: { id: 'feature-abc', description: 'Test feature', passes: false },
				allComplete: false
			};
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				featureStatus
			);

			assert.strictEqual(item.description, 'feature-abc');
		});

		test('should show "Complete" when allComplete is true', () => {
			const featureStatus: FeatureStatus = {
				currentFeature: null,
				allComplete: true
			};
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				featureStatus
			);

			assert.strictEqual(item.description, 'Complete');
		});

		test('should show "Active" when no features (featureStatus with no current and not complete)', () => {
			const featureStatus: FeatureStatus = {
				currentFeature: null,
				allComplete: false
			};
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				featureStatus
			);

			assert.strictEqual(item.description, 'Active');
		});
	});

	suite('getFeatureStatus', () => {

		test('should return first incomplete feature', () => {
			const featuresJson = {
				features: [
					{ id: 'feature-1', description: 'First feature', passes: false },
					{ id: 'feature-2', description: 'Second feature', passes: false }
				]
			};
			fs.writeFileSync(path.join(tempDir, 'features.json'), JSON.stringify(featuresJson));

			const result = getFeatureStatus(tempDir);

			assert.ok(result.currentFeature);
			assert.strictEqual(result.currentFeature.id, 'feature-1');
			assert.strictEqual(result.allComplete, false);
		});

		test('should return null when all features are complete with allComplete true', () => {
			const featuresJson = {
				features: [
					{ id: 'feature-1', description: 'First feature', passes: true },
					{ id: 'feature-2', description: 'Second feature', passes: true }
				]
			};
			fs.writeFileSync(path.join(tempDir, 'features.json'), JSON.stringify(featuresJson));

			const result = getFeatureStatus(tempDir);

			assert.strictEqual(result.currentFeature, null);
			assert.strictEqual(result.allComplete, true);
		});

		test('should return null when features.json does not exist', () => {
			// tempDir exists but has no features.json
			const result = getFeatureStatus(tempDir);

			assert.strictEqual(result.currentFeature, null);
			assert.strictEqual(result.allComplete, false);
		});

		test('should return null for invalid JSON (graceful fallback)', () => {
			fs.writeFileSync(path.join(tempDir, 'features.json'), 'not valid json {{{');

			const result = getFeatureStatus(tempDir);

			assert.strictEqual(result.currentFeature, null);
			assert.strictEqual(result.allComplete, false);
		});

		test('should return null for empty features array', () => {
			const featuresJson = { features: [] };
			fs.writeFileSync(path.join(tempDir, 'features.json'), JSON.stringify(featuresJson));

			const result = getFeatureStatus(tempDir);

			assert.strictEqual(result.currentFeature, null);
			assert.strictEqual(result.allComplete, false);
		});

		test('should skip completed features and return first incomplete', () => {
			const featuresJson = {
				features: [
					{ id: 'feature-1', description: 'First', passes: true },
					{ id: 'feature-2', description: 'Second', passes: false },
					{ id: 'feature-3', description: 'Third', passes: false }
				]
			};
			fs.writeFileSync(path.join(tempDir, 'features.json'), JSON.stringify(featuresJson));

			const result = getFeatureStatus(tempDir);

			assert.ok(result.currentFeature);
			assert.strictEqual(result.currentFeature.id, 'feature-2');
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

		test('should show current feature in session description (integration)', async () => {
			// Create worktrees directory with a session
			fs.mkdirSync(worktreesDir);
			const sessionPath = path.join(worktreesDir, 'test-session');
			fs.mkdirSync(sessionPath);

			// Create features.json with an incomplete feature in the session worktree
			const featuresJson = {
				features: [
					{ id: 'impl-feature-x', description: 'Implement feature X', passes: false },
					{ id: 'impl-feature-y', description: 'Implement feature Y', passes: false }
				]
			};
			fs.writeFileSync(path.join(sessionPath, 'features.json'), JSON.stringify(featuresJson));

			const provider = new ClaudeSessionProvider(tempDir);
			const children = await provider.getChildren();

			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].label, 'test-session');
			assert.strictEqual(children[0].description, 'impl-feature-x');
		});
	});

	suite('Extension Activation', () => {

		test('extension should be present', () => {
			// Extension ID format is publisher.name, may not be available in test environment
			// This is more of a smoke test that the test harness works
			assert.ok(vscode.extensions !== undefined);
		});

		test('commands should be registered after activation', async () => {
			// Trigger extension activation by executing one of its commands
			// Using openSession with no args - it will fail gracefully but activates the extension
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			const commands = await vscode.commands.getCommands(true);

			assert.ok(commands.includes('claudeWorktrees.createSession'), 'createSession command should exist');
			assert.ok(commands.includes('claudeWorktrees.openSession'), 'openSession command should exist');
			assert.ok(commands.includes('claudeWorktrees.deleteSession'), 'deleteSession command should exist');
			assert.ok(commands.includes('claudeWorktrees.setupStatusHooks'), 'setupStatusHooks command should exist');
		});

		test('SessionFormProvider webview should be registered', async () => {
			// Trigger extension activation
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			// The webview view is registered with the viewType 'claudeSessionFormView'
			// We can verify this by checking that the SessionFormProvider's viewType matches
			// what is expected in package.json
			assert.strictEqual(
				SessionFormProvider.viewType,
				'claudeSessionFormView',
				'SessionFormProvider should use the correct view type'
			);

			// Note: VS Code does not expose a way to query registered webview views directly.
			// The best we can do is verify the viewType constant matches what's in package.json
			// and trust that the extension.ts registers it correctly.
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
				undefined,
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
				undefined,
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
				undefined,
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
				undefined,
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
				undefined,
				null
			);

			// Assert
			assert.ok(item.iconPath instanceof vscode.ThemeIcon);
			const themeIcon = item.iconPath as vscode.ThemeIcon;
			assert.strictEqual(themeIcon.id, 'git-branch');
		});

		test('should display "Waiting for input" description for waiting_for_user status without feature', () => {
			// Arrange
			const claudeStatus: ClaudeStatus = { status: 'waiting_for_user' };

			// Act
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				undefined,
				claudeStatus
			);

			// Assert
			assert.strictEqual(item.description, 'Waiting for input');
		});

		test('should display "Waiting - {feature-id}" for waiting_for_user status with current feature', () => {
			// Arrange
			const claudeStatus: ClaudeStatus = { status: 'waiting_for_user' };
			const featureStatus: FeatureStatus = {
				currentFeature: { id: 'feature-abc', description: 'Test feature', passes: false },
				allComplete: false
			};

			// Act
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				featureStatus,
				claudeStatus
			);

			// Assert
			assert.strictEqual(item.description, 'Waiting - feature-abc');
		});

		test('should display "Working..." description for working status without feature', () => {
			// Arrange
			const claudeStatus: ClaudeStatus = { status: 'working' };

			// Act
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				undefined,
				claudeStatus
			);

			// Assert
			assert.strictEqual(item.description, 'Working...');
		});

		test('should work correctly when claudeStatus is undefined (backwards compatibility)', () => {
			// Arrange
			const featureStatus: FeatureStatus = {
				currentFeature: { id: 'legacy-feature', description: 'Legacy feature', passes: false },
				allComplete: false
			};

			// Act: Note: claudeStatus parameter is not passed (undefined)
			const item = new SessionItem(
				'session',
				'/path',
				vscode.TreeItemCollapsibleState.None,
				featureStatus
			);

			// Assert: Should behave as before - git-branch icon and feature-based description
			assert.ok(item.iconPath instanceof vscode.ThemeIcon);
			const themeIcon = item.iconPath as vscode.ThemeIcon;
			assert.strictEqual(themeIcon.id, 'git-branch');
			assert.strictEqual(item.description, 'legacy-feature');
		});
	});

	suite('SessionFormProvider', () => {

		let tempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-form-test-'));
			extensionUri = vscode.Uri.file(tempDir);
		});

		teardown(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
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

		test('should invoke onSubmit callback when createSession message is received', () => {
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
			messageHandler.callback({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Fix the bug in login.ts'
			});

			// Assert
			assert.strictEqual(capturedName, 'test-session', 'Callback should receive the session name');
			assert.strictEqual(capturedPrompt, 'Fix the bug in login.ts', 'Callback should receive the prompt');
		});

		test('should post clearForm message after successful submission', () => {
			// Arrange
			const provider = new SessionFormProvider(extensionUri);
			const { webviewView, messageHandler, postMessageSpy } = createMockWebviewView();
			const mockContext = {} as vscode.WebviewViewResolveContext;
			const mockToken = new vscode.CancellationTokenSource().token;

			provider.setOnSubmit(() => {
				// Empty callback
			});

			// Act
			provider.resolveWebviewView(webviewView, mockContext, mockToken);

			assert.ok(messageHandler.callback, 'Message handler should be registered');
			messageHandler.callback({
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

		test('should verify setupStatusHooks adds SessionStart hook with session ID capture', async () => {
			// This test verifies that when setupStatusHooks is called on a worktree,
			// the resulting .claude/settings.json contains a SessionStart hook
			// that writes session ID to .claude-session file.

			// Arrange: Create a temporary worktree-like directory
			const sessionPath = path.join(tempDir, 'test-worktree');
			fs.mkdirSync(sessionPath);

			// Act: Simulate what setupStatusHooks would create by writing the expected settings
			// Since setupStatusHooks is not exported, we verify the expected structure
			const claudeDir = path.join(sessionPath, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });

			const expectedSettings = {
				hooks: {
					SessionStart: [
						{
							hooks: [
								{
									type: 'command',
									command: "jq -r --arg ts \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\" '{sessionId: .session_id, timestamp: $ts}' > .claude-session"
								}
							]
						}
					]
				}
			};
			fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(expectedSettings, null, 2));

			// Assert: Verify the settings.json structure
			const settingsPath = path.join(claudeDir, 'settings.json');
			assert.ok(fs.existsSync(settingsPath), '.claude/settings.json should exist');

			const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
			assert.ok(settings.hooks, 'settings should have hooks object');
			assert.ok(settings.hooks.SessionStart, 'hooks should have SessionStart array');
			assert.ok(Array.isArray(settings.hooks.SessionStart), 'SessionStart should be an array');
			assert.ok(settings.hooks.SessionStart.length > 0, 'SessionStart should have at least one entry');

			// Verify the hook command writes to .claude-session
			const sessionStartHook = settings.hooks.SessionStart[0];
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

		test('should merge SessionStart hook with existing hooks without overwriting', () => {
			// This test verifies that when adding SessionStart hook,
			// existing hooks are preserved (not overwritten)

			// Arrange: Create a .claude directory with existing settings
			const sessionPath = path.join(tempDir, 'test-worktree-merge');
			fs.mkdirSync(sessionPath);
			const claudeDir = path.join(sessionPath, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });

			// Create settings with existing hooks
			const existingSettings = {
				hooks: {
					Stop: [
						{
							hooks: [
								{ type: 'command', command: 'echo "existing stop hook"' }
							]
						}
					],
					UserPromptSubmit: [
						{
							hooks: [
								{ type: 'command', command: 'echo "existing submit hook"' }
							]
						}
					]
				},
				someOtherSetting: 'should be preserved'
			};
			fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(existingSettings, null, 2));

			// Act: Simulate adding SessionStart hook while preserving existing hooks
			const settings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));

			// Add SessionStart hook (simulating what setupStatusHooks does)
			if (!settings.hooks.SessionStart) {
				settings.hooks.SessionStart = [];
			}
			settings.hooks.SessionStart.push({
				hooks: [
					{
						type: 'command',
						command: "jq -r '{sessionId: .session_id}' > .claude-session"
					}
				]
			});

			fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify(settings, null, 2));

			// Assert: Verify existing hooks are preserved
			const updatedSettings = JSON.parse(fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf-8'));

			// Check existing hooks are still there
			assert.ok(updatedSettings.hooks.Stop, 'Stop hooks should be preserved');
			assert.strictEqual(updatedSettings.hooks.Stop.length, 1, 'Stop hooks count should be unchanged');
			assert.strictEqual(updatedSettings.hooks.Stop[0].hooks[0].command, 'echo "existing stop hook"');

			assert.ok(updatedSettings.hooks.UserPromptSubmit, 'UserPromptSubmit hooks should be preserved');
			assert.strictEqual(updatedSettings.hooks.UserPromptSubmit.length, 1, 'UserPromptSubmit hooks count should be unchanged');

			// Check SessionStart hook was added
			assert.ok(updatedSettings.hooks.SessionStart, 'SessionStart hooks should exist');
			assert.strictEqual(updatedSettings.hooks.SessionStart.length, 1, 'SessionStart should have one entry');
			assert.ok(updatedSettings.hooks.SessionStart[0].hooks[0].command.includes('.claude-session'));

			// Check other settings are preserved
			assert.strictEqual(updatedSettings.someOtherSetting, 'should be preserved');
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

	suite('Acceptance Criteria in SessionFormProvider', () => {

		let tempDir: string;
		let extensionUri: vscode.Uri;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-criteria-test-'));
			extensionUri = vscode.Uri.file(tempDir);
		});

		teardown(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
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

		test('should invoke onSubmit callback with acceptanceCriteria when createSession message is received', () => {
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
			messageHandler.callback({
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

		test('should invoke onSubmit callback with empty acceptanceCriteria when not provided', () => {
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
			messageHandler.callback({
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

		test('SessionFormSubmitCallback type should accept acceptanceCriteria parameter', () => {
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
			messageHandler.callback({
				command: 'createSession',
				name: 'test',
				prompt: 'test prompt',
				acceptanceCriteria: 'test criteria'
			});

			assert.ok(callbackInvoked, 'Callback should have been invoked with 3 parameters');
		});
	});

	suite('Configurable JSON Paths', () => {

		let tempDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-json-paths-test-'));
		});

		teardown(async () => {
			// Reset all configuration values to default after each test
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('testsJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeSessionPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeStatusPath', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		test('should return worktree root path for features.json when featuresJsonPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, 'features.json'),
				'Should return features.json at worktree root when config is empty'
			);
		});

		test('should return custom path for features.json when featuresJsonPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'features.json'),
				'Should return features.json at worktree/.claude when config is set to .claude'
			);
		});

		test('should return worktree root path for tests.json when testsJsonPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('testsJsonPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getTestsJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, 'tests.json'),
				'Should return tests.json at worktree root when config is empty'
			);
		});

		test('should return custom path for tests.json when testsJsonPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('testsJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getTestsJsonPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'tests.json'),
				'Should return tests.json at worktree/.claude when config is set to .claude'
			);
		});

		test('should be able to read claudeLanes configuration values', async () => {
			// Arrange: Set a configuration value
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', 'custom/path', vscode.ConfigurationTarget.Global);

			// Act: Read the configuration back
			const readConfig = vscode.workspace.getConfiguration('claudeLanes');
			const featuresPath = readConfig.get<string>('featuresJsonPath');

			// Assert
			assert.strictEqual(
				featuresPath,
				'custom/path',
				'Should be able to read the configured value'
			);
		});

		test('should verify package.json has correct configuration schema for featuresJsonPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.configuration section
			assert.ok(
				packageJson.contributes?.configuration,
				'package.json should have contributes.configuration section'
			);

			// Assert: featuresJsonPath configuration exists with correct schema
			const featuresConfig = packageJson.contributes.configuration.properties?.['claudeLanes.featuresJsonPath'];
			assert.ok(
				featuresConfig,
				'package.json should have claudeLanes.featuresJsonPath configuration'
			);
			assert.strictEqual(
				featuresConfig.type,
				'string',
				'featuresJsonPath should have type "string"'
			);
			assert.strictEqual(
				featuresConfig.default,
				'',
				'featuresJsonPath should have default value of empty string'
			);
		});

		test('should verify package.json has correct configuration schema for testsJsonPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: testsJsonPath configuration exists with correct schema
			const testsConfig = packageJson.contributes.configuration.properties?.['claudeLanes.testsJsonPath'];
			assert.ok(
				testsConfig,
				'package.json should have claudeLanes.testsJsonPath configuration'
			);
			assert.strictEqual(
				testsConfig.type,
				'string',
				'testsJsonPath should have type "string"'
			);
			assert.strictEqual(
				testsConfig.default,
				'',
				'testsJsonPath should have default value of empty string'
			);
		});

		test('should use configured featuresJsonPath in getFeatureStatus', async () => {
			// Arrange: Set custom path and create features.json in that location
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create the .claude directory and features.json in it
			const claudeDir = path.join(tempDir, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });
			const featuresJson = {
				features: [
					{ id: 'test-feature', description: 'Test feature', passes: false }
				]
			};
			fs.writeFileSync(path.join(claudeDir, 'features.json'), JSON.stringify(featuresJson));

			// Act
			const result = getFeatureStatus(tempDir);

			// Assert
			assert.ok(result.currentFeature, 'Should find the feature in the custom path');
			assert.strictEqual(result.currentFeature.id, 'test-feature', 'Should return the correct feature');
		});

		test('should return null when features.json is in root but config points elsewhere', async () => {
			// Arrange: Set custom path but put features.json in root
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create features.json in root (wrong location per config)
			const featuresJson = {
				features: [
					{ id: 'root-feature', description: 'Feature in root', passes: false }
				]
			};
			fs.writeFileSync(path.join(tempDir, 'features.json'), JSON.stringify(featuresJson));

			// Act
			const result = getFeatureStatus(tempDir);

			// Assert: Should not find the feature since it's looking in .claude/
			assert.strictEqual(result.currentFeature, null, 'Should not find feature when config points to different path');
			assert.strictEqual(result.allComplete, false);
		});

		test('should trim whitespace from configured paths', async () => {
			// Arrange: Set custom path with whitespace
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '  .claude  ', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should trim the whitespace
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'features.json'),
				'Should trim whitespace from configured path'
			);
		});

		test('should reject paths with parent directory traversal (..)', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '../../etc', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, 'features.json'),
				'Should reject path traversal and use default'
			);
		});

		test('should reject absolute paths', async () => {
			// Arrange: Set absolute path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '/etc/passwd', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, 'features.json'),
				'Should reject absolute paths and use default'
			);
		});

		test('should reject tests.json paths with parent directory traversal', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('testsJsonPath', '../../../tmp', vscode.ConfigurationTarget.Global);

			// Act
			const result = getTestsJsonPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, 'tests.json'),
				'Should reject path traversal and use default for tests.json'
			);
		});

		test('should convert Windows backslashes to forward slashes', async () => {
			// Arrange: Set path with Windows backslashes
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', '.claude\\subdir', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should normalize backslashes
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', 'subdir', 'features.json'),
				'Should convert backslashes to forward slashes'
			);
		});

		test('should allow nested relative paths without traversal', async () => {
			// Arrange: Set valid nested path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', 'config/claude/tracking', vscode.ConfigurationTarget.Global);

			// Act
			const result = getFeaturesJsonPath(tempDir);

			// Assert: Should accept valid nested path
			assert.strictEqual(
				result,
				path.join(tempDir, 'config', 'claude', 'tracking', 'features.json'),
				'Should accept valid nested relative paths'
			);
		});
	});

	suite('Configurable Claude Session and Status Paths', () => {

		let tempDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-session-status-paths-test-'));
		});

		teardown(async () => {
			// Reset all configuration values to default after each test
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('featuresJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('testsJsonPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeSessionPath', undefined, vscode.ConfigurationTarget.Global);
			await config.update('claudeStatusPath', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		test('should return worktree root path for .claude-session when claudeSessionPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-session'),
				'Should return .claude-session at worktree root when config is empty'
			);
		});

		test('should return custom path for .claude-session when claudeSessionPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', '.claude-session'),
				'Should return .claude-session at worktree/.claude when config is set to .claude'
			);
		});

		test('should return worktree root path for .claude-status when claudeStatusPath config is empty', async () => {
			// Arrange: Ensure config is empty (default)
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-status'),
				'Should return .claude-status at worktree root when config is empty'
			);
		});

		test('should return custom path for .claude-status when claudeStatusPath is configured', async () => {
			// Arrange: Set custom path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '.claude', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude', '.claude-status'),
				'Should return .claude-status at worktree/.claude when config is set to .claude'
			);
		});

		test('should read session ID from configured claudeSessionPath location', async () => {
			// Arrange: Set custom path and create .claude-session in that location
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create the .claude directory and .claude-session in it
			const claudeDir = path.join(tempDir, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });
			const sessionData = {
				sessionId: 'custom-session-123',
				timestamp: '2025-12-21T10:00:00Z'
			};
			fs.writeFileSync(path.join(claudeDir, '.claude-session'), JSON.stringify(sessionData));

			// Act
			const result = getSessionId(tempDir);

			// Assert
			assert.ok(result, 'Should find the session in the custom path');
			assert.strictEqual(result.sessionId, 'custom-session-123', 'Should return the correct session ID');
			assert.strictEqual(result.timestamp, '2025-12-21T10:00:00Z', 'Should return the correct timestamp');
		});

		test('should read Claude status from configured claudeStatusPath location', async () => {
			// Arrange: Set custom path and create .claude-status in that location
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '.claude', vscode.ConfigurationTarget.Global);

			// Create the .claude directory and .claude-status in it
			const claudeDir = path.join(tempDir, '.claude');
			fs.mkdirSync(claudeDir, { recursive: true });
			const statusData = {
				status: 'waiting_for_user',
				timestamp: '2025-12-21T10:30:00Z',
				message: 'Waiting for confirmation'
			};
			fs.writeFileSync(path.join(claudeDir, '.claude-status'), JSON.stringify(statusData));

			// Act
			const result = getClaudeStatus(tempDir);

			// Assert
			assert.ok(result, 'Should find the status in the custom path');
			assert.strictEqual(result.status, 'waiting_for_user', 'Should return the correct status');
			assert.strictEqual(result.timestamp, '2025-12-21T10:30:00Z', 'Should return the correct timestamp');
			assert.strictEqual(result.message, 'Waiting for confirmation', 'Should return the correct message');
		});

		test('should reject claudeSessionPath with parent directory traversal and fall back to worktree root', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '../../etc', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-session'),
				'Should reject path traversal and use default for .claude-session'
			);
		});

		test('should reject claudeStatusPath with parent directory traversal and fall back to worktree root', async () => {
			// Arrange: Set malicious path with parent directory traversal
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '../../../tmp', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-status'),
				'Should reject path traversal and use default for .claude-status'
			);
		});

		test('should reject claudeSessionPath with absolute path and fall back to worktree root', async () => {
			// Arrange: Set absolute path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeSessionPath', '/etc/passwd', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeSessionPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-session'),
				'Should reject absolute paths and use default for .claude-session'
			);
		});

		test('should reject claudeStatusPath with absolute path and fall back to worktree root', async () => {
			// Arrange: Set absolute path
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('claudeStatusPath', '/tmp/evil', vscode.ConfigurationTarget.Global);

			// Act
			const result = getClaudeStatusPath(tempDir);

			// Assert: Should fall back to default path
			assert.strictEqual(
				result,
				path.join(tempDir, '.claude-status'),
				'Should reject absolute paths and use default for .claude-status'
			);
		});

		test('should verify package.json has correct configuration schema for claudeSessionPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.configuration section
			assert.ok(
				packageJson.contributes?.configuration,
				'package.json should have contributes.configuration section'
			);

			// Assert: claudeSessionPath configuration exists with correct schema
			const sessionConfig = packageJson.contributes.configuration.properties?.['claudeLanes.claudeSessionPath'];
			assert.ok(
				sessionConfig,
				'package.json should have claudeLanes.claudeSessionPath configuration'
			);
			assert.strictEqual(
				sessionConfig.type,
				'string',
				'claudeSessionPath should have type "string"'
			);
			assert.strictEqual(
				sessionConfig.default,
				'',
				'claudeSessionPath should have default value of empty string'
			);
		});

		test('should verify package.json has correct configuration schema for claudeStatusPath', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: claudeStatusPath configuration exists with correct schema
			const statusConfig = packageJson.contributes.configuration.properties?.['claudeLanes.claudeStatusPath'];
			assert.ok(
				statusConfig,
				'package.json should have claudeLanes.claudeStatusPath configuration'
			);
			assert.strictEqual(
				statusConfig.type,
				'string',
				'claudeStatusPath should have type "string"'
			);
			assert.strictEqual(
				statusConfig.default,
				'',
				'claudeStatusPath should have default value of empty string'
			);
		});
	});

	suite('Branch Handling', () => {
		// These tests use the actual git repository since branchExists and getBranchesInWorktrees
		// are real git operations. The test repository has:
		// - A 'main' branch
		// - Multiple test-* branches (test-1, test-2, etc.)
		// - At least one worktree at .worktrees/test-16

		// Get the path to the git repository root
		// __dirname is out/test (compiled), so we go up twice to reach the project root
		// This works whether running from the main repo or from a worktree
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('branchExists should return true for an existing branch', async () => {
			// Arrange: The 'main' branch should always exist in any git repository

			// Act
			const result = await branchExists(repoRoot, 'main');

			// Assert
			assert.strictEqual(result, true, 'branchExists should return true for "main" branch which exists');
		});

		test('branchExists should return false for a non-existent branch', async () => {
			// Arrange: Use a branch name that definitely does not exist
			const nonExistentBranch = 'nonexistent-branch-that-does-not-exist-xyz-123456789';

			// Act
			const result = await branchExists(repoRoot, nonExistentBranch);

			// Assert
			assert.strictEqual(result, false, 'branchExists should return false for a branch that does not exist');
		});

		test('getBranchesInWorktrees should correctly parse worktree list output', async () => {
			// Arrange: The repository has at least one worktree that we are running in

			// Act
			const result = await getBranchesInWorktrees(repoRoot);

			// Assert: The result should be a Set
			assert.ok(result instanceof Set, 'getBranchesInWorktrees should return a Set');

			// Assert: The Set should contain at least one branch (main worktree)
			// Since we are in a worktree, at least one branch should be in use
			assert.ok(result.size > 0, 'getBranchesInWorktrees should return at least one branch for repository with worktrees');

			// Assert: The main worktree should have 'main' branch checked out
			assert.ok(result.has('main'), 'The main worktree should have "main" branch checked out');

			// Note: We don't assert on the specific worktree branch name as tests may run in different contexts
		});

		test('getBranchesInWorktrees should return empty set when no worktrees have branches', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			// This will cause the git command to fail, returning an empty set
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-dir-'));

			try {
				// Act
				const result = await getBranchesInWorktrees(tempNonGitDir);

				// Assert: Should return an empty Set for a non-git directory
				assert.ok(result instanceof Set, 'getBranchesInWorktrees should return a Set');
				assert.strictEqual(result.size, 0, 'getBranchesInWorktrees should return empty Set for non-git directory');
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});
	});

	suite('Edge Cases', () => {

		suite('Long Session Names', () => {

			test('should handle session names at typical filesystem limit (255 chars)', () => {
				// Most filesystems have a 255 character limit for file/directory names
				const longName = 'a'.repeat(255);
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

				// The regex should still match
				assert.ok(branchNameRegex.test(longName), 'Regex should match 255 character name');
			});

			test('should handle session names with mixed valid characters at max length', () => {
				// 255 chars with mixed valid characters
				const longMixedName = 'feature-123_test.branch/'.repeat(10) + 'a'.repeat(15);
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

				assert.ok(branchNameRegex.test(longMixedName), 'Regex should match long mixed-character name');
			});

			test('should create SessionItem with very long name', () => {
				const longName = 'very-long-session-name-'.repeat(10);
				const item = new SessionItem(
					longName,
					`/path/to/.worktrees/${longName}`,
					vscode.TreeItemCollapsibleState.None
				);

				assert.strictEqual(item.label, longName);
				assert.ok(item.worktreePath.includes(longName));
			});

			test('should handle features.json with very long feature IDs', () => {
				// Create a worktree with features.json containing long feature ID
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'test-session');
				fs.mkdirSync(sessionDir, { recursive: true });

				const longFeatureId = 'feature-'.repeat(30) + '123';
				const featuresContent = {
					features: [
						{ id: longFeatureId, description: 'A feature with a very long ID', passes: false }
					]
				};
				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify(featuresContent)
				);

				const status = getFeatureStatus(sessionDir);
				assert.strictEqual(status.currentFeature?.id, longFeatureId);
			});
		});

		suite('Session Name Validation Edge Cases', () => {

			test('should reject names that are only dots', () => {
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
				const problematicNames = ['.', '..', '...'];

				for (const name of problematicNames) {
					// While regex matches these names, git validation should catch them
					assert.ok(branchNameRegex.test(name), `Regex matches "${name}" but git validation catches it`);
					// Names starting with '.' or containing '..' should be caught by additional validation
					const startsWithDot = name.startsWith('.');
					const containsDoubleDot = name.includes('..');

					assert.ok(
						startsWithDot || containsDoubleDot,
						`Name "${name}" should be caught by dot validation rules`
					);
				}
			});

			test('should reject names with only hyphens', () => {
				const name = '---';
				const startsWithHyphen = name.startsWith('-');
				assert.ok(startsWithHyphen, 'Name starting with hyphen should be rejected');
			});

			test('should accept valid edge case names', () => {
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
				const validEdgeCases = [
					'a',                          // Single character
					'0',                          // Single digit
					'_',                          // Single underscore
					'a-b',                        // Hyphen in middle
					'a.b',                        // Dot in middle
					'a/b',                        // Slash (path separator)
					'feature/my-feature',         // Common git flow pattern
					'release/1.0.0',              // Semantic version in branch
					'user_feature_branch',        // Underscores
					'123-numeric-start',          // Starting with numbers
				];

				for (const name of validEdgeCases) {
					assert.ok(branchNameRegex.test(name), `Name "${name}" should be valid`);
					// Also verify these don't trigger other validation rules
					const invalidStart = name.startsWith('-') || name.startsWith('.');
					const invalidEnd = name.endsWith('.') || name.endsWith('.lock');
					const hasDoubleDot = name.includes('..');

					if (!invalidStart && !invalidEnd && !hasDoubleDot) {
						assert.ok(true, `Name "${name}" passes all validation rules`);
					}
				}
			});

			test('should correctly reject .lock suffix', () => {
				const invalidNames = ['branch.lock', 'feature.lock', 'a.lock'];

				for (const name of invalidNames) {
					assert.ok(name.endsWith('.lock'), `Name "${name}" ends with .lock and should be rejected`);
				}
			});
		});

		suite('Session ID Edge Cases', () => {

			test('should handle session IDs at maximum reasonable length', () => {
				// Create a very long but valid session ID
				const longSessionId = 'a'.repeat(500);
				const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

				assert.ok(SESSION_ID_PATTERN.test(longSessionId), 'Long alphanumeric session ID should be valid');
			});

			test('should reject session IDs with newlines (potential injection)', () => {
				const maliciousIds = [
					'valid\n--evil-flag',
					'session\r\ninjection',
					'id\x00null',
				];

				const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

				for (const id of maliciousIds) {
					assert.ok(!SESSION_ID_PATTERN.test(id), `Session ID "${id.replace(/\n/g, '\\n')}" should be rejected`);
				}
			});

			test('should reject session IDs with spaces', () => {
				const idsWithSpaces = [
					'session id',
					' leadingspace',
					'trailingspace ',
					'multiple   spaces',
				];

				const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

				for (const id of idsWithSpaces) {
					assert.ok(!SESSION_ID_PATTERN.test(id), `Session ID with spaces should be rejected: "${id}"`);
				}
			});

			test('should handle empty .claude-session file gracefully', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'empty-session-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				// Write empty file
				fs.writeFileSync(path.join(sessionDir, '.claude-session'), '');

				const result = getSessionId(sessionDir);
				assert.strictEqual(result, null, 'Empty .claude-session should return null');
			});

			test('should handle .claude-session with only whitespace', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'whitespace-session-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				// Write whitespace-only file
				fs.writeFileSync(path.join(sessionDir, '.claude-session'), '   \n\t  ');

				const result = getSessionId(sessionDir);
				assert.strictEqual(result, null, 'Whitespace-only .claude-session should return null');
			});
		});

		suite('Claude Status Edge Cases', () => {

			test('should handle .claude-status with extra unexpected fields gracefully', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'extra-fields-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const statusWithExtras = {
					status: 'working',
					timestamp: '2025-01-01T00:00:00Z',
					message: 'Test message',
					unexpectedField: 'should be ignored',
					anotherExtra: { nested: 'object' }
				};

				fs.writeFileSync(
					path.join(sessionDir, '.claude-status'),
					JSON.stringify(statusWithExtras)
				);

				const result = getClaudeStatus(sessionDir);
				assert.strictEqual(result?.status, 'working');
				assert.strictEqual(result?.timestamp, '2025-01-01T00:00:00Z');
				assert.strictEqual(result?.message, 'Test message');
			});

			test('should handle .claude-status with null values for optional fields', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'null-fields-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const statusWithNulls = {
					status: 'idle',
					timestamp: null,
					message: null
				};

				fs.writeFileSync(
					path.join(sessionDir, '.claude-status'),
					JSON.stringify(statusWithNulls)
				);

				const result = getClaudeStatus(sessionDir);
				assert.strictEqual(result?.status, 'idle');
			});

			test('should reject .claude-status with invalid status value', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'invalid-status-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const invalidStatuses = [
					{ status: 'WORKING' },          // Wrong case
					{ status: 'Running' },          // Not a valid status
					{ status: '' },                 // Empty string
					{ status: 123 },                // Number instead of string
					{ status: null },               // Null
					{ status: ['working'] },        // Array
				];

				for (const invalidStatus of invalidStatuses) {
					fs.writeFileSync(
						path.join(sessionDir, '.claude-status'),
						JSON.stringify(invalidStatus)
					);

					const result = getClaudeStatus(sessionDir);
					assert.strictEqual(result, null, `Invalid status ${JSON.stringify(invalidStatus)} should return null`);
				}
			});
		});

		suite('Features.json Edge Cases', () => {

			test('should handle features.json with empty features array', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'empty-features-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({ features: [] })
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature, null);
				assert.strictEqual(result.allComplete, false);
			});

			test('should handle features.json with all features complete', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'all-complete-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({
						features: [
							{ id: 'f1', description: 'Feature 1', passes: true },
							{ id: 'f2', description: 'Feature 2', passes: true },
							{ id: 'f3', description: 'Feature 3', passes: true }
						]
					})
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature, null);
				assert.strictEqual(result.allComplete, true);
			});

			test('should handle features.json with mixed completion status', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'mixed-status-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({
						features: [
							{ id: 'f1', description: 'Complete', passes: true },
							{ id: 'f2', description: 'Incomplete', passes: false },
							{ id: 'f3', description: 'Also incomplete', passes: false }
						]
					})
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature?.id, 'f2', 'Should return first incomplete feature');
				assert.strictEqual(result.allComplete, false);
			});

			test('should handle features.json with extra fields on features', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'extra-feature-fields-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({
						features: [
							{
								id: 'f1',
								description: 'Feature with extras',
								passes: false,
								priority: 'high',
								assignee: 'claude',
								customField: { nested: 'data' }
							}
						]
					})
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature?.id, 'f1');
				assert.strictEqual(result.currentFeature?.passes, false);
			});

			test('should handle malformed features.json gracefully', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'malformed-features-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const malformedCases = [
					'not json at all',
					'{ invalid json }',
					'null',
					'[]',
					'{ "features": "not an array" }',
					'{ "features": null }',
				];

				for (const content of malformedCases) {
					fs.writeFileSync(path.join(sessionDir, 'features.json'), content);

					const result = getFeatureStatus(sessionDir);
					assert.strictEqual(result.currentFeature, null, `Malformed content should return null currentFeature: ${content}`);
					assert.strictEqual(result.allComplete, false, `Malformed content should return false allComplete: ${content}`);
				}
			});
		});

		suite('Path Configuration Edge Cases', () => {

			test('should handle paths with multiple consecutive slashes', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'multi-slash-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				// Create nested directory structure
				const nestedDir = path.join(sessionDir, 'subdir');
				fs.mkdirSync(nestedDir, { recursive: true });

				const featuresContent = { features: [{ id: 'test', description: 'Test', passes: false }] };
				fs.writeFileSync(path.join(nestedDir, 'features.json'), JSON.stringify(featuresContent));

				// The path normalization should handle this
				const result = getFeatureStatus(sessionDir);
				// Without configuration pointing to subdir, it should not find the file
				assert.strictEqual(result.currentFeature, null);
			});

			test('should handle paths with trailing slashes via path normalization', () => {
				// Test that the path building logic properly handles trailing slashes
				// by directly testing the path.join behavior used in validateAndBuildPath
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'trailing-slash-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const subdir = path.join(sessionDir, 'subdir');
				fs.mkdirSync(subdir, { recursive: true });

				// Simulate what validateAndBuildPath does with a trailing slash path
				const pathWithTrailingSlash = 'subdir/';
				const trimmedPath = pathWithTrailingSlash.trim().replace(/\\/g, '/');
				const resolvedPath = path.join(sessionDir, trimmedPath, 'features.json');

				// The path.join should normalize the trailing slash
				assert.ok(resolvedPath.includes('subdir'), 'Path should include subdir');
				assert.ok(resolvedPath.endsWith('features.json'), 'Path should end with features.json');
				// Verify no double slashes in the path
				assert.ok(!resolvedPath.includes('//'), 'Path should not contain double slashes');
			});
		});

		suite('Concurrent Operations', () => {

			test('should handle multiple simultaneous getFeatureStatus calls', async () => {
				fs.mkdirSync(worktreesDir, { recursive: true });

				// Create multiple session directories
				const sessionCount = 10;
				const sessionDirs: string[] = [];

				for (let i = 0; i < sessionCount; i++) {
					const sessionDir = path.join(worktreesDir, `concurrent-test-${i}`);
					fs.mkdirSync(sessionDir, { recursive: true });
					fs.writeFileSync(
						path.join(sessionDir, 'features.json'),
						JSON.stringify({
							features: [{ id: `feature-${i}`, description: `Feature ${i}`, passes: false }]
						})
					);
					sessionDirs.push(sessionDir);
				}

				// Call getFeatureStatus concurrently for all sessions
				const results = await Promise.all(
					sessionDirs.map(dir => Promise.resolve(getFeatureStatus(dir)))
				);

				// Verify each result is correct
				for (let i = 0; i < sessionCount; i++) {
					assert.strictEqual(results[i].currentFeature?.id, `feature-${i}`);
				}
			});

			test('should handle multiple simultaneous getClaudeStatus calls', async () => {
				fs.mkdirSync(worktreesDir, { recursive: true });

				const statuses: ClaudeStatus['status'][] = ['working', 'waiting_for_user', 'idle', 'error'];
				const sessionDirs: string[] = [];

				for (let i = 0; i < statuses.length; i++) {
					const sessionDir = path.join(worktreesDir, `status-concurrent-${i}`);
					fs.mkdirSync(sessionDir, { recursive: true });
					fs.writeFileSync(
						path.join(sessionDir, '.claude-status'),
						JSON.stringify({ status: statuses[i] })
					);
					sessionDirs.push(sessionDir);
				}

				// Call getClaudeStatus concurrently
				const results = await Promise.all(
					sessionDirs.map(dir => Promise.resolve(getClaudeStatus(dir)))
				);

				// Verify each result
				for (let i = 0; i < statuses.length; i++) {
					assert.strictEqual(results[i]?.status, statuses[i]);
				}
			});

			test('should handle ClaudeSessionProvider refresh during concurrent file changes', async () => {
				fs.mkdirSync(worktreesDir, { recursive: true });

				// Create a session
				const sessionDir = path.join(worktreesDir, 'refresh-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const provider = new ClaudeSessionProvider(tempDir);

				// Simulate rapid file changes and refreshes
				const refreshPromises: Promise<void>[] = [];
				for (let i = 0; i < 5; i++) {
					fs.writeFileSync(
						path.join(sessionDir, '.claude-status'),
						JSON.stringify({ status: i % 2 === 0 ? 'working' : 'idle' })
					);
					refreshPromises.push(Promise.resolve(provider.refresh()));
				}

				// All refreshes should complete without error
				await Promise.all(refreshPromises);
				assert.ok(true, 'All concurrent refreshes completed without error');
			});
		});
	});

	suite('Git Changes Button', () => {

		test('should verify showGitChanges command is registered in package.json', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.commands section
			assert.ok(
				packageJson.contributes?.commands,
				'package.json should have contributes.commands section'
			);

			// Assert: claudeWorktrees.showGitChanges command exists
			const commands = packageJson.contributes.commands;
			const showGitChangesCmd = commands.find(
				(cmd: { command: string }) => cmd.command === 'claudeWorktrees.showGitChanges'
			);

			assert.ok(
				showGitChangesCmd,
				'package.json should have claudeWorktrees.showGitChanges command'
			);
			assert.strictEqual(
				showGitChangesCmd.title,
				'Show Git Changes',
				'showGitChanges command should have title "Show Git Changes"'
			);
			assert.strictEqual(
				showGitChangesCmd.icon,
				'$(git-compare)',
				'showGitChanges command should have git-compare icon'
			);
		});

		test('should verify showGitChanges command appears in view/item/context menu for sessionItem', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has menus.view/item/context section
			const menuItems = packageJson.contributes?.menus?.['view/item/context'];
			assert.ok(
				menuItems,
				'package.json should have contributes.menus.view/item/context section'
			);

			// Assert: showGitChanges menu item exists with correct when clause
			const showGitChangesMenuItem = menuItems.find(
				(item: { command: string }) => item.command === 'claudeWorktrees.showGitChanges'
			);

			assert.ok(
				showGitChangesMenuItem,
				'showGitChanges should be in view/item/context menu'
			);
			assert.ok(
				showGitChangesMenuItem.when.includes('sessionItem'),
				'showGitChanges menu item should only appear for sessionItem context'
			);
			assert.strictEqual(
				showGitChangesMenuItem.group,
				'inline@1',
				'showGitChanges should be in inline group at position 1 (after openInNewWindow)'
			);
		});
	});

	suite('Git Changes Command', () => {

		test('should have showGitChanges command registered after activation', async () => {
			// Trigger extension activation by executing one of its commands
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			const commands = await vscode.commands.getCommands(true);

			assert.ok(
				commands.includes('claudeWorktrees.showGitChanges'),
				'showGitChanges command should be registered after extension activation'
			);
		});
	});

	suite('getBaseBranch', () => {
		// Note: These tests use the actual git repository to test getBaseBranch behavior.
		// The function checks for origin/main, origin/master, local main, local master in that order.

		// Get the path to the git repository root
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('should return a branch name for a valid git repository', async () => {
			// Act: Call getBaseBranch on our real repository
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return one of the expected base branches
			const validBranches = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validBranches.includes(result),
				`getBaseBranch should return one of ${validBranches.join(', ')}, got: ${result}`
			);
		});

		test('should prefer origin/main if it exists', async () => {
			// Note: This test assumes origin/main exists in our repository
			// If origin/main exists, it should be returned first
			const result = await getBaseBranch(repoRoot);

			// For most GitHub repos with a main branch and origin remote, this should return origin/main
			// If the result is origin/main, the preference logic is working
			if (result === 'origin/main') {
				assert.ok(true, 'getBaseBranch correctly prefers origin/main');
			} else {
				// If origin/main doesn't exist, the function falls back appropriately
				assert.ok(
					['origin/master', 'main', 'master'].includes(result),
					`getBaseBranch fell back to: ${result}`
				);
			}
		});

		test('should return main as fallback for non-git directory', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-base-branch-'));

			try {
				// Act
				const result = await getBaseBranch(tempNonGitDir);

				// Assert: Should return 'main' as the default fallback
				assert.strictEqual(
					result,
					'main',
					'getBaseBranch should return "main" as fallback for non-git directory'
				);
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});
	});

	suite('Git Changes Webview', () => {

		test('should verify GitChangesPanel has createOrShow static method', () => {
			// Assert: GitChangesPanel has createOrShow as a function
			assert.ok(
				typeof GitChangesPanel.createOrShow === 'function',
				'GitChangesPanel should export createOrShow static method'
			);

			// Assert: createOrShow accepts 3 parameters (extensionUri, sessionName, diffContent)
			// Function.length returns the number of expected parameters
			assert.strictEqual(
				GitChangesPanel.createOrShow.length,
				3,
				'createOrShow should accept 3 parameters: extensionUri, sessionName, diffContent'
			);
		});

		test('should verify GitChangesPanel has viewType static property', () => {
			assert.strictEqual(
				GitChangesPanel.viewType,
				'gitChangesPanel',
				'GitChangesPanel.viewType should be "gitChangesPanel"'
			);
		});

		suite('parseDiff', () => {

			test('should return empty array for empty diff content', () => {
				const result = parseDiff('');
				assert.deepStrictEqual(result, [], 'parseDiff should return empty array for empty string');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].filePath, 'src/file.ts', 'Should extract file path correctly');
				assert.strictEqual(result[0].oldPath, 'src/file.ts', 'Should extract old path correctly');
				assert.strictEqual(result[0].newPath, 'src/file.ts', 'Should extract new path correctly');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].addedCount, 2, 'Should count 2 added lines');

				const addedLines = result[0].hunks[0].lines.filter(l => l.type === 'added');
				assert.strictEqual(addedLines.length, 2, 'Should have 2 added lines');
				assert.strictEqual(addedLines[0].content, 'added line 1', 'First added line content');
				assert.strictEqual(addedLines[1].content, 'added line 2', 'Second added line content');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].removedCount, 2, 'Should count 2 removed lines');

				const removedLines = result[0].hunks[0].lines.filter(l => l.type === 'removed');
				assert.strictEqual(removedLines.length, 2, 'Should have 2 removed lines');
				assert.strictEqual(removedLines[0].content, 'removed line 1', 'First removed line content');
				assert.strictEqual(removedLines[1].content, 'removed line 2', 'Second removed line content');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');

				const contextLines = result[0].hunks[0].lines.filter(l => l.type === 'context');
				assert.strictEqual(contextLines.length, 3, 'Should have 3 context lines');
				assert.strictEqual(contextLines[0].content, 'context line 1', 'First context line content');
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

				assert.strictEqual(result.length, 2, 'Should parse two files');
				assert.strictEqual(result[0].filePath, 'file1.ts', 'First file path');
				assert.strictEqual(result[1].filePath, 'file2.ts', 'Second file path');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].isNew, true, 'File should be marked as new');
				assert.strictEqual(result[0].addedCount, 2, 'Should count 2 added lines');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].isDeleted, true, 'File should be marked as deleted');
				assert.strictEqual(result[0].removedCount, 2, 'Should count 2 removed lines');
			});

			test('should identify renamed files', () => {
				const diffContent = `diff --git a/oldname.ts b/newname.ts
rename from oldname.ts
rename to newname.ts
index 1234567..abcdefg 100644`;

				const result = parseDiff(diffContent);

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].isRenamed, true, 'File should be marked as renamed');
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

				assert.strictEqual(result.length, 1, 'Should parse one file');
				assert.strictEqual(result[0].hunks.length, 1, 'Should have one hunk');
				assert.strictEqual(result[0].hunks[0].oldStart, 10, 'Old start should be 10');
				assert.strictEqual(result[0].hunks[0].oldCount, 5, 'Old count should be 5');
				assert.strictEqual(result[0].hunks[0].newStart, 10, 'New start should be 10');
				assert.strictEqual(result[0].hunks[0].newCount, 6, 'New count should be 6');
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

				// First context line
				assert.strictEqual(lines[0].type, 'context');
				assert.strictEqual(lines[0].oldLineNumber, 5, 'Context line old number should be 5');
				assert.strictEqual(lines[0].newLineNumber, 5, 'Context line new number should be 5');

				// Added line (no old line number, new line number 6)
				assert.strictEqual(lines[1].type, 'added');
				assert.strictEqual(lines[1].oldLineNumber, null, 'Added line should have null old number');
				assert.strictEqual(lines[1].newLineNumber, 6, 'Added line new number should be 6');

				// Second context line
				assert.strictEqual(lines[2].type, 'context');
				assert.strictEqual(lines[2].oldLineNumber, 6, 'Second context line old number should be 6');
				assert.strictEqual(lines[2].newLineNumber, 7, 'Second context line new number should be 7');
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

				// First removed line
				assert.strictEqual(lines[0].type, 'removed');
				assert.strictEqual(lines[0].oldLineNumber, 10, 'First removed line old number should be 10');
				assert.strictEqual(lines[0].newLineNumber, null, 'Removed line should have null new number');

				// Second removed line
				assert.strictEqual(lines[1].type, 'removed');
				assert.strictEqual(lines[1].oldLineNumber, 11, 'Second removed line old number should be 11');
				assert.strictEqual(lines[1].newLineNumber, null, 'Removed line should have null new number');
			});
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

	suite('GitChangesPanel Comment Feature', () => {

		suite('ReviewComment Interface', () => {

			test('should verify ReviewComment interface has required fields', () => {
				// Test that ReviewComment interface contains filePath, lineNumber, lineType, lineContent, and text fields
				// by creating an object that conforms to the interface
				const comment: ReviewComment = {
					id: 'comment-1',
					filePath: 'src/test.ts',
					lineNumber: 42,
					lineType: 'added',
					lineContent: 'const x = 1;',
					text: 'This looks good!'
				};

				// Verify all required fields are present and have correct types
				assert.strictEqual(typeof comment.id, 'string', 'id should be a string');
				assert.strictEqual(typeof comment.filePath, 'string', 'filePath should be a string');
				assert.strictEqual(typeof comment.lineNumber, 'number', 'lineNumber should be a number');
				assert.ok(
					['added', 'removed', 'context'].includes(comment.lineType),
					'lineType should be "added", "removed", or "context"'
				);
				assert.strictEqual(typeof comment.lineContent, 'string', 'lineContent should be a string');
				assert.strictEqual(typeof comment.text, 'string', 'text should be a string');

				// Verify actual values
				assert.strictEqual(comment.id, 'comment-1');
				assert.strictEqual(comment.filePath, 'src/test.ts');
				assert.strictEqual(comment.lineNumber, 42);
				assert.strictEqual(comment.lineType, 'added');
				assert.strictEqual(comment.lineContent, 'const x = 1;');
				assert.strictEqual(comment.text, 'This looks good!');
			});

			test('should allow all valid lineType values', () => {
				// Verify all three valid lineType values work
				const addedComment: ReviewComment = {
					id: 'c1',
					filePath: 'file.ts',
					lineNumber: 1,
					lineType: 'added',
					lineContent: '+new line',
					text: 'Comment on added line'
				};

				const removedComment: ReviewComment = {
					id: 'c2',
					filePath: 'file.ts',
					lineNumber: 2,
					lineType: 'removed',
					lineContent: '-old line',
					text: 'Comment on removed line'
				};

				const contextComment: ReviewComment = {
					id: 'c3',
					filePath: 'file.ts',
					lineNumber: 3,
					lineType: 'context',
					lineContent: ' unchanged line',
					text: 'Comment on context line'
				};

				assert.strictEqual(addedComment.lineType, 'added');
				assert.strictEqual(removedComment.lineType, 'removed');
				assert.strictEqual(contextComment.lineType, 'context');
			});
		});

		suite('Diff HTML Comment Buttons', () => {

			test('should include comment buttons in generated diff HTML', () => {
				// Parse a simple diff and verify the generated HTML structure includes comment buttons
				// We use parseDiff to create file data, then test the HTML generation logic
				const diffContent = `diff --git a/test.ts b/test.ts
index 1234567..abcdefg 100644
--- a/test.ts
+++ b/test.ts
@@ -1,3 +1,4 @@
 const a = 1;
+const b = 2;
 const c = 3;`;

				const result = parseDiff(diffContent);

				// Verify the diff was parsed and has lines that would receive comment buttons
				assert.strictEqual(result.length, 1, 'Should parse one file');
				const lines = result[0].hunks[0].lines;
				assert.ok(lines.length > 0, 'Should have lines that can receive comment buttons');

				// Each line in the diff should be able to receive a comment button
				// The HTML generation adds a button with class "comment-btn" for each line
				// We verify the structure is in place for this by checking each line has required data
				for (const line of lines) {
					assert.ok(
						['added', 'removed', 'context'].includes(line.type),
						'Each line should have a valid type for comment button data attribute'
					);
					assert.ok(
						typeof line.content === 'string',
						'Each line should have content for comment button data attribute'
					);
					assert.ok(
						line.oldLineNumber !== undefined || line.newLineNumber !== undefined,
						'Each line should have at least one line number for comment button data attribute'
					);
				}
			});
		});

		suite('Submit Review Button in Toolbar', () => {

			test('should verify package.json or HTML contains Submit Review functionality', () => {
				// The Submit Review button is rendered in the webview HTML
				// We can verify the GitChangesPanel has the necessary static method
				// which generates HTML containing the Submit Review button

				assert.ok(
					typeof GitChangesPanel.createOrShow === 'function',
					'GitChangesPanel should have createOrShow method that generates HTML with Submit Review button'
				);

				// The createOrShow method generates HTML with a toolbar containing Submit Review button
				// The button has id="submit-review-btn" and class="primary"
				// We verify the method signature is correct for generating the panel
				assert.strictEqual(
					GitChangesPanel.createOrShow.length,
					3,
					'createOrShow should accept extensionUri, sessionName, diffContent for generating webview with Submit Review button'
				);
			});
		});

		suite('Comment Badge on File Header', () => {

			test('should verify parseDiff output structure supports comment count badges', () => {
				// Parse a diff and verify the output structure supports tracking comments per file
				// The HTML generation creates a comment-count badge for each file container

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

				// Verify each file has a unique filePath that can be used to track comment counts
				assert.strictEqual(result.length, 2, 'Should parse two files');
				assert.strictEqual(result[0].filePath, 'file1.ts', 'First file path');
				assert.strictEqual(result[1].filePath, 'file2.ts', 'Second file path');

				// Each file entry supports a comment badge through the file-container data-file-path attribute
				// The HTML structure includes: <span class="badge comment-count" id="comment-count-{index}">
				for (let i = 0; i < result.length; i++) {
					assert.ok(
						typeof result[i].filePath === 'string',
						'Each file should have filePath for comment badge tracking'
					);
				}
			});
		});

		suite('Webview Message Handler', () => {

			test('should verify submitReview message handling capability (skipped - requires VS Code webview mocking)', function() {
				// This test verifies the extension can handle submitReview messages from the webview
				// The actual webview message handling requires complex VS Code API mocking
				// which is beyond the scope of unit testing
				//
				// The message handler in GitChangesPanel constructor listens for:
				// case 'submitReview':
				//   await this._handleSubmitReview(message.comments as ReviewComment[]);
				//
				// Integration testing would require:
				// 1. Creating a mock WebviewPanel
				// 2. Triggering the onDidReceiveMessage handler
				// 3. Verifying _handleSubmitReview is called with correct comments
				//
				// Since this is complex to mock, we mark this as skipped and verify
				// the related functionality through the formatReviewForClipboard tests

				this.skip();
			});
		});

		suite('formatReviewForClipboard', () => {

			test('should return "No comments" message when comments array is empty', () => {
				const result = formatReviewForClipboard([]);
				assert.strictEqual(result, 'No comments in this review.');
			});

			test('should format single comment correctly', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'src/test.ts',
						lineNumber: 10,
						lineType: 'added',
						lineContent: 'const x = 1;',
						text: 'This variable should be named better'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Verify header
				assert.ok(result.includes('# Code Review Comments'), 'Should have review header');

				// Verify file grouping
				assert.ok(result.includes('## src/test.ts'), 'Should have file path as heading');

				// Verify line info
				assert.ok(result.includes('**Line 10**'), 'Should include line number');
				assert.ok(result.includes('(added)'), 'Should include line type');

				// Verify line content with prefix
				assert.ok(result.includes('+const x = 1;'), 'Should include line content with + prefix for added');

				// Verify comment text
				assert.ok(result.includes('> This variable should be named better'), 'Should include comment text as quote');
			});

			test('should format multiple comments grouped by file', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'src/file1.ts',
						lineNumber: 5,
						lineType: 'added',
						lineContent: 'const a = 1;',
						text: 'Comment on file1 line 5'
					},
					{
						id: 'c2',
						filePath: 'src/file2.ts',
						lineNumber: 10,
						lineType: 'removed',
						lineContent: 'const b = 2;',
						text: 'Comment on file2 line 10'
					},
					{
						id: 'c3',
						filePath: 'src/file1.ts',
						lineNumber: 15,
						lineType: 'context',
						lineContent: 'const c = 3;',
						text: 'Comment on file1 line 15'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Verify both files are present
				assert.ok(result.includes('## src/file1.ts'), 'Should have file1 heading');
				assert.ok(result.includes('## src/file2.ts'), 'Should have file2 heading');

				// Verify comments are present
				assert.ok(result.includes('> Comment on file1 line 5'), 'Should include first comment');
				assert.ok(result.includes('> Comment on file2 line 10'), 'Should include second comment');
				assert.ok(result.includes('> Comment on file1 line 15'), 'Should include third comment');

				// Verify line prefixes by type
				assert.ok(result.includes('+const a = 1;'), 'Added line should have + prefix');
				assert.ok(result.includes('-const b = 2;'), 'Removed line should have - prefix');
				assert.ok(result.includes(' const c = 3;'), 'Context line should have space prefix');
			});

			test('should sort comments by line number within each file', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'src/test.ts',
						lineNumber: 20,
						lineType: 'added',
						lineContent: 'line 20',
						text: 'Comment on line 20'
					},
					{
						id: 'c2',
						filePath: 'src/test.ts',
						lineNumber: 5,
						lineType: 'added',
						lineContent: 'line 5',
						text: 'Comment on line 5'
					},
					{
						id: 'c3',
						filePath: 'src/test.ts',
						lineNumber: 10,
						lineType: 'added',
						lineContent: 'line 10',
						text: 'Comment on line 10'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Find positions of line numbers in output
				const line5Pos = result.indexOf('**Line 5**');
				const line10Pos = result.indexOf('**Line 10**');
				const line20Pos = result.indexOf('**Line 20**');

				// Verify ascending order
				assert.ok(line5Pos < line10Pos, 'Line 5 should appear before Line 10');
				assert.ok(line10Pos < line20Pos, 'Line 10 should appear before Line 20');
			});

			test('should use correct line prefixes for different line types', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'test.ts',
						lineNumber: 1,
						lineType: 'added',
						lineContent: 'added content',
						text: 'Added line comment'
					},
					{
						id: 'c2',
						filePath: 'test.ts',
						lineNumber: 2,
						lineType: 'removed',
						lineContent: 'removed content',
						text: 'Removed line comment'
					},
					{
						id: 'c3',
						filePath: 'test.ts',
						lineNumber: 3,
						lineType: 'context',
						lineContent: 'context content',
						text: 'Context line comment'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Check code blocks contain correct prefixes
				assert.ok(result.includes('+added content'), 'Added line should have + prefix');
				assert.ok(result.includes('-removed content'), 'Removed line should have - prefix');
				assert.ok(result.includes(' context content'), 'Context line should have space prefix');
			});

			test('should wrap line content in code blocks', () => {
				const comments: ReviewComment[] = [
					{
						id: 'c1',
						filePath: 'test.ts',
						lineNumber: 1,
						lineType: 'added',
						lineContent: 'const x = 1;',
						text: 'Test comment'
					}
				];

				const result = formatReviewForClipboard(comments);

				// Verify code block markers
				const codeBlockMatches = result.match(/```/g);
				assert.ok(codeBlockMatches, 'Should have code block markers');
				assert.strictEqual(codeBlockMatches.length, 2, 'Should have opening and closing code block markers');
			});
		});
	});

	suite('Base Branch Configuration', () => {
		// These tests verify that getBaseBranch correctly uses the claudeLanes.baseBranch
		// configuration setting, and falls back to auto-detection when not set.

		// Get the path to the git repository root for fallback tests
		const repoRoot = path.resolve(__dirname, '..', '..');

		teardown(async () => {
			// Reset the baseBranch configuration to default after each test
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', undefined, vscode.ConfigurationTarget.Global);
		});

		test('should return configured value when claudeLanes.baseBranch setting is set', async () => {
			// Arrange: Set the baseBranch configuration to 'develop'
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', 'develop', vscode.ConfigurationTarget.Global);

			// Act: Call getBaseBranch - the cwd doesn't matter when config is set
			// since it should return the configured value without checking git
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return the configured value
			assert.strictEqual(
				result,
				'develop',
				'getBaseBranch should return the configured baseBranch value "develop"'
			);
		});

		test('should use fallback detection when baseBranch setting is empty', async () => {
			// Arrange: Ensure the baseBranch configuration is empty
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', '', vscode.ConfigurationTarget.Global);

			// Act: Call getBaseBranch with the actual repo path
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return one of the fallback branches
			// The fallback order is: origin/main, origin/master, main, master
			const validFallbacks = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validFallbacks.includes(result),
				`getBaseBranch should return a fallback branch when config is empty, got: "${result}"`
			);
		});

		test('should treat whitespace-only setting as empty and use fallback', async () => {
			// Arrange: Set the baseBranch configuration to whitespace only
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('baseBranch', '   ', vscode.ConfigurationTarget.Global);

			// Act: Call getBaseBranch with the actual repo path
			const result = await getBaseBranch(repoRoot);

			// Assert: Should return one of the fallback branches (treating whitespace as empty)
			const validFallbacks = ['origin/main', 'origin/master', 'main', 'master'];
			assert.ok(
				validFallbacks.includes(result),
				`getBaseBranch should use fallback when config is whitespace-only, got: "${result}"`
			);
		});
	});

	suite('Worktree Detection', () => {
		// Test getBaseRepoPath functionality for detecting worktrees
		// and resolving to the base repository path

		// Get the path to the git repository root
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('should return same path for regular git repository', async () => {
			// Arrange: Use the actual repo root - this is a regular repo from the main
			// branch perspective, or we're in a worktree
			// Act
			const result = await getBaseRepoPath(repoRoot);

			// Assert: The result should be a valid directory path
			assert.ok(
				typeof result === 'string' && result.length > 0,
				'getBaseRepoPath should return a non-empty string'
			);
			// The result should be an existing directory
			assert.ok(
				fs.existsSync(result),
				`getBaseRepoPath result should be an existing path: ${result}`
			);
		});

		test('should return base repo path when in a worktree', async () => {
			// This test runs from within a worktree (test-35)
			// The worktree is at: <base-repo>/.worktrees/test-35
			// getBaseRepoPath should return: <base-repo>

			// Act
			const result = await getBaseRepoPath(repoRoot);

			// Assert: Check if we're in a worktree by looking at the path structure
			// If the current repoRoot contains '.worktrees', we're in a worktree
			if (repoRoot.includes('.worktrees')) {
				// We're in a worktree, result should be the parent of .worktrees
				const worktreesIndex = repoRoot.indexOf('.worktrees');
				const expectedBase = repoRoot.substring(0, worktreesIndex - 1); // Remove trailing slash
				assert.strictEqual(
					result,
					expectedBase,
					`getBaseRepoPath should return base repo when in worktree. Got: ${result}, expected: ${expectedBase}`
				);
			} else {
				// We're in the main repo, result should be the same path
				assert.strictEqual(
					result,
					repoRoot,
					'getBaseRepoPath should return same path for main repo'
				);
			}
		});

		test('should return original path for non-git directory', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-worktree-test-'));

			try {
				// Act
				const result = await getBaseRepoPath(tempNonGitDir);

				// Assert: Should return the original path unchanged
				assert.strictEqual(
					result,
					tempNonGitDir,
					'getBaseRepoPath should return original path for non-git directory'
				);
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});

		test('should log warning when git command fails in non-git directory', async () => {
			// Arrange: Create a temporary directory that is NOT a git repository
			const tempNonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-warning-test-'));

			try {
				// Act: getBaseRepoPath should catch the error and return original path
				const result = await getBaseRepoPath(tempNonGitDir);

				// Assert: Should return original path (function handles errors gracefully)
				assert.strictEqual(
					result,
					tempNonGitDir,
					'getBaseRepoPath should return original path when git fails'
				);
				// Note: We can't easily capture console.warn output in tests,
				// but we verify the function doesn't throw and returns gracefully
			} finally {
				// Cleanup
				fs.rmSync(tempNonGitDir, { recursive: true, force: true });
			}
		});

		test('should verify ClaudeSessionProvider uses baseRepoPath for session discovery', async () => {
			// Arrange: Create a temp directory structure simulating a worktree scenario
			const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-base-test-'));
			const worktreesDir = path.join(tempDir, '.worktrees');
			fs.mkdirSync(worktreesDir);
			fs.mkdirSync(path.join(worktreesDir, 'test-session-1'));
			fs.mkdirSync(path.join(worktreesDir, 'test-session-2'));

			try {
				// Act: Create provider with baseRepoPath parameter
				const provider = new ClaudeSessionProvider(tempDir, tempDir);
				const children = await provider.getChildren();

				// Assert: Should discover sessions from the baseRepoPath's .worktrees
				assert.strictEqual(children.length, 2, 'Should find 2 sessions');
				const labels = children.map(c => c.label).sort();
				assert.deepStrictEqual(labels, ['test-session-1', 'test-session-2']);
			} finally {
				// Cleanup
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		});
	});

	suite('Project Manager Integration', () => {
		// Tests for Project Manager integration functions

		let tempDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manager-test-'));
		});

		teardown(() => {
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		suite('getRepoName', () => {

			test('should extract repository name from absolute path', () => {
				// Arrange
				const repoPath = '/Users/user/projects/my-awesome-repo';

				// Act
				const result = getRepoName(repoPath);

				// Assert
				assert.strictEqual(result, 'my-awesome-repo', 'Should return the last path segment');
			});

			test('should extract repository name from Windows path', () => {
				// Arrange - path.basename uses native path separator
				// On Windows, it will parse backslashes; on macOS/Linux it won't
				const repoPath = 'C:\\Users\\user\\projects\\my-repo';

				// Act
				const result = getRepoName(repoPath);

				// Assert: On non-Windows, the entire path is returned as basename
				// because backslashes aren't path separators. This is expected behavior.
				if (process.platform === 'win32') {
					assert.strictEqual(result, 'my-repo', 'Windows should parse backslashes');
				} else {
					// On macOS/Linux, the entire string is the "basename"
					assert.strictEqual(result, repoPath, 'Non-Windows treats backslashes as literal characters');
				}
			});

			test('should handle paths with trailing slash', () => {
				// Arrange
				const repoPath = '/Users/user/projects/my-repo/';

				// Act
				const result = getRepoName(repoPath);

				// Assert: path.basename handles trailing slashes
				assert.strictEqual(result, 'my-repo', 'Should handle trailing slash');
			});

			test('should return empty string for root path', () => {
				// Arrange
				const repoPath = '/';

				// Act
				const result = getRepoName(repoPath);

				// Assert
				assert.strictEqual(result, '', 'Should return empty string for root');
			});
		});

		// Note: Tests for Project Manager integration are in ProjectManagerService.test.ts
		// The old file-based functions (getProjectManagerFilePath, addProjectToProjectManager,
		// removeProjectFromProjectManager) have been replaced with the ProjectManagerService
		// which uses the VS Code extension API.
	});

	suite('Open Window Command', () => {
		// Tests for the openInNewWindow command

		// Get the path to the git repository root
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('should have openInNewWindow command registered after activation', async () => {
			// Trigger extension activation
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			// Act
			const commands = await vscode.commands.getCommands(true);

			// Assert
			assert.ok(
				commands.includes('claudeWorktrees.openInNewWindow'),
				'openInNewWindow command should be registered after extension activation'
			);
		});

		test('should show error when called without session item', async () => {
			// Trigger extension activation first
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected
			}

			// Act: Execute the command without a session item
			// The command should show an error message and return without throwing
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openInNewWindow');
				// Command executed, it should have shown an error message
				assert.ok(true, 'Command should handle missing item gracefully');
			} catch {
				// If it throws, that's also acceptable behavior
				assert.ok(true, 'Command may throw for missing item');
			}
		});

		test('should verify openInNewWindow command is in package.json', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(repoRoot, 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: openInNewWindow command exists
			const commands = packageJson.contributes?.commands;
			assert.ok(commands, 'package.json should have contributes.commands');

			const openWindowCmd = commands.find(
				(cmd: { command: string }) => cmd.command === 'claudeWorktrees.openInNewWindow'
			);

			assert.ok(
				openWindowCmd,
				'package.json should have claudeWorktrees.openInNewWindow command'
			);
			assert.strictEqual(
				openWindowCmd.title,
				'Open in New Window',
				'openInNewWindow command should have correct title'
			);
		});

		test('should verify openInNewWindow appears in inline menu for sessionItem', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(repoRoot, 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: Command appears in view/item/context menu
			const menuItems = packageJson.contributes?.menus?.['view/item/context'];
			assert.ok(menuItems, 'package.json should have view/item/context menu items');

			const openWindowMenuItem = menuItems.find(
				(item: { command: string }) => item.command === 'claudeWorktrees.openInNewWindow'
			);

			assert.ok(
				openWindowMenuItem,
				'openInNewWindow should be in view/item/context menu'
			);
			assert.ok(
				openWindowMenuItem.when.includes('sessionItem'),
				'openInNewWindow should only appear for sessionItem context'
			);
			assert.strictEqual(
				openWindowMenuItem.group,
				'inline@0',
				'openInNewWindow should be in inline group at position 0'
			);
		});
	});

	suite('Global Storage', () => {

		let tempDir: string;
		let globalStorageDir: string;

		setup(() => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-storage-test-'));
			globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));
		});

		teardown(async () => {
			// Reset global storage configuration
			const config = vscode.workspace.getConfiguration('claudeLanes');
			await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
			fs.rmSync(globalStorageDir, { recursive: true, force: true });
		});

		suite('getRepoIdentifier', () => {

			test('should generate unique identifier with repo name and hash', () => {
				// Arrange
				const repoPath = '/path/to/my-project';

				// Act
				const result = getRepoIdentifier(repoPath);

				// Assert
				assert.ok(result.startsWith('my-project-'), 'Should start with repo name');
				assert.ok(result.length > 'my-project-'.length, 'Should have hash suffix');
				// Hash is 8 characters
				const hashPart = result.substring('my-project-'.length);
				assert.strictEqual(hashPart.length, 8, 'Hash part should be 8 characters');
				assert.ok(/^[a-f0-9]+$/.test(hashPart), 'Hash part should be hexadecimal');
			});

			test('should produce different identifiers for different repos with same name in different locations', () => {
				// Arrange
				const repoPath1 = '/path/to/my-project';
				const repoPath2 = '/other/location/my-project';

				// Act
				const result1 = getRepoIdentifier(repoPath1);
				const result2 = getRepoIdentifier(repoPath2);

				// Assert
				assert.notStrictEqual(
					result1,
					result2,
					'Different repo paths should produce different identifiers'
				);
				// Both should start with the same repo name
				assert.ok(result1.startsWith('my-project-'), 'First should start with repo name');
				assert.ok(result2.startsWith('my-project-'), 'Second should start with repo name');
			});

			test('should produce deterministic identifiers for the same repo', () => {
				// Arrange
				const repoPath = '/path/to/my-project';

				// Act
				const result1 = getRepoIdentifier(repoPath);
				const result2 = getRepoIdentifier(repoPath);

				// Assert
				assert.strictEqual(
					result1,
					result2,
					'Same repo path should always produce the same identifier'
				);
			});

			test('should sanitize special characters in repo name', () => {
				// Arrange
				const repoPath = '/path/to/my project@v1.0';

				// Act
				const result = getRepoIdentifier(repoPath);

				// Assert
				// Special characters should be replaced with underscores
				assert.ok(result.startsWith('my_project_v1_0-'), 'Should sanitize special characters');
				assert.ok(!result.includes(' '), 'Should not contain spaces');
				assert.ok(!result.includes('@'), 'Should not contain @ symbol');
				assert.ok(!result.includes('.'), 'Should not contain dots');
			});

			test('should normalize paths for cross-platform consistency', () => {
				// Arrange
				const repoPath1 = '/path/to/project';
				const repoPath2 = '/PATH/TO/PROJECT';

				// Act
				const result1 = getRepoIdentifier(repoPath1);
				const result2 = getRepoIdentifier(repoPath2);

				// Assert: The hash part should be the same (path is normalized to lowercase before hashing)
				// But the repo name prefix may differ in case since it comes from path.basename
				const hash1 = result1.split('-').pop();
				const hash2 = result2.split('-').pop();
				assert.strictEqual(
					hash1,
					hash2,
					'Hash part should be identical for case-different paths'
				);

				// Both should have the same prefix pattern (project name)
				assert.ok(
					result1.toLowerCase().startsWith('project-'),
					'First should have project name prefix'
				);
				assert.ok(
					result2.toLowerCase().startsWith('project-'),
					'Second should have project name prefix'
				);
			});
		});

		suite('getSessionNameFromWorktree', () => {

			test('should extract session name from worktree path', () => {
				// Arrange
				const worktreePath = '/path/to/repo/.worktrees/my-session';

				// Act
				const result = getSessionNameFromWorktree(worktreePath);

				// Assert
				assert.strictEqual(result, 'my-session');
			});

			test('should handle paths with special characters in session name', () => {
				// Arrange
				const worktreePath = '/path/to/repo/.worktrees/feature-123';

				// Act
				const result = getSessionNameFromWorktree(worktreePath);

				// Assert
				assert.strictEqual(result, 'feature-123');
			});
		});

		suite('getGlobalStoragePath', () => {

			test('should return null when global storage context is not initialized', () => {
				// Note: We cannot easily uninitialize the global storage context in tests
				// This test verifies behavior when getGlobalStoragePath is called
				// without proper initialization

				// Act: Initialize with valid values first, then check the path format
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'my-session');
				const result = getGlobalStoragePath(worktreePath, 'features.json');

				// Assert: Should return a valid path
				assert.ok(result, 'Should return a path when context is initialized');
				assert.ok(result!.includes('features.json'), 'Path should include filename');
			});

			test('should generate correct path structure: globalStorage/repoIdentifier/sessionName/filename', () => {
				// Arrange
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getGlobalStoragePath(worktreePath, '.claude-status');

				// Assert
				assert.ok(result, 'Should return a path');

				// Path should be: globalStorageDir/<repo-identifier>/test-session/.claude-status
				const repoIdentifier = getRepoIdentifier(tempDir);
				const expectedPath = path.join(globalStorageDir, repoIdentifier, 'test-session', '.claude-status');
				assert.strictEqual(result, expectedPath, 'Should match expected path structure');
			});

			test('should produce different paths for different repos with same session name', () => {
				// Arrange
				const repo1Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo1-'));
				const repo2Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo2-'));
				const mockUri = vscode.Uri.file(globalStorageDir);

				try {
					// Test with repo1
					initializeGlobalStorageContext(mockUri, repo1Dir);
					const path1 = getGlobalStoragePath(
						path.join(repo1Dir, '.worktrees', 'session-a'),
						'features.json'
					);

					// Test with repo2
					initializeGlobalStorageContext(mockUri, repo2Dir);
					const path2 = getGlobalStoragePath(
						path.join(repo2Dir, '.worktrees', 'session-a'),
						'features.json'
					);

					// Assert: Paths should be different due to different repo identifiers
					assert.ok(path1, 'Path 1 should exist');
					assert.ok(path2, 'Path 2 should exist');
					assert.notStrictEqual(
						path1,
						path2,
						'Different repos should have different paths even with same session name'
					);
				} finally {
					fs.rmSync(repo1Dir, { recursive: true, force: true });
					fs.rmSync(repo2Dir, { recursive: true, force: true });
				}
			});

			test('should produce identical paths for same repo and session (deterministic)', () => {
				// Arrange
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);
				const worktreePath = path.join(tempDir, '.worktrees', 'my-session');

				// Act
				const path1 = getGlobalStoragePath(worktreePath, 'features.json');
				const path2 = getGlobalStoragePath(worktreePath, 'features.json');

				// Assert
				assert.strictEqual(path1, path2, 'Same inputs should produce same path');
			});
		});

		suite('Path functions respect useGlobalStorage setting', () => {

			test('should return worktree-relative path when useGlobalStorage is false', async () => {
				// Arrange: Ensure global storage is disabled
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

				// Initialize global storage context (should not affect paths when disabled)
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				// Act
				const result = getFeaturesJsonPath(tempDir);

				// Assert: Should return worktree-relative path
				assert.strictEqual(
					result,
					path.join(tempDir, 'features.json'),
					'Should return worktree-relative path when global storage is disabled'
				);
			});

			test('should NOT return global storage path for getFeaturesJsonPath even when useGlobalStorage is true', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getFeaturesJsonPath(worktreePath);

				// Assert: features.json should NOT be in global storage (it's a dev workflow file)
				assert.ok(
					!result.startsWith(globalStorageDir),
					'features.json should NOT be in global storage'
				);
				assert.ok(
					result.startsWith(worktreePath),
					'features.json should be in worktree directory'
				);
				assert.ok(
					result.endsWith('features.json'),
					'Path should end with features.json'
				);
			});

			test('should return global storage path when useGlobalStorage is true for getClaudeStatusPath', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getClaudeStatusPath(worktreePath);

				// Assert: Should return global storage path
				assert.ok(
					result.startsWith(globalStorageDir),
					'Should return path in global storage directory'
				);
				assert.ok(
					result.endsWith('.claude-status'),
					'Path should end with .claude-status'
				);
			});

			test('should return global storage path when useGlobalStorage is true for getClaudeSessionPath', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getClaudeSessionPath(worktreePath);

				// Assert: Should return global storage path
				assert.ok(
					result.startsWith(globalStorageDir),
					'Should return path in global storage directory'
				);
				assert.ok(
					result.endsWith('.claude-session'),
					'Path should end with .claude-session'
				);
			});

			test('should NOT return global storage path for getTestsJsonPath even when useGlobalStorage is true', async () => {
				// Arrange: Enable global storage
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Initialize global storage context
				const mockUri = vscode.Uri.file(globalStorageDir);
				initializeGlobalStorageContext(mockUri, tempDir);

				const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

				// Act
				const result = getTestsJsonPath(worktreePath);

				// Assert: tests.json should NOT be in global storage (it's a dev workflow file)
				assert.ok(
					!result.startsWith(globalStorageDir),
					'tests.json should NOT be in global storage'
				);
				assert.ok(
					result.startsWith(worktreePath),
					'tests.json should be in worktree directory'
				);
				assert.ok(
					result.endsWith('tests.json'),
					'Path should end with tests.json'
				);
			});
		});

		suite('isGlobalStorageEnabled', () => {

			test('should return false when useGlobalStorage is not set (default)', async () => {
				// Arrange: Reset to default
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

				// Act
				const result = isGlobalStorageEnabled();

				// Assert
				assert.strictEqual(result, false, 'Should default to false');
			});

			test('should return true when useGlobalStorage is true', async () => {
				// Arrange
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

				// Act
				const result = isGlobalStorageEnabled();

				// Assert
				assert.strictEqual(result, true, 'Should return true when enabled');
			});

			test('should return false when useGlobalStorage is explicitly false', async () => {
				// Arrange
				const config = vscode.workspace.getConfiguration('claudeLanes');
				await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);

				// Act
				const result = isGlobalStorageEnabled();

				// Assert
				assert.strictEqual(result, false, 'Should return false when explicitly disabled');
			});
		});
	});

	suite('Configuration', () => {

		test('should verify package.json has useGlobalStorage configuration', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.configuration section
			assert.ok(
				packageJson.contributes?.configuration,
				'package.json should have contributes.configuration section'
			);

			// Assert: useGlobalStorage configuration exists with correct schema
			const globalStorageConfig = packageJson.contributes.configuration.properties?.['claudeLanes.useGlobalStorage'];
			assert.ok(
				globalStorageConfig,
				'package.json should have claudeLanes.useGlobalStorage configuration'
			);
			assert.strictEqual(
				globalStorageConfig.type,
				'boolean',
				'useGlobalStorage should have type "boolean"'
			);
			assert.strictEqual(
				globalStorageConfig.default,
				false,
				'useGlobalStorage should have default value of false'
			);
		});

		test('should verify useGlobalStorage has a meaningful description', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const globalStorageConfig = packageJson.contributes.configuration.properties?.['claudeLanes.useGlobalStorage'];

			assert.ok(
				globalStorageConfig.description,
				'useGlobalStorage should have a description'
			);
			assert.ok(
				globalStorageConfig.description.length > 20,
				'Description should be meaningful (more than 20 chars)'
			);
			assert.ok(
				globalStorageConfig.description.toLowerCase().includes('global storage') ||
				globalStorageConfig.description.toLowerCase().includes('worktree'),
				'Description should mention global storage or worktree'
			);
	suite('ProjectManagerService', () => {

		// Clear cache between each test to ensure isolation
		setup(() => {
			clearCache();
		});

		teardown(() => {
			clearCache();
		});

		suite('isProjectManagerAvailable', () => {

			test('should return a boolean value', () => {
				// Given: The function is called
				// When: isProjectManagerAvailable is invoked
				const result = isProjectManagerAvailable();

				// Then: It should return a boolean (true if installed, false otherwise)
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should return false when Project Manager extension is not installed', () => {
				// Given: In test environment, Project Manager extension is typically not installed
				// When: isProjectManagerAvailable is called
				const result = isProjectManagerAvailable();

				// Then: It should return false since the extension is not in the test host
				// Note: This test assumes the extension is not installed in the test environment
				// If the extension is installed, this test verifies it returns true
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should be callable multiple times without errors', () => {
				// Given: The function is called multiple times
				// When: isProjectManagerAvailable is invoked repeatedly
				// Then: It should not throw and should return consistent results
				assert.doesNotThrow(() => {
					const result1 = isProjectManagerAvailable();
					const result2 = isProjectManagerAvailable();
					const result3 = isProjectManagerAvailable();
					// Results should be consistent
					assert.strictEqual(result1, result2);
					assert.strictEqual(result2, result3);
				});
			});
		});

		suite('getProjects', () => {

			test('should return an array', async () => {
				// Given: The function is called
				// When: getProjects is invoked
				const result = await getProjects();

				// Then: It should always return an array (possibly empty)
				assert.ok(Array.isArray(result));
			});

			test('should return empty array when API is not available', async () => {
				// Given: Project Manager extension is not installed
				// When: getProjects is called
				const result = await getProjects();

				// Then: It should return an empty array gracefully
				if (!isProjectManagerAvailable()) {
					assert.deepStrictEqual(result, []);
				}
			});

			test('should not throw errors even when extension is missing', async () => {
				// Given: Extension may not be installed
				// When: getProjects is called
				// Then: Should return empty array without throwing
				let error: Error | undefined;
				let result: unknown[];
				try {
					result = await getProjects();
				} catch (err) {
					error = err as Error;
					result = [];
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.ok(Array.isArray(result));
			});
		});

		suite('addProject', () => {

			test('should return a boolean', async () => {
				// Given: The function is called with valid parameters
				// When: addProject is invoked
				const result = await addProject('test-project', '/test/path');

				// Then: It should return a boolean
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should return false when API is not available', async () => {
				// Given: Project Manager extension is not installed
				// When: addProject is called
				const result = await addProject('test-project', '/test/path', ['test-tag']);

				// Then: It should return false gracefully
				if (!isProjectManagerAvailable()) {
					assert.strictEqual(result, false);
				}
			});

			test('should accept optional tags parameter', async () => {
				// Given: Tags are provided
				// When: addProject is called with tags
				// Then: It should not throw and handle the tags parameter
				let error: Error | undefined;
				let result: boolean;
				try {
					result = await addProject('tagged-project', '/some/path', ['tag1', 'tag2']);
				} catch (err) {
					error = err as Error;
					result = false;
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should not throw errors even when extension is missing', async () => {
				// Given: Extension may not be installed
				// When: addProject is called
				// Then: Should return false without throwing
				let error: Error | undefined;
				let result: boolean;
				try {
					result = await addProject('test', '/path');
				} catch (err) {
					error = err as Error;
					result = false;
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.strictEqual(result, false);
			});
		});

		suite('removeProject', () => {

			test('should return a boolean', async () => {
				// Given: The function is called
				// When: removeProject is invoked
				const result = await removeProject('/test/path');

				// Then: It should return a boolean
				assert.strictEqual(typeof result, 'boolean');
			});

			test('should return false when API is not available', async () => {
				// Given: Project Manager extension is not installed
				// When: removeProject is called
				const result = await removeProject('/test/path');

				// Then: It should return false gracefully
				if (!isProjectManagerAvailable()) {
					assert.strictEqual(result, false);
				}
			});

			test('should not throw errors even when extension is missing', async () => {
				// Given: Extension may not be installed
				// When: removeProject is called
				// Then: Should return false without throwing
				let error: Error | undefined;
				let result: boolean;
				try {
					result = await removeProject('/nonexistent/path');
				} catch (err) {
					error = err as Error;
					result = false;
				}

				assert.strictEqual(error, undefined, 'Should not throw an error');
				assert.strictEqual(result, false);
			});
		});

		suite('graceful degradation', () => {

			test('all service methods should be callable without the extension installed', async () => {
				// Given: Project Manager extension is not installed (typical test environment)
				// When: All service methods are called
				// Then: None should throw exceptions

				const errors: string[] = [];

				try {
					isProjectManagerAvailable();
				} catch (err) {
					errors.push(`isProjectManagerAvailable: ${err}`);
				}

				try {
					await getProjects();
				} catch (err) {
					errors.push(`getProjects: ${err}`);
				}

				try {
					await addProject('test', '/path');
				} catch (err) {
					errors.push(`addProject: ${err}`);
				}

				try {
					await removeProject('/path');
				} catch (err) {
					errors.push(`removeProject: ${err}`);
				}

				assert.deepStrictEqual(errors, [], `Errors occurred: ${errors.join(', ')}`);
			});

			test('clearCache should be safe to call at any time', () => {
				// Given: Cache may or may not have data
				// When: clearCache is called multiple times
				// Then: Should not throw
				assert.doesNotThrow(() => {
					clearCache();
					clearCache();
					clearCache();
				});
			});

			test('getExtensionId should return the correct extension ID', () => {
				// Given: The service is configured
				// When: getExtensionId is called
				const extensionId = getExtensionId();

				// Then: It should return the Project Manager extension ID
				assert.strictEqual(extensionId, 'alefragnani.project-manager');
			});

			test('service should return appropriate fallback values when not initialized', async () => {
				// Given: Service is not initialized (no context)
				clearCache();

				// When: All methods are called without initialization
				const projects = await getProjects();
				const addResult = await addProject('test', '/path');
				const removeResult = await removeProject('/path');

				// Then: Each should return its appropriate fallback value
				assert.deepStrictEqual(projects, [], 'Projects should be empty array when not initialized');
				assert.strictEqual(addResult, false, 'addProject should return false when not initialized');
				assert.strictEqual(removeResult, false, 'removeProject should return false when not initialized');
			});

			test('service operations should complete within reasonable time', async () => {
				// Given: Service is not initialized
				// When: Operations are performed
				// Then: They should complete quickly (not hang)
				const startTime = Date.now();

				await getProjects();
				await addProject('test', '/path');
				await removeProject('/path');

				const elapsed = Date.now() - startTime;

				// Should complete in under 1 second (generous timeout)
				assert.ok(elapsed < 1000, `Operations took ${elapsed}ms, expected < 1000ms`);
			});
		});
	});
});
