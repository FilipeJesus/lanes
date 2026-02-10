import * as vscode from 'vscode';
import * as path from 'path';
import { WorkflowMetadata } from './workflow';

/**
 * Valid permission modes for Claude CLI
 */
export const PERMISSION_MODES = ['acceptEdits', 'bypassPermissions'] as const;
export type PermissionMode = typeof PERMISSION_MODES[number];

/**
 * Valid chime sound options
 */
export const CHIME_SOUNDS = ['chime', 'alarm', 'level-up', 'notification'] as const;
export type ChimeSound = typeof CHIME_SOUNDS[number];

/**
 * Validates that a string is a valid PermissionMode.
 * Used to prevent command injection from untrusted input.
 */
export function isValidPermissionMode(mode: unknown): mode is PermissionMode {
    return typeof mode === 'string' && PERMISSION_MODES.includes(mode as PermissionMode);
}

/**
 * Validates that a string is a valid ChimeSound.
 * Used to prevent invalid file paths.
 */
export function isValidChimeSound(sound: unknown): sound is ChimeSound {
    return typeof sound === 'string' && CHIME_SOUNDS.includes(sound as ChimeSound);
}

/**
 * Callback type for when the session form is submitted.
 * Can be async - the form will wait for completion before clearing.
 */

export type SessionFormSubmitCallback = (
    name: string,
    agent: string,
    prompt: string,
    sourceBranch: string,
    permissionMode: PermissionMode,
    workflow: string | null,
    attachments: string[]
) => void | Promise<void>;

/**
 * Provides a webview form for creating new Claude sessions.
 * Displays above the session list in the sidebar.
 */
export class SessionFormProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'lanesSessionFormView';

    private _view?: vscode.WebviewView;
    private _onSubmit?: SessionFormSubmitCallback;
    private _onRefreshWorkflows?: () => void | Promise<void>;
    private _workflows: WorkflowMetadata[] = [];
    private _agentAvailability: Map<string, boolean> = new Map();
    private _defaultAgent: string = 'claude';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    /**
     * Update the available workflows and refresh the webview
     */
    public updateWorkflows(workflows: WorkflowMetadata[]): void {
        this._workflows = workflows;
        // Send updated workflows to the webview if it exists
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateWorkflows',
                workflows: workflows.map(w => ({
                    name: w.name,
                    description: w.description,
                    path: w.path,
                    isBuiltIn: w.isBuiltIn
                }))
            });
        }
    }

    /**
     * Set the callback to be invoked when the form is submitted
     */
    public setOnSubmit(callback: SessionFormSubmitCallback): void {
        this._onSubmit = callback;
    }

    /**
     * Set the callback to be invoked when the refresh workflows button is clicked
     */
    public setOnRefreshWorkflows(callback: () => void | Promise<void>): void {
        this._onRefreshWorkflows = callback;
    }

    /**
     * Set agent availability and default agent for the form dropdown
     */
    public setAgentAvailability(availability: Map<string, boolean>, defaultAgent: string): void {
        this._agentAvailability = availability;
        this._defaultAgent = defaultAgent;

        // If webview is already visible, send update
        if (this._view) {
            this._view.webview.postMessage({
                command: 'updateAgentAvailability',
                availability: Array.from(availability.entries()),
                defaultAgent: defaultAgent
            });
        }
    }

    /**
     * Generate HTML options for workflow dropdown
     * Only shows custom workflows (built-in workflows are filtered out)
     * Uses the full path as the value so MCP server can find the workflow file
     */
    private _getWorkflowOptionsHtml(): string {
        // Filter to only include custom workflows
        const custom = this._workflows.filter(w => !w.isBuiltIn);

        if (custom.length === 0) {
            return '';
        }

        let html = '';
        for (const w of custom) {
            html += `<option value="${this._escapeHtml(w.path)}">${this._escapeHtml(w.name)}</option>`;
        }

        return html;
    }

    /**
     * Escape HTML special characters
     */
    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Agent definitions with inline SVG logos
     */
    private static readonly AGENTS = [
        {
            name: 'claude',
            label: 'Claude Code',
            // Claude sunburst logo — rounded rays radiating from center
            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="12" y1="10.5" x2="12" y2="2" stroke-width="2.4" transform="rotate(0 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3" stroke-width="2.4" transform="rotate(33 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3.5" stroke-width="2.2" transform="rotate(62 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2.5" stroke-width="2.4" transform="rotate(98 12 12)"/><line x1="12" y1="10.5" x2="12" y2="4" stroke-width="2.2" transform="rotate(130 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2" stroke-width="2.4" transform="rotate(163 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3.5" stroke-width="2.2" transform="rotate(195 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2.5" stroke-width="2.4" transform="rotate(228 12 12)"/><line x1="12" y1="10.5" x2="12" y2="4" stroke-width="2.2" transform="rotate(260 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2" stroke-width="2.4" transform="rotate(292 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3" stroke-width="2.2" transform="rotate(325 12 12)"/></svg>'
        },
        {
            name: 'codex',
            label: 'Codex CLI',
            // OpenAI logo
            svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22.28 9.82a5.99 5.99 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.99 5.99 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.99 5.99 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zM13.26 22.43a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.5zM3.6 18.3a4.47 4.47 0 0 1-.54-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06l-4.84 2.79a4.5 4.5 0 0 1-6.13-1.64zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.97V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4 14.02A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86l-5.84-3.39 2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1V12.44a.79.79 0 0 0-.4-.67zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86L6.29 11.7a.08.08 0 0 1-.04-.06V6.08a4.5 4.5 0 0 1 7.37-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.39.68zm1.1-2.37l2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3z"/></svg>'
        }
    ];

    /**
     * Generate HTML for the custom agent dropdown (shown next to session name)
     * Shows the selected agent's logo as trigger; dropdown menu shows logo + label per agent.
     * Default agent is determined by the lanes.defaultAgent global setting.
     */
    private _getAgentSelectorHtml(): string {
        // Count available agents to decide visibility
        let availableCount = 0;
        for (const available of this._agentAvailability.values()) {
            if (available) { availableCount++; }
        }

        const hidden = availableCount <= 1 ? ' style="display:none"' : '';

        // Find the default agent's SVG for the trigger button
        const defaultDef = SessionFormProvider.AGENTS.find(a => a.name === this._defaultAgent)
            ?? SessionFormProvider.AGENTS[0];

        // Build dropdown menu items
        let itemsHtml = '';
        for (const agent of SessionFormProvider.AGENTS) {
            const available = this._agentAvailability.get(agent.name) ?? false;
            const active = agent.name === this._defaultAgent ? ' active' : '';
            const disabled = available ? '' : ' disabled';
            const label = available ? agent.label : `${agent.label} (not installed)`;

            itemsHtml += `<button type="button" class="agent-dropdown-item${active}" data-agent="${this._escapeHtml(agent.name)}"${disabled}>${agent.svg}<span>${this._escapeHtml(label)}</span></button>`;
        }

        return `<div class="agent-dropdown" id="agentDropdown"${hidden}>` +
            `<button type="button" class="agent-dropdown-trigger" id="agentTrigger" title="${this._escapeHtml(defaultDef.label)}" aria-haspopup="true" aria-expanded="false">${defaultDef.svg}</button>` +
            `<div class="agent-dropdown-menu" id="agentMenu">${itemsHtml}</div>` +
            `</div>`;
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

        // Send current workflows to the webview after it's resolved
        // This ensures workflows are available even if the webview is recreated
        if (this._workflows.length > 0) {
            webviewView.webview.postMessage({
                command: 'updateWorkflows',
                workflows: this._workflows.map(w => ({
                    name: w.name,
                    description: w.description,
                    path: w.path,
                    isBuiltIn: w.isBuiltIn
                }))
            });
        }

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async message => {
            switch (message.command) {
                case 'showFilePicker':
                    const uris = await vscode.window.showOpenDialog({
                        canSelectMany: true,
                        canSelectFiles: true,
                        canSelectFolders: false,
                        openLabel: 'Attach',
                        title: 'Select files to attach',
                        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
                    });
                    if (uris && uris.length > 0) {
                        this._view?.webview.postMessage({
                            command: 'filesSelected',
                            files: uris.map(uri => ({
                                path: uri.fsPath,
                                name: path.basename(uri.fsPath)
                            }))
                        });
                    }
                    break;
                case 'createSession':
                    if (this._onSubmit) {
                        try {
                            // Await the callback to ensure session creation completes before clearing form
                            await this._onSubmit(
                                message.name,
                                message.agent || 'claude',
                                message.prompt,
                                message.sourceBranch || '',
                                message.permissionMode || 'acceptEdits',
                                message.workflow || null,
                                message.attachments || []
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
                case 'refreshWorkflows':
                    if (this._onRefreshWorkflows) {
                        try {
                            await this._onRefreshWorkflows();
                        } catch (err) {
                            console.error('Lanes: Workflow refresh failed:', err);
                        }
                    }
                    break;
            }
        });
    }

    /**
     * Play the chime sound in the webview
     */
    public playChime() {
        if (this._view && this._view.visible) {
            this._view.webview.postMessage({ command: 'playChime' });
        } else {
            console.log("❌ Extension: Webview is hidden or undefined.");
        }
    }

    /**
     * Generate the HTML content for the webview form
     */
    private _getHtmlForWebview(webview: vscode.Webview): string {
        // Read the configured chime sound from settings
        const config = vscode.workspace.getConfiguration('lanes');
        const configuredChime = config.get<string>('chimeSound', 'chime');

        // Validate the configured chime sound
        let selectedChime: ChimeSound = 'chime'; // Default fallback
        if (isValidChimeSound(configuredChime)) {
            selectedChime = configuredChime;
        } else if (configuredChime !== 'chime') {
            // Only warn if user explicitly set an invalid value
            console.warn(`Lanes: Invalid chime sound "${configuredChime}" in configuration. Falling back to "chime". Valid options: ${CHIME_SOUNDS.join(', ')}`);
        }

        // Construct the audio URI using the validated chime sound
        const chimeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', `${selectedChime}.mp3`)
        );

        const nonce = this._getNonce();
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; media-src ${webview.cspSource};">
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
            padding-bottom: 36px;
        }

        .textarea-wrapper {
            position: relative;
            width: 100%;
        }

        .attach-btn {
            position: absolute;
            bottom: 6px;
            right: 6px;
            width: 28px;
            height: 28px;
            padding: 0;
            border: none;
            background: transparent;
            cursor: pointer;
            font-size: 16px;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            z-index: 1;
        }

        .attach-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .attachment-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 6px;
        }

        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 4px 2px 8px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 3px;
            font-size: 12px;
            max-width: 100%;
        }

        .chip-icon {
            flex-shrink: 0;
            font-size: 14px;
        }

        .chip-label {
            max-width: 150px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .chip-remove {
            width: 18px;
            height: 18px;
            padding: 0;
            border: none;
            background: transparent;
            color: inherit;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            border-radius: 2px;
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .chip-remove:hover {
            background-color: rgba(255, 255, 255, 0.15);
        }

        .attachment-warning {
            font-size: 11px;
            color: var(--vscode-editorWarning-foreground, #cca700);
            margin-top: 4px;
            opacity: 1;
            transition: opacity 0.3s ease;
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

        .workflow-control {
            display: flex;
            gap: 6px;
            align-items: center;
        }

        .workflow-control select {
            flex: 1;
        }

        .workflow-control button {
            width: auto;
            min-width: 32px;
            padding: 6px 10px;
            flex-shrink: 0;
        }

        .submit-row {
            display: flex;
            gap: 6px;
            align-items: stretch;
        }

        .submit-row button[type="submit"] {
            flex: 1;
        }

        .bypass-btn {
            width: 40px;
            min-width: 40px;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            border: 1px solid transparent;
            background-color: var(--vscode-input-background);
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 2px;
        }

        .bypass-btn:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .bypass-btn.active {
            background-color: #c6a700;
            color: #1e1e1e;
            border-color: #c6a700;
        }

        .hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }

        .name-row {
            display: flex;
            gap: 4px;
            align-items: stretch;
        }

        .name-row input[type="text"] {
            flex: 1;
            min-width: 0;
        }

        .agent-dropdown {
            position: relative;
            flex-shrink: 0;
        }

        .agent-dropdown-trigger {
            width: 32px;
            min-width: 32px;
            height: 100%;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--vscode-input-border, var(--vscode-widget-border));
            background-color: var(--vscode-input-background);
            color: var(--vscode-foreground);
            cursor: pointer;
            border-radius: 2px;
        }

        .agent-dropdown-trigger:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .agent-dropdown-trigger:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }

        .agent-dropdown-trigger svg {
            width: 16px;
            height: 16px;
        }

        .agent-dropdown-menu {
            display: none;
            position: absolute;
            top: calc(100% + 2px);
            right: 0;
            z-index: 100;
            min-width: 160px;
            background-color: var(--vscode-dropdown-background, var(--vscode-input-background));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border));
            border-radius: 3px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
            padding: 4px 0;
        }

        .agent-dropdown-menu.open {
            display: block;
        }

        .agent-dropdown-item {
            width: 100%;
            padding: 6px 10px;
            border: none;
            background: transparent;
            color: var(--vscode-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            text-align: left;
        }

        .agent-dropdown-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .agent-dropdown-item.active {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .agent-dropdown-item:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .agent-dropdown-item:disabled:hover {
            background: transparent;
        }

        .agent-dropdown-item svg {
            width: 16px;
            height: 16px;
            flex-shrink: 0;
        }

        select option:disabled {
            opacity: 0.5;
            color: var(--vscode-disabledForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <form id="sessionForm">
        <div class="form-group">
            <label for="name">Session Name</label>
            <div class="name-row">
                <input
                    type="text"
                    id="name"
                    name="name"
                    placeholder="fix-login-bug"
                    required
                    autocomplete="off"
                />
                ${this._getAgentSelectorHtml()}
            </div>
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
            <div class="hint">Leave empty to branch from current HEAD. Use "origin/<branch_name>" to branch from a remote branch.</div>
        </div>

        <div class="form-group">
            <label for="prompt">Starting Prompt (optional)</label>
            <div class="textarea-wrapper">
                <textarea
                    id="prompt"
                    name="prompt"
                    placeholder="Describe the task for Claude..."
                ></textarea>
                <button type="button" class="attach-btn" id="attachBtn" title="Attach files" aria-label="Attach files">&#128206;</button>
            </div>
            <div class="attachment-chips" id="attachmentChips"></div>
            <div class="hint">Sent to Claude after the session starts</div>
        </div>

        <div class="form-group">
            <label for="workflow">Workflow Template</label>
            <div class="workflow-control">
                <select id="workflow" name="workflow">
                    <option value="" selected>None (ad-hoc mode)</option>
                    ${this._getWorkflowOptionsHtml()}
                </select>
                <button type="button" id="refreshWorkflowBtn" title="Refresh workflow list" aria-label="Refresh workflow list">↻</button>
            </div>
            <div class="hint">Optional: Select a workflow to guide Claude through structured phases</div>
        </div>

        <div class="submit-row">
            <button type="button" id="bypassPermissionsBtn" class="bypass-btn" title="bypassPermissions" aria-label="Toggle bypass permissions" aria-pressed="false">&#9888;</button>
            <button type="submit" id="submitBtn">Create Session</button>
        </div>
    </form>

    <audio id="chime-player" src="${chimeUri}"></audio>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('sessionForm');
        const nameInput = document.getElementById('name');
        const agentDropdown = document.getElementById('agentDropdown');
        const agentTrigger = document.getElementById('agentTrigger');
        const agentMenu = document.getElementById('agentMenu');
        const agentItems = document.querySelectorAll('.agent-dropdown-item');
        const sourceBranchInput = document.getElementById('sourceBranch');
        const promptInput = document.getElementById('prompt');
        const bypassPermissionsBtn = document.getElementById('bypassPermissionsBtn');
        const workflowInput = document.getElementById('workflow');
        const refreshWorkflowBtn = document.getElementById('refreshWorkflowBtn');
        const attachBtn = document.getElementById('attachBtn');
        const attachmentChipsContainer = document.getElementById('attachmentChips');

        let bypassPermissions = false;
        let selectedAgent = '${this._escapeHtml(this._defaultAgent)}';
        let attachments = [];
        const MAX_FILES = 20;

        // Agent SVG map for updating the trigger icon
        const agentSvgs = {};
        agentItems.forEach(function(item) {
            var svg = item.querySelector('svg');
            if (svg) agentSvgs[item.dataset.agent] = svg.outerHTML;
        });

        function selectAgent(agentName, save) {
            selectedAgent = agentName;
            // Update trigger icon
            if (agentTrigger && agentSvgs[agentName]) {
                agentTrigger.innerHTML = agentSvgs[agentName];
            }
            // Update trigger tooltip
            var labels = { 'claude': 'Claude Code', 'codex': 'Codex CLI' };
            if (agentTrigger) agentTrigger.title = labels[agentName] || agentName;
            // Update active state in menu
            agentItems.forEach(function(item) {
                item.classList.toggle('active', item.dataset.agent === agentName);
            });
            if (save !== false) saveState();
        }

        function toggleAgentMenu() {
            if (!agentMenu) return;
            var isOpen = agentMenu.classList.contains('open');
            if (isOpen) {
                agentMenu.classList.remove('open');
                if (agentTrigger) agentTrigger.setAttribute('aria-expanded', 'false');
            } else {
                agentMenu.classList.add('open');
                if (agentTrigger) agentTrigger.setAttribute('aria-expanded', 'true');
            }
        }

        function closeAgentMenu() {
            if (agentMenu) agentMenu.classList.remove('open');
            if (agentTrigger) agentTrigger.setAttribute('aria-expanded', 'false');
        }

        if (agentTrigger) {
            agentTrigger.addEventListener('click', function(e) {
                e.stopPropagation();
                toggleAgentMenu();
            });
        }

        agentItems.forEach(function(item) {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                if (!item.disabled) {
                    selectAgent(item.dataset.agent);
                    closeAgentMenu();
                }
            });
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', function() {
            closeAgentMenu();
        });

        function getFileIcon(filename) {
            const ext = filename.split('.').pop()?.toLowerCase() || '';
            const codeExts = ['js','ts','jsx','tsx','py','java','cpp','c','h','go','rs','rb','php','swift','kt','cs','html','css','scss','less','vue','svelte'];
            const dataExts = ['json','xml','yaml','yml','toml','ini','env','csv'];
            const docExts = ['md','txt','rst','doc','docx','rtf'];
            const mediaExts = ['png','jpg','jpeg','gif','svg','mp4','mp3','wav','webp','ico'];
            const archiveExts = ['zip','tar','gz','rar','7z'];
            if (codeExts.includes(ext)) return '\u{1F4C4}';
            if (dataExts.includes(ext)) return '\u{1F4CB}';
            if (docExts.includes(ext)) return '\u{1F4DD}';
            if (mediaExts.includes(ext)) return '\u{1F5BC}';
            if (archiveExts.includes(ext)) return '\u{1F4E6}';
            return '\u{1F4C1}';
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function renderAttachmentChips() {
            attachmentChipsContainer.innerHTML = '';
            attachments.forEach((file, index) => {
                const chip = document.createElement('div');
                chip.className = 'chip';
                chip.dataset.path = file.path;
                chip.innerHTML =
                    '<span class="chip-icon">' + getFileIcon(file.name) + '</span>' +
                    '<span class="chip-label">' + escapeHtml(file.name) + '</span>' +
                    '<button type="button" class="chip-remove" aria-label="Remove ' + escapeHtml(file.name) + '">\u00D7</button>';
                chip.querySelector('.chip-remove').addEventListener('click', () => {
                    attachments.splice(index, 1);
                    renderAttachmentChips();
                    saveState();
                });
                attachmentChipsContainer.appendChild(chip);
            });
        }

        function showAttachmentWarning(message) {
            const existing = attachmentChipsContainer.parentNode.querySelector('.attachment-warning');
            if (existing) existing.remove();

            const warning = document.createElement('div');
            warning.className = 'attachment-warning';
            warning.textContent = message;
            attachmentChipsContainer.parentNode.insertBefore(warning, attachmentChipsContainer.nextSibling);

            setTimeout(() => {
                warning.style.opacity = '0';
                setTimeout(() => warning.remove(), 300);
            }, 3000);
        }

        attachBtn.addEventListener('click', () => {
            if (attachments.length >= MAX_FILES) {
                showAttachmentWarning('Maximum ' + MAX_FILES + ' files allowed');
                return;
            }
            vscode.postMessage({ command: 'showFilePicker' });
        });

        function updateBypassBtn() {
            if (bypassPermissions) {
                bypassPermissionsBtn.classList.add('active');
                bypassPermissionsBtn.setAttribute('aria-pressed', 'true');
            } else {
                bypassPermissionsBtn.classList.remove('active');
                bypassPermissionsBtn.setAttribute('aria-pressed', 'false');
            }
        }

        bypassPermissionsBtn.addEventListener('click', () => {
            bypassPermissions = !bypassPermissions;
            updateBypassBtn();
            saveState();
        });

        // Restore saved state when webview is recreated
        const previousState = vscode.getState();
        if (previousState) {
            nameInput.value = previousState.name || '';
            if (previousState.agent) {
                selectAgent(previousState.agent, false);
            }
            sourceBranchInput.value = previousState.sourceBranch || '';
            promptInput.value = previousState.prompt || '';
            bypassPermissions = previousState.bypassPermissions || false;
            updateBypassBtn();
            workflowInput.value = previousState.workflow || '';
            attachments = previousState.attachments || [];
            renderAttachmentChips();
        }

        // Save state whenever form values change
        function saveState() {
            vscode.setState({
                name: nameInput.value,
                agent: selectedAgent,
                sourceBranch: sourceBranchInput.value,
                prompt: promptInput.value,
                bypassPermissions: bypassPermissions,
                workflow: workflowInput.value,
                attachments: attachments
            });
        }

        // Attach change listeners to all form inputs
        nameInput.addEventListener('input', saveState);
        sourceBranchInput.addEventListener('input', saveState);
        promptInput.addEventListener('input', saveState);
        workflowInput.addEventListener('change', saveState);

        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const name = nameInput.value.trim();
            const agent = selectedAgent;
            const sourceBranch = sourceBranchInput.value.trim();
            const prompt = promptInput.value.trim();
            const permissionMode = bypassPermissions ? 'bypassPermissions' : 'acceptEdits';
            const workflow = workflowInput.value;

            if (!name) {
                nameInput.focus();
                return;
            }

            // Send message to extension
            vscode.postMessage({
                command: 'createSession',
                name: name,
                agent: agent,
                sourceBranch: sourceBranch,
                prompt: prompt,
                permissionMode: permissionMode,
                workflow: workflow || null,
                attachments: attachments.map(a => a.path)
            });
        });

        // Handle refresh workflows button click
        refreshWorkflowBtn.addEventListener('click', () => {
            refreshWorkflowBtn.disabled = true;
            refreshWorkflowBtn.textContent = '...';
            vscode.postMessage({
                command: 'refreshWorkflows'
            });
        });

        // Helper function to update workflow dropdown options
        // Only shows custom workflows (built-in workflows are filtered out)
        // Uses the full path as the value so MCP server can find the workflow file
        function updateWorkflowDropdown(workflows) {
            const currentValue = workflowInput.value;

            // Clear existing options except the first "None" option
            while (workflowInput.options.length > 1) {
                workflowInput.remove(1);
            }

            // Remove any existing optgroups
            const optgroups = workflowInput.querySelectorAll('optgroup');
            optgroups.forEach(og => og.remove());

            if (!workflows || workflows.length === 0) {
                return;
            }

            // Filter to only include custom workflows
            const custom = workflows.filter(w => !w.isBuiltIn);

            if (custom.length === 0) {
                return;
            }

            // Add custom workflow options directly (no optgroup needed)
            // Use the path as value (for MCP server) and name as display text
            custom.forEach(w => {
                const option = document.createElement('option');
                option.value = w.path;
                option.textContent = w.name;
                workflowInput.appendChild(option);
            });

            // Restore previous selection if it still exists
            if (currentValue) {
                const optionExists = Array.from(workflowInput.options).some(opt => opt.value === currentValue);
                if (optionExists) {
                    workflowInput.value = currentValue;
                }
            }
        }

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const message = event.data;
            switch (message.command) {
                case 'clearForm':
                    nameInput.value = '';
                    selectAgent('${this._escapeHtml(this._defaultAgent)}', false);
                    sourceBranchInput.value = '';
                    promptInput.value = '';
                    bypassPermissions = false;
                    updateBypassBtn();
                    workflowInput.value = '';
                    attachments = [];
                    renderAttachmentChips();
                    // Clear saved state after successful submission
                    vscode.setState({
                        name: '',
                        agent: '${this._escapeHtml(this._defaultAgent)}',
                        sourceBranch: '',
                        prompt: '',
                        bypassPermissions: false,
                        workflow: '',
                        attachments: []
                    });
                    nameInput.focus();
                    break;
                case 'filesSelected':
                    if (message.files && Array.isArray(message.files)) {
                        let duplicateCount = 0;
                        const availableSlots = MAX_FILES - attachments.length;
                        const filesToAdd = message.files.slice(0, availableSlots);
                        if (message.files.length > availableSlots) {
                            showAttachmentWarning('Can only attach ' + availableSlots + ' more files (limit: ' + MAX_FILES + ')');
                        }
                        for (const file of filesToAdd) {
                            const isDuplicate = attachments.some(
                                a => a.path.toLowerCase() === file.path.toLowerCase()
                            );
                            if (isDuplicate) {
                                duplicateCount++;
                            } else {
                                attachments.push(file);
                            }
                        }
                        if (duplicateCount > 0) {
                            showAttachmentWarning(duplicateCount === 1 ? 'File already attached' : duplicateCount + ' files already attached');
                        }
                        renderAttachmentChips();
                        saveState();
                    }
                    break;
                case 'updateWorkflows':
                    updateWorkflowDropdown(message.workflows);
                    refreshWorkflowBtn.disabled = false;
                    refreshWorkflowBtn.textContent = '↻';
                    break;
                case 'updateAgentAvailability':
                    // Update agent availability dynamically
                    if (message.availability) {
                        const availabilityMap = new Map(message.availability);
                        let availableCount = 0;
                        for (const available of availabilityMap.values()) {
                            if (available) {
                                availableCount++;
                            }
                        }

                        if (agentDropdown) {
                            agentDropdown.style.display = availableCount <= 1 ? 'none' : '';
                        }

                        // Update menu item disabled states and labels
                        agentItems.forEach(function(item) {
                            const agentName = item.dataset.agent;
                            const available = availabilityMap.get(agentName) ?? false;
                            item.disabled = !available;
                            const baseLabels = { 'claude': 'Claude Code', 'codex': 'Codex CLI' };
                            const baseLabel = baseLabels[agentName] || agentName;
                            const span = item.querySelector('span');
                            if (span) span.textContent = available ? baseLabel : baseLabel + ' (not installed)';
                        });

                        // Update default selection if provided
                        if (message.defaultAgent) {
                            selectAgent(message.defaultAgent);
                        }
                    }
                    break;
            }
        });

            
        const player = document.getElementById('chime-player');

        window.addEventListener('message', event => {
            const message = event.data;
            
            if (message.command === 'playChime') {
                if (player) {
                    player.play().catch(e => console.error("Play Error:", e));
                } else {
                    console.error("Player element lost!");
                }
            }
        });
            
    </script>
</body>
</html>`;
    }
}
