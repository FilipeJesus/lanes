/**
 * Session Form Agent Selection Tests
 *
 * Tests agent-specific behavior in the session form webview.
 * Focuses on agent dropdown rendering, permission toggle per agent, and agent callback integration.
 *
 * NOTE: This test file does NOT duplicate tests from session-form.test.ts.
 * It only tests agent-specific behaviors that are not already covered.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	SessionFormProvider,
	SessionFormSubmitCallback,
	PermissionMode,
} from '../../vscode/providers/SessionFormProvider';

/**
 * Mock webview for testing HTML generation.
 */
class MockWebview implements vscode.Webview {
	public cspSource = 'mock-csp-source';
	public options: vscode.WebviewOptions = {};
	public html = '';

	private messageHandler?: (message: unknown) => void;

	onDidReceiveMessage(handler: (message: unknown) => void): vscode.Disposable {
		this.messageHandler = handler;
		return { dispose: () => { this.messageHandler = undefined; } };
	}

	postMessage(_message: unknown): Thenable<boolean> {
		return Promise.resolve(true);
	}

	asWebviewUri(localResource: vscode.Uri): vscode.Uri {
		return localResource;
	}

	// Helper to simulate receiving a message from the webview
	simulateMessage(message: unknown): void {
		if (this.messageHandler) {
			this.messageHandler(message);
		}
	}
}

/**
 * Mock WebviewView for testing resolveWebviewView.
 */
class MockWebviewView implements Partial<vscode.WebviewView> {
	public webview: MockWebview;
	public viewType = 'lanesSessionFormView';
	public visible = true;

	constructor() {
		this.webview = new MockWebview();
	}
}

/**
 * Helper to extract the HTML content from SessionFormProvider.
 * Uses reflection to access the private _getHtmlForWebview method.
 */
function getFormHtml(provider: SessionFormProvider): string {
	const mockWebview = new MockWebview();
	// Access the private method via any cast
	return (provider as unknown as { _getHtmlForWebview(w: MockWebview): string })._getHtmlForWebview(mockWebview);
}

suite('Session Form Agent Selection', () => {
	let provider: SessionFormProvider;
	let extensionUri: vscode.Uri;

	setup(() => {
		// Use a mock extension URI (file system path to extension)
		extensionUri = vscode.Uri.file('/mock/extension/path');
		provider = new SessionFormProvider(extensionUri);
	});

	suite('Agent Dropdown Rendering', () => {
		test('Default agent codex is pre-selected', () => {
			// Arrange
			provider.setDefaultAgent('codex');

			// Act
			const html = getFormHtml(provider);

			// Assert: Codex menu item has active class, trigger shows codex SVG
			const codexItemMatch = html.match(/<button[^>]*class="[^"]*"[^>]*data-agent="codex"/);
			assert.ok(codexItemMatch, 'Codex menu item should exist');
			assert.ok(codexItemMatch[0].includes('active'), 'Codex item should have active class when set as default');
			// Trigger should show Codex title
			assert.ok(html.includes('title="Codex CLI"'), 'Trigger should have Codex CLI tooltip when codex is default');
		});

		test('Default agent claude is pre-selected', () => {
			// Arrange
			provider.setDefaultAgent('claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Claude menu item has active class
			const claudeItemMatch = html.match(/<button[^>]*class="[^"]*"[^>]*data-agent="claude"/);
			assert.ok(claudeItemMatch, 'Claude menu item should exist');
			assert.ok(claudeItemMatch[0].includes('active'), 'Claude item should have active class when set as default');
			// Trigger should show Claude title
			assert.ok(html.includes('title="Claude Code"'), 'Trigger should have Claude Code tooltip when claude is default');
		});

		test('Form includes agent dropdown with SVG logos when multiple agents available', () => {
			// Arrange
			provider.setDefaultAgent('claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Form includes agent dropdown with SVG icons
			assert.ok(
				html.includes('id="agentDropdown"'),
				'Form should have agent dropdown when multiple agents available'
			);
			assert.ok(
				html.includes('<svg'),
				'Agent dropdown should contain SVG logos'
			);
		});

		test('Dropdown trigger has tooltip title', () => {
			// Arrange
			provider.setDefaultAgent('claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Trigger button has title attribute
			assert.ok(
				html.includes('id="agentTrigger"'),
				'Form should have dropdown trigger button'
			);
			assert.ok(
				html.includes('title="Claude Code"'),
				'Trigger should have tooltip showing current agent name'
			);
		});
	});

	suite('Permission Toggle Per Agent', () => {
		test('Form shows bypass permissions toggle for claude agent', () => {
			// Arrange
			provider.setDefaultAgent('claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Bypass button exists
			assert.ok(
				html.includes('id="bypassPermissionsBtn"'),
				'Form should have bypass permissions button when agent is claude'
			);
			assert.ok(
				html.includes('class="bypass-btn"'),
				'Bypass button should have bypass-btn class'
			);
		});

		test('Form JavaScript includes permission toggle button click handler', () => {
			// Arrange
			provider.setDefaultAgent('claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: JavaScript includes bypass button click handler
			assert.ok(
				html.includes("bypassPermissionsBtn.addEventListener('click'"),
				'Form JavaScript should have bypass button click handler'
			);
			assert.ok(
				html.includes('bypassPermissions = !bypassPermissions'),
				'Click handler should toggle bypassPermissions state'
			);
		});

		test('Form JavaScript includes updateBypassBtn function', () => {
			// Arrange
			provider.setDefaultAgent('claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: updateBypassBtn function exists
			assert.ok(
				html.includes('function updateBypassBtn()'),
				'Form JavaScript should have updateBypassBtn function'
			);
			assert.ok(
				html.includes("bypassPermissionsBtn.classList.add('active')"),
				'updateBypassBtn should add active class when bypassing'
			);
		});
	});

	suite('Agent Callback Integration', () => {
		test('Form submission with codex agent passes codex through callback', async () => {
			// Arrange
			let receivedAgent: string = '';
			let callbackInvoked = false;

			const callback: SessionFormSubmitCallback = (
				_name: string,
				agent: string,
				_prompt: string,
				_sourceBranch: string,
				_permissionMode: PermissionMode,
				_workflow: string | null,
				_attachments: string[]
			) => {
				callbackInvoked = true;
				receivedAgent = agent;
			};

			provider.setOnSubmit(callback);

			const mockView = new MockWebviewView();
			provider.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as vscode.CancellationToken
			);

			// Act: Simulate form submission with codex agent
			mockView.webview.simulateMessage({
				command: 'createSession',
				name: 'test-session',
				agent: 'codex',
				prompt: '',
				sourceBranch: '',
				permissionMode: 'acceptEdits',
				workflow: null,
				attachments: []
			});

			await new Promise(resolve => setTimeout(resolve, 10));

			// Assert
			assert.ok(callbackInvoked, 'Callback should have been invoked');
			assert.strictEqual(receivedAgent, 'codex', 'Callback should receive codex as agent');
		});

		test('Form submission without agent field defaults to claude in callback', async () => {
			// Arrange
			let receivedAgent: string = '';

			const callback: SessionFormSubmitCallback = (
				_name: string,
				agent: string,
				_prompt: string,
				_sourceBranch: string,
				_permissionMode: PermissionMode,
				_workflow: string | null,
				_attachments: string[]
			) => {
				receivedAgent = agent;
			};

			provider.setOnSubmit(callback);

			const mockView = new MockWebviewView();
			provider.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as vscode.CancellationToken
			);

			// Act: Simulate form submission without agent field (message.agent is undefined)
			mockView.webview.simulateMessage({
				command: 'createSession',
				name: 'test-session',
				// No agent field
				prompt: '',
				sourceBranch: '',
				permissionMode: 'acceptEdits',
				workflow: null,
				attachments: []
			});

			await new Promise(resolve => setTimeout(resolve, 10));

			// Assert
			assert.strictEqual(receivedAgent, 'claude', 'Callback should receive claude as default agent when not provided');
		});

		test('Form clears agent selection to default after submission', () => {
			// Arrange
			provider.setDefaultAgent('codex');

			// Act
			const html = getFormHtml(provider);

			// Assert: clearForm resets agent to default
			assert.ok(
				html.includes("case 'clearForm':"),
				'Form should handle clearForm message'
			);

			// The clearForm handler should reset agent selection via selectAgent function
			const clearFormSection = html.substring(html.indexOf("case 'clearForm':"));
			assert.ok(
				clearFormSection.includes('selectAgent('),
				'clearForm should reset agent selection via selectAgent'
			);
		});
	});
});
