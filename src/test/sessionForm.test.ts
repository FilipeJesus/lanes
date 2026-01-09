/**
 * Session Form Tests
 *
 * Tests for the SessionFormProvider webview form that creates new Claude sessions.
 * These tests verify that the form includes workflow selection and properly passes
 * the workflow value to callbacks.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import {
	SessionFormProvider,
	SessionFormSubmitCallback,
	PERMISSION_MODES,
	isValidPermissionMode,
	PermissionMode,
} from '../SessionFormProvider';

/**
 * Mock webview for testing HTML generation.
 * Provides minimal implementation needed to test _getHtmlForWebview.
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

	postMessage(message: unknown): Thenable<boolean> {
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
	public viewType = 'claudeSessionFormView';
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

suite('Session Form', () => {
	let provider: SessionFormProvider;
	let extensionUri: vscode.Uri;

	setup(() => {
		// Use a mock extension URI (file system path to extension)
		extensionUri = vscode.Uri.file('/mock/extension/path');
		provider = new SessionFormProvider(extensionUri);
	});

	suite('Workflow Dropdown', () => {
		test('Session form includes workflow dropdown with None option', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: Workflow dropdown exists
			assert.ok(
				html.includes('id="workflow"'),
				'Form should have workflow dropdown with id="workflow"'
			);
			assert.ok(
				html.includes('name="workflow"'),
				'Form should have workflow dropdown with name="workflow"'
			);

			// Assert: Workflow label exists
			assert.ok(
				html.includes('Workflow Template'),
				'Form should have workflow label'
			);

			// Assert: None option exists (ad-hoc mode)
			assert.ok(
				html.includes('<option value="" selected>'),
				'Form should have None option as default'
			);
			assert.ok(
				html.includes('None (ad-hoc mode)'),
				'None option should indicate ad-hoc mode'
			);

			// Assert: JavaScript handler for updateWorkflows message exists
			assert.ok(
				html.includes('updateWorkflowDropdown'),
				'Form should have updateWorkflowDropdown function for dynamic updates'
			);
			assert.ok(
				html.includes("case 'updateWorkflows'"),
				'Form should handle updateWorkflows message'
			);
		});

		test('Session form populates workflow options when updateWorkflows is called', () => {
			// Arrange
			const mockWorkflows = [
				{ name: 'Feature', description: 'Feature workflow', path: '/path/feature.yaml', isBuiltIn: true },
				{ name: 'Custom', description: 'Custom workflow', path: '/path/custom.yaml', isBuiltIn: false }
			];

			// Act
			provider.updateWorkflows(mockWorkflows);
			const html = getFormHtml(provider);

			// Assert: Built-in workflows are filtered out (only custom workflows shown)
			assert.ok(
				!html.includes('<optgroup label="Built-in">'),
				'Form should NOT have Built-in optgroup (built-in workflows are filtered out)'
			);
			assert.ok(
				!html.includes('<option value="Feature">Feature</option>'),
				'Form should NOT have Feature workflow option (built-in workflows are filtered out)'
			);

			// Assert: Custom workflow options are rendered directly (no optgroup needed)
			assert.ok(
				!html.includes('<optgroup label="Custom">'),
				'Form should NOT have Custom optgroup (custom workflows added directly)'
			);
			// Option value is now the path, display text is the name
			assert.ok(
				html.includes('<option value="/path/custom.yaml">Custom</option>'),
				'Form should have Custom workflow option with path as value'
			);
		});

		test('Workflow dropdown has hint text explaining its purpose', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: Hint text exists
			assert.ok(
				html.includes('Select a workflow to guide Claude through structured phases'),
				'Form should have hint text explaining workflow purpose'
			);
		});

		test('Workflow dropdown follows same styling as other dropdowns', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: Workflow uses select element like permission mode
			const workflowSelectRegex = /<select[^>]*id="workflow"[^>]*>/;
			const permissionSelectRegex = /<select[^>]*id="permissionMode"[^>]*>/;

			assert.ok(
				workflowSelectRegex.test(html),
				'Workflow should use select element'
			);
			assert.ok(
				permissionSelectRegex.test(html),
				'Permission mode should use select element'
			);
		});

		test('Workflow dropdown is part of form submission data', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: JavaScript references workflow input
			assert.ok(
				html.includes("const workflowInput = document.getElementById('workflow')"),
				'JavaScript should get workflow input element'
			);

			// Assert: Form submission includes workflow
			assert.ok(
				html.includes('workflow: workflow'),
				'Form submission should include workflow value'
			);

			// Assert: State persistence includes workflow
			assert.ok(
				html.includes('workflow: workflowInput.value'),
				'State persistence should include workflow'
			);
		});
	});

	suite('Workflow Callback', () => {
		test('Session form passes workflow to callback', async () => {
			// Arrange
			let receivedWorkflow: string | null = null;
			let callbackInvoked = false;

			const callback: SessionFormSubmitCallback = (
				name: string,
				prompt: string,
				acceptanceCriteria: string,
				sourceBranch: string,
				permissionMode: PermissionMode,
				workflow: string | null
			) => {
				callbackInvoked = true;
				receivedWorkflow = workflow;
			};

			provider.setOnSubmit(callback);

			// Create mock view and resolve it
			const mockView = new MockWebviewView();
			provider.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as vscode.CancellationToken
			);

			// Act: Simulate form submission with workflow value
			mockView.webview.simulateMessage({
				command: 'createSession',
				name: 'test-session',
				prompt: 'Test prompt',
				acceptanceCriteria: 'Test criteria',
				sourceBranch: 'main',
				permissionMode: 'default',
				workflow: 'feature'
			});

			// Allow async callback to complete
			await new Promise(resolve => setTimeout(resolve, 10));

			// Assert
			assert.ok(callbackInvoked, 'Callback should have been invoked');
			assert.strictEqual(receivedWorkflow, 'feature', 'Callback should receive workflow value');
		});

		test('Session form passes null workflow when none selected', async () => {
			// Arrange
			let receivedWorkflow: string | null = 'should-be-null';
			let callbackInvoked = false;

			const callback: SessionFormSubmitCallback = (
				_name: string,
				_prompt: string,
				_acceptanceCriteria: string,
				_sourceBranch: string,
				_permissionMode: PermissionMode,
				workflow: string | null
			) => {
				callbackInvoked = true;
				receivedWorkflow = workflow;
			};

			provider.setOnSubmit(callback);

			const mockView = new MockWebviewView();
			provider.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as vscode.CancellationToken
			);

			// Act: Simulate form submission with empty workflow (None selected)
			mockView.webview.simulateMessage({
				command: 'createSession',
				name: 'test-session',
				prompt: '',
				acceptanceCriteria: '',
				sourceBranch: '',
				permissionMode: 'default',
				workflow: null
			});

			await new Promise(resolve => setTimeout(resolve, 10));

			// Assert
			assert.ok(callbackInvoked, 'Callback should have been invoked');
			assert.strictEqual(receivedWorkflow, null, 'Callback should receive null for no workflow');
		});

		test('Session form converts empty string workflow to null', async () => {
			// Arrange
			let receivedWorkflow: string | null = 'should-be-null';

			const callback: SessionFormSubmitCallback = (
				_name: string,
				_prompt: string,
				_acceptanceCriteria: string,
				_sourceBranch: string,
				_permissionMode: PermissionMode,
				workflow: string | null
			) => {
				receivedWorkflow = workflow;
			};

			provider.setOnSubmit(callback);

			const mockView = new MockWebviewView();
			provider.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as vscode.CancellationToken
			);

			// Act: Simulate form submission with empty string workflow
			mockView.webview.simulateMessage({
				command: 'createSession',
				name: 'test-session',
				prompt: '',
				acceptanceCriteria: '',
				sourceBranch: '',
				permissionMode: 'default',
				workflow: ''
			});

			await new Promise(resolve => setTimeout(resolve, 10));

			// Assert: Empty string should be converted to null
			assert.strictEqual(receivedWorkflow, null, 'Empty string workflow should be converted to null');
		});

		test('SessionFormSubmitCallback type includes workflow parameter', () => {
			// This is a compile-time type check
			// If the type signature is wrong, this test file won't compile

			// Arrange
			const callback: SessionFormSubmitCallback = (
				name: string,
				prompt: string,
				acceptanceCriteria: string,
				sourceBranch: string,
				permissionMode: PermissionMode,
				workflow: string | null
			) => {
				// Use all parameters to verify they're in the signature
				assert.ok(name);
				assert.ok(typeof prompt === 'string');
				assert.ok(typeof acceptanceCriteria === 'string');
				assert.ok(typeof sourceBranch === 'string');
				assert.ok(PERMISSION_MODES.includes(permissionMode));
				assert.ok(workflow === null || typeof workflow === 'string');
			};

			// Act & Assert: Just verify callback can be set
			provider.setOnSubmit(callback);
			assert.ok(true, 'Callback with workflow parameter was accepted');
		});

		test('Callback receives all expected workflow options', async () => {
			// Arrange
			const receivedWorkflows: (string | null)[] = [];

			const callback: SessionFormSubmitCallback = (
				_name: string,
				_prompt: string,
				_acceptanceCriteria: string,
				_sourceBranch: string,
				_permissionMode: PermissionMode,
				workflow: string | null
			) => {
				receivedWorkflows.push(workflow);
			};

			provider.setOnSubmit(callback);

			const mockView = new MockWebviewView();
			provider.resolveWebviewView(
				mockView as unknown as vscode.WebviewView,
				{} as vscode.WebviewViewResolveContext,
				{ isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as vscode.CancellationToken
			);

			// Act: Simulate submissions with each workflow option
			const workflowOptions = [null, 'feature', 'bugfix', 'refactor'];
			for (const workflow of workflowOptions) {
				mockView.webview.simulateMessage({
					command: 'createSession',
					name: `test-${workflow || 'none'}`,
					prompt: '',
					acceptanceCriteria: '',
					sourceBranch: '',
					permissionMode: 'default',
					workflow: workflow
				});
				await new Promise(resolve => setTimeout(resolve, 10));
			}

			// Assert
			assert.strictEqual(receivedWorkflows.length, 4, 'Should receive all workflow submissions');
			assert.strictEqual(receivedWorkflows[0], null, 'Should receive null workflow');
			assert.strictEqual(receivedWorkflows[1], 'feature', 'Should receive feature workflow');
			assert.strictEqual(receivedWorkflows[2], 'bugfix', 'Should receive bugfix workflow');
			assert.strictEqual(receivedWorkflows[3], 'refactor', 'Should receive refactor workflow');
		});
	});

	suite('Form State Persistence', () => {
		test('Form JavaScript saves workflow in state', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: saveState function includes workflow
			assert.ok(
				html.includes("workflow: workflowInput.value"),
				'saveState should include workflow value'
			);
		});

		test('Form JavaScript restores workflow from state', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: State restoration includes workflow
			assert.ok(
				html.includes("workflowInput.value = previousState.workflow || ''"),
				'State restoration should set workflow value'
			);
		});

		test('Form JavaScript clears workflow on clearForm', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: clearForm resets workflow
			assert.ok(
				html.includes("workflowInput.value = ''"),
				'clearForm should reset workflow value'
			);

			// Assert: Cleared state includes workflow
			assert.ok(
				html.includes("workflow: ''"),
				'Cleared state should have empty workflow'
			);
		});

		test('Form JavaScript adds change listener to workflow dropdown', () => {
			// Arrange & Act
			const html = getFormHtml(provider);

			// Assert: Change listener is attached
			assert.ok(
				html.includes("workflowInput.addEventListener('change', saveState)"),
				'Workflow dropdown should have change listener for state persistence'
			);
		});
	});

	suite('Permission Mode Validation', () => {
		// These tests ensure the existing permission mode functionality still works
		// alongside the new workflow feature

		test('isValidPermissionMode validates known modes', () => {
			for (const mode of PERMISSION_MODES) {
				assert.ok(
					isValidPermissionMode(mode),
					`${mode} should be a valid permission mode`
				);
			}
		});

		test('isValidPermissionMode rejects invalid modes', () => {
			assert.ok(!isValidPermissionMode('invalid'), 'invalid should not be valid');
			assert.ok(!isValidPermissionMode(''), 'empty string should not be valid');
			assert.ok(!isValidPermissionMode(null), 'null should not be valid');
			assert.ok(!isValidPermissionMode(undefined), 'undefined should not be valid');
			assert.ok(!isValidPermissionMode(123), 'number should not be valid');
		});
	});
});
