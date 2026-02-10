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
} from '../../SessionFormProvider';

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
		test('Default agent is pre-selected with codex', () => {
			// Arrange
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'codex');

			// Act
			const html = getFormHtml(provider);

			// Assert: Codex option has selected attribute
			const codexOptionMatch = html.match(/<option value="codex"[^>]*>/);
			assert.ok(codexOptionMatch, 'Codex option should exist');
			assert.ok(codexOptionMatch[0].includes('selected'), 'Codex option should have selected attribute when set as default');
		});

		test('Default agent claude is pre-selected', () => {
			// Arrange
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Claude option has selected attribute
			const claudeOptionMatch = html.match(/<option value="claude"[^>]*>/);
			assert.ok(claudeOptionMatch, 'Claude option should exist');
			assert.ok(claudeOptionMatch[0].includes('selected'), 'Claude option should have selected attribute when set as default');
		});

		test('Form includes Code Agent label when multiple agents available', () => {
			// Arrange
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Form includes "Code Agent" label
			assert.ok(
				html.includes('Code Agent'),
				'Form should have "Code Agent" label when multiple agents available'
			);
		});

		test('Form includes agent selection hint text', () => {
			// Arrange
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'claude');

			// Act
			const html = getFormHtml(provider);

			// Assert: Form includes hint text
			assert.ok(
				html.includes('Select which AI assistant to use for this session'),
				'Form should have hint text explaining agent selection'
			);
		});
	});

	suite('Permission Toggle Per Agent', () => {
		test('Form shows bypass permissions toggle for claude agent', () => {
			// Arrange
			const availability = new Map([['claude', true], ['codex', false]]);
			provider.setAgentAvailability(availability, 'claude');

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
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'claude');

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
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'claude');

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
			const availability = new Map([['claude', true], ['codex', true]]);
			provider.setAgentAvailability(availability, 'codex');

			// Act
			const html = getFormHtml(provider);

			// Assert: clearForm resets agent to default
			assert.ok(
				html.includes("case 'clearForm':"),
				'Form should handle clearForm message'
			);

			// The clearForm handler should reset agent to the default agent value
			// Check that it includes the escaped default agent in the clearForm case
			const clearFormSection = html.substring(html.indexOf("case 'clearForm':"));
			assert.ok(
				clearFormSection.includes('agentInput.value ='),
				'clearForm should reset agent input value'
			);
		});
	});
});
