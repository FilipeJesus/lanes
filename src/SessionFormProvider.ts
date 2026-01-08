import * as vscode from 'vscode';

/**
 * Valid permission modes for Claude CLI
 */
export const PERMISSION_MODES = ['acceptEdits', 'bypassPermissions', 'default', 'delegate', 'dontAsk', 'plan'] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];

/**
 * Validates that a string is a valid PermissionMode.
 * Used to prevent command injection from untrusted input.
 */
export function isValidPermissionMode(mode: unknown): mode is PermissionMode {
    return typeof mode === 'string' && PERMISSION_MODES.includes(mode as PermissionMode);
}

/**
 * Callback type for when the session form is submitted.
 * Can be async - the form will wait for completion before clearing.
 */

export type SessionFormSubmitCallback = (
    name: string,
    prompt: string,
    acceptanceCriteria: string,
    sourceBranch: string,
    permissionMode: PermissionMode,
    workflow: string | null
) => void | Promise<void>;

/**
 * Provides a webview form for creating new Claude sessions.
 * Displays above the session list in the sidebar.
 */
export class SessionFormProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeSessionFormView';

    private _view?: vscode.WebviewView;
    private _onSubmit?: SessionFormSubmitCallback;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    /**
     * Set the callback to be invoked when the form is submitted
     */
    public setOnSubmit(callback: SessionFormSubmitCallback): void {
        this._onSubmit = callback;
    }

    /**
     * Generate a random nonce for Content Security Policy
     */
    private _getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    /**
     * Called when the webview view is resolved (becomes visible)
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        // Note: Form state is automatically preserved via vscode.getState/setState
        // when the webview is hidden or recreated (e.g., switching tabs, collapsing)

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'createSession':
                    if (this._onSubmit) {
                        try {
                            // Await the callback to ensure session creation completes before clearing form
                            await this._onSubmit(
                                message.name,
                                message.prompt,
                                message.acceptanceCriteria || '',
                                message.sourceBranch || '',
                                message.permissionMode || 'default',
                                message.workflow || null
                            );
                        } catch (err) {
                            // Error is already shown by createSession, but log for debugging
                            console.error('Lanes: Session creation failed:', err);
                            // Don't clear form on error so user can retry
                            return;
                        }
                    }
                    // Clear the form after successful submission
                    this._view?.webview.postMessage({ command: 'clearForm' });
                    break;
            }
        });
    }

    /**
     * Generate the HTML content for the webview form
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const nonce = this._getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>New Session</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-sideBar-background);
            padding: 12px;
        }

        .form-group {
            margin-bottom: 12px;
        }

        label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
            color: var(--vscode-foreground);
        }

        input[type="text"],
        textarea,
        select {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            border-radius: 2px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        input[type="text"]:focus,
        textarea:focus,
        select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }

        input[type="text"]::placeholder,
        textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        textarea {
            min-height: 80px;
            resize: vertical;
        }

        button {
            width: 100%;
            padding: 8px 12px;
            border: none;
            border-radius: 2px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            cursor: pointer;
            font-weight: 500;
        }

        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        button:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
    </style>
</head>
<body>
    <form id="sessionForm">
        <div class="form-group">
            <label for="name">Session Name</label>
            <input
                type="text"
                id="name"
                name="name"
                placeholder="fix-login-bug"
                required
                autocomplete="off"
            />
            <div class="hint">Used as the Git branch name</div>
        </div>

        <div class="form-group">
            <label for="sourceBranch">Source Branch (optional)</label>
            <input
                type="text"
                id="sourceBranch"
                name="sourceBranch"
                placeholder="main"
                autocomplete="off"
            />
            <div class="hint">Leave empty to branch from current HEAD</div>
        </div>

        <div class="form-group">
            <label for="prompt">Starting Prompt (optional)</label>
            <textarea
                id="prompt"
                name="prompt"
                placeholder="Describe the task for Claude..."
            ></textarea>
            <div class="hint">Sent to Claude after the session starts</div>
        </div>

        <div class="form-group">
            <label for="acceptanceCriteria">Acceptance Criteria (optional)</label>
            <textarea
                id="acceptanceCriteria"
                name="acceptanceCriteria"
                placeholder="Define what success looks like..."
            ></textarea>
            <div class="hint">Criteria for Claude to meet</div>
        </div>

        <div class="form-group">
            <label for="permissionMode">Permission Mode</label>
            <select id="permissionMode" name="permissionMode">
                <option value="default" selected>default</option>
                <option value="acceptEdits">acceptEdits</option>
                <option value="bypassPermissions">bypassPermissions</option>
                <option value="delegate">delegate</option>
                <option value="dontAsk">dontAsk</option>
                <option value="plan">plan</option>
            </select>
            <div class="hint">Controls Claude's permission behavior</div>
        </div>

        <div class="form-group">
            <label for="workflow">Workflow Template</label>
            <select id="workflow" name="workflow">
                <option value="" selected>None (ad-hoc mode)</option>
                <option value="feature">Feature Development</option>
                <option value="bugfix">Bug Fix</option>
                <option value="refactor">Refactoring</option>
            </select>
            <div class="hint">Optional: Select a workflow to guide Claude through structured phases</div>
        </div>

        <button type="submit" id="submitBtn">Create Session</button>
    </form>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('sessionForm');
        const nameInput = document.getElementById('name');
        const sourceBranchInput = document.getElementById('sourceBranch');
        const promptInput = document.getElementById('prompt');
        const acceptanceCriteriaInput = document.getElementById('acceptanceCriteria');
        const permissionModeInput = document.getElementById('permissionMode');
        const workflowInput = document.getElementById('workflow');

        // Restore saved state when webview is recreated
        const previousState = vscode.getState();
        if (previousState) {
            nameInput.value = previousState.name || '';
            sourceBranchInput.value = previousState.sourceBranch || '';
            promptInput.value = previousState.prompt || '';
            acceptanceCriteriaInput.value = previousState.acceptanceCriteria || '';
            permissionModeInput.value = previousState.permissionMode || 'default';
            workflowInput.value = previousState.workflow || '';
        }

        // Save state whenever form values change
        function saveState() {
            vscode.setState({
                name: nameInput.value,
                sourceBranch: sourceBranchInput.value,
                prompt: promptInput.value,
                acceptanceCriteria: acceptanceCriteriaInput.value,
                permissionMode: permissionModeInput.value,
                workflow: workflowInput.value
            });
        }

        // Attach change listeners to all form inputs
        nameInput.addEventListener('input', saveState);
        sourceBranchInput.addEventListener('input', saveState);
        promptInput.addEventListener('input', saveState);
        acceptanceCriteriaInput.addEventListener('input', saveState);
        permissionModeInput.addEventListener('change', saveState);
        workflowInput.addEventListener('change', saveState);

        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = nameInput.value.trim();
            const sourceBranch = sourceBranchInput.value.trim();
            const prompt = promptInput.value.trim();
            const acceptanceCriteria = acceptanceCriteriaInput.value.trim();
            const permissionMode = permissionModeInput.value;
            const workflow = workflowInput.value;

            if (!name) {
                nameInput.focus();
                return;
            }

            // Send message to extension
            vscode.postMessage({
                command: 'createSession',
                name: name,
                sourceBranch: sourceBranch,
                prompt: prompt,
                acceptanceCriteria: acceptanceCriteria,
                permissionMode: permissionMode,
                workflow: workflow || null
            });
        });

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'clearForm':
                    nameInput.value = '';
                    sourceBranchInput.value = '';
                    promptInput.value = '';
                    acceptanceCriteriaInput.value = '';
                    permissionModeInput.value = 'default';
                    workflowInput.value = '';
                    // Clear saved state after successful submission
                    vscode.setState({
                        name: '',
                        sourceBranch: '',
                        prompt: '',
                        acceptanceCriteria: '',
                        permissionMode: 'default',
                        workflow: ''
                    });
                    nameInput.focus();
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}
