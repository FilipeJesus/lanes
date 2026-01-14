import * as vscode from 'vscode';

/**
 * Represents a single line in a diff hunk
 */
interface DiffLine {
    type: 'added' | 'removed' | 'context';
    content: string;
    oldLineNumber: number | null;
    newLineNumber: number | null;
}

/**
 * Represents a review comment attached to a diff line.
 * Exported for testing purposes.
 */
export interface ReviewComment {
    /** Unique identifier for the comment */
    id: string;
    /** Path to the file being commented on */
    filePath: string;
    /** Line number (new line for added/context, old line for removed) */
    lineNumber: number;
    /** Type of line being commented on */
    lineType: 'added' | 'removed' | 'context';
    /** The actual content of the line */
    lineContent: string;
    /** The comment text */
    text: string;
}

/**
 * Represents a hunk in a diff (a contiguous block of changes)
 */
interface DiffHunk {
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: DiffLine[];
}

/**
 * Represents a file's diff information
 */
export interface FileDiff {
    filePath: string;
    oldPath: string | null;
    newPath: string | null;
    isNew: boolean;
    isDeleted: boolean;
    isRenamed: boolean;
    hunks: DiffHunk[];
    addedCount: number;
    removedCount: number;
}

/**
 * Formats an array of review comments into a readable text format for clipboard.
 * Comments are grouped by file path.
 * Exported for testing purposes.
 * @param comments Array of ReviewComment objects
 * @returns Formatted string suitable for pasting
 */
export function formatReviewForClipboard(comments: ReviewComment[]): string {
    if (comments.length === 0) {
        return 'No comments in this review.';
    }

    // Group comments by file
    const commentsByFile = new Map<string, ReviewComment[]>();
    for (const comment of comments) {
        const existing = commentsByFile.get(comment.filePath) || [];
        existing.push(comment);
        commentsByFile.set(comment.filePath, existing);
    }

    const lines: string[] = ['# Code Review Comments', ''];

    for (const [filePath, fileComments] of commentsByFile) {
        lines.push(`## ${filePath}`);
        lines.push('');

        // Sort comments by line number
        fileComments.sort((a, b) => a.lineNumber - b.lineNumber);

        for (const comment of fileComments) {
            const linePrefix = comment.lineType === 'added' ? '+' :
                              comment.lineType === 'removed' ? '-' : ' ';
            lines.push(`**Line ${comment.lineNumber}** (${comment.lineType}):`);
            lines.push('```');
            lines.push(`${linePrefix}${comment.lineContent}`);
            lines.push('```');
            lines.push(`> ${comment.text}`);
            lines.push('');
        }
    }

    return lines.join('\n');
}

/**
 * Parses unified diff format into structured data.
 * Exported for testing purposes.
 * @param diffContent The raw unified diff string
 * @returns Array of FileDiff objects representing each file's changes
 */
export function parseDiff(diffContent: string): FileDiff[] {
    const files: FileDiff[] = [];
    const lines = diffContent.split('\n');
    let currentFile: FileDiff | null = null;
    let currentHunk: DiffHunk | null = null;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match diff header: diff --git a/path b/path
        if (line.startsWith('diff --git')) {
            // Save previous file if exists
            if (currentFile) {
                if (currentHunk) {
                    currentFile.hunks.push(currentHunk);
                }
                files.push(currentFile);
            }

            // Extract file path from diff header
            const match = line.match(/diff --git a\/(.+) b\/(.+)/);
            const filePath = match ? match[2] : 'unknown';

            currentFile = {
                filePath,
                oldPath: match ? match[1] : null,
                newPath: match ? match[2] : null,
                isNew: false,
                isDeleted: false,
                isRenamed: false,
                hunks: [],
                addedCount: 0,
                removedCount: 0
            };
            currentHunk = null;
            continue;
        }

        if (!currentFile) {
            continue;
        }

        // Check for new file
        if (line.startsWith('new file mode')) {
            currentFile.isNew = true;
            continue;
        }

        // Check for deleted file
        if (line.startsWith('deleted file mode')) {
            currentFile.isDeleted = true;
            continue;
        }

        // Check for renamed file
        if (line.startsWith('rename from') || line.startsWith('rename to')) {
            currentFile.isRenamed = true;
            continue;
        }

        // Match hunk header: @@ -oldStart,oldCount +newStart,newCount @@
        const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
        if (hunkMatch) {
            // Save previous hunk if exists
            if (currentHunk) {
                currentFile.hunks.push(currentHunk);
            }

            oldLineNum = parseInt(hunkMatch[1], 10);
            newLineNum = parseInt(hunkMatch[3], 10);

            currentHunk = {
                oldStart: oldLineNum,
                oldCount: hunkMatch[2] ? parseInt(hunkMatch[2], 10) : 1,
                newStart: newLineNum,
                newCount: hunkMatch[4] ? parseInt(hunkMatch[4], 10) : 1,
                lines: []
            };
            continue;
        }

        if (!currentHunk) {
            continue;
        }

        // Parse diff lines
        if (line.startsWith('+') && !line.startsWith('+++')) {
            currentHunk.lines.push({
                type: 'added',
                content: line.substring(1),
                oldLineNumber: null,
                newLineNumber: newLineNum
            });
            currentFile.addedCount++;
            newLineNum++;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            currentHunk.lines.push({
                type: 'removed',
                content: line.substring(1),
                oldLineNumber: oldLineNum,
                newLineNumber: null
            });
            currentFile.removedCount++;
            oldLineNum++;
        } else if (line.startsWith(' ') || line === '') {
            // Context line (or empty line within hunk)
            const content = line.startsWith(' ') ? line.substring(1) : '';
            currentHunk.lines.push({
                type: 'context',
                content,
                oldLineNumber: oldLineNum,
                newLineNumber: newLineNum
            });
            oldLineNum++;
            newLineNum++;
        }
    }

    // Don't forget the last file and hunk
    if (currentFile) {
        if (currentHunk) {
            currentFile.hunks.push(currentHunk);
        }
        files.push(currentFile);
    }

    return files;
}

/**
 * Callback type for handling branch change requests from the webview.
 */
export type OnBranchChangeCallback = (branchName: string, worktreePath: string) => Promise<{ diffContent: string; baseBranch: string } | null>;

/**
 * Provides a webview panel that displays git diff in a GitLab-style format.
 * Features collapsible file sections, context lines, and VS Code theme integration.
 */
export class GitChangesPanel {
    public static currentPanel: GitChangesPanel | undefined;

    public static readonly viewType = 'gitChangesPanel';

    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _worktreePath: string = '';
    private _currentBaseBranch: string = '';
    private static _onBranchChange: OnBranchChangeCallback | undefined;

    /**
     * Sets the callback for handling branch change requests.
     * This should be called once during extension activation.
     * @param callback The callback to invoke when the user changes the base branch
     */
    public static setOnBranchChange(callback: OnBranchChangeCallback): void {
        GitChangesPanel._onBranchChange = callback;
    }

    /**
     * Creates or shows the git changes panel.
     * @param extensionUri The URI of the extension
     * @param sessionName The name of the session (used in panel title)
     * @param diffContent The raw unified diff content to display
     * @param worktreePath The path to the worktree (needed to regenerate diff)
     * @param currentBaseBranch The current base branch used for the diff
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        sessionName: string,
        diffContent: string,
        worktreePath?: string,
        currentBaseBranch?: string
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (GitChangesPanel.currentPanel) {
            GitChangesPanel.currentPanel._panel.reveal(column);
            if (worktreePath) {
                GitChangesPanel.currentPanel._worktreePath = worktreePath;
            }
            if (currentBaseBranch) {
                GitChangesPanel.currentPanel._currentBaseBranch = currentBaseBranch;
            }
            GitChangesPanel.currentPanel._update(sessionName, diffContent, currentBaseBranch);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            GitChangesPanel.viewType,
            `Changes: ${sessionName}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                retainContextWhenHidden: true
            }
        );

        GitChangesPanel.currentPanel = new GitChangesPanel(panel, extensionUri, sessionName, diffContent, worktreePath, currentBaseBranch);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        _extensionUri: vscode.Uri,
        sessionName: string,
        diffContent: string,
        worktreePath?: string,
        currentBaseBranch?: string
    ) {
        this._panel = panel;
        this._worktreePath = worktreePath || '';
        this._currentBaseBranch = currentBaseBranch || '';

        // Set initial content
        this._update(sessionName, diffContent, currentBaseBranch);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'submitReview':
                        // Validate that comments is an array before processing
                        if (Array.isArray(message.comments)) {
                            await this._handleSubmitReview(message.comments as ReviewComment[]);
                        }
                        break;
                    case 'changeBranch':
                        // Validate that branchName is a string before processing
                        if (typeof message.branchName === 'string') {
                            await this._handleChangeBranch(message.branchName);
                        }
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    /**
     * Handle the change branch message from the webview.
     * Validates the branch and regenerates the diff.
     */
    private async _handleChangeBranch(branchName: string): Promise<void> {
        if (!this._worktreePath) {
            vscode.window.showErrorMessage('Cannot change branch: worktree path not available.');
            return;
        }

        if (!GitChangesPanel._onBranchChange) {
            vscode.window.showErrorMessage('Cannot change branch: handler not registered.');
            return;
        }

        const result = await GitChangesPanel._onBranchChange(branchName, this._worktreePath);
        if (result) {
            this._currentBaseBranch = result.baseBranch;
            // Re-render the webview with the new diff content
            // Extract session name from panel title (format: "Changes: sessionName")
            const sessionName = this._panel.title.replace('Changes: ', '');
            this._update(sessionName, result.diffContent, result.baseBranch);
        }
    }

    /**
     * Handle the submit review message from the webview.
     * Formats comments and copies to clipboard.
     */
    private async _handleSubmitReview(comments: ReviewComment[]): Promise<void> {
        const formattedReview = formatReviewForClipboard(comments);
        await vscode.env.clipboard.writeText(formattedReview);
        vscode.window.showInformationMessage(
            `Review copied to clipboard with ${comments.length} comment${comments.length !== 1 ? 's' : ''}.`
        );
    }

    public dispose(): void {
        GitChangesPanel.currentPanel = undefined;

        // Clean up resources
        this._panel.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private _update(sessionName: string, diffContent: string, baseBranch?: string): void {
        this._panel.title = `Changes: ${sessionName}`;
        this._panel.webview.html = this._getHtmlForWebview(diffContent, baseBranch || this._currentBaseBranch);
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
     * Escape HTML special characters to prevent XSS
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
     * Generate HTML for the diff content
     */
    private _generateDiffHtml(files: FileDiff[]): string {
        if (files.length === 0) {
            return '<div class="no-changes">No changes found</div>';
        }

        return files.map((file, fileIndex) => {
            let lineCounter = 0;
            const hunksHtml = file.hunks.map(hunk => {
                const linesHtml = hunk.lines.map(line => {
                    const lineId = `line-${fileIndex}-${lineCounter++}`;
                    const oldNum = line.oldLineNumber !== null ? line.oldLineNumber : '';
                    const newNum = line.newLineNumber !== null ? line.newLineNumber : '';
                    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                    const escapedContent = this._escapeHtml(line.content);
                    // Use the appropriate line number based on type
                    const displayLineNum = line.type === 'removed' ? line.oldLineNumber : line.newLineNumber;
                    // Escape line content for use in data attribute (double-escape for HTML attribute)
                    const dataContent = this._escapeHtml(line.content).replace(/'/g, '&#39;');

                    return `<tr class="${line.type}" id="${lineId}" data-file-path="${this._escapeHtml(file.filePath)}" data-line-num="${displayLineNum}" data-line-type="${line.type}" data-line-content='${dataContent}'><td class="line-num old">${oldNum}</td><td class="line-num new">${newNum}</td><td class="line-content"><span class="prefix">${prefix}</span>${escapedContent}<button class="comment-btn" data-line-id="${lineId}" title="Add comment">+</button></td></tr>
                    <tr class="comment-row hidden" id="comment-row-${lineId}">
                        <td colspan="3" class="comment-cell">
                            <div class="comment-input-container" id="comment-input-${lineId}">
                                <textarea class="comment-textarea" placeholder="Write a comment..."></textarea>
                                <div class="comment-actions">
                                    <button class="comment-save-btn" data-line-id="${lineId}">Save</button>
                                    <button class="comment-cancel-btn" data-line-id="${lineId}">Cancel</button>
                                </div>
                            </div>
                            <div class="comments-list" id="comments-${lineId}"></div>
                        </td>
                    </tr>`;
                }).join('\n');

                return `<table class="diff-table">${linesHtml}</table>`;
            }).join('\n');

            const fileStatus = file.isNew ? ' (new)' : file.isDeleted ? ' (deleted)' : file.isRenamed ? ' (renamed)' : '';

            return `
                <div class="file-container" data-index="${fileIndex}" data-file-path="${this._escapeHtml(file.filePath)}">
                    <div class="file-header" data-index="${fileIndex}">
                        <span class="collapse-icon" id="icon-${fileIndex}">&#9660;</span>
                        <span class="file-path">${this._escapeHtml(file.filePath)}${fileStatus}</span>
                        <span class="badges">
                            <span class="badge comment-count" id="comment-count-${fileIndex}" style="display: none;">0</span>
                            <span class="badge added">+${file.addedCount}</span>
                            <span class="badge removed">-${file.removedCount}</span>
                        </span>
                    </div>
                    <div class="file-diff" id="diff-${fileIndex}">
                        ${hunksHtml}
                    </div>
                </div>
            `;
        }).join('\n');
    }

    private _getHtmlForWebview(diffContent: string, baseBranch?: string): string {
        const nonce = this._getNonce();
        const files = parseDiff(diffContent);
        const diffHtml = this._generateDiffHtml(files);
        const escapedBaseBranch = this._escapeHtml(baseBranch || '');

        // Calculate totals
        const totalAdded = files.reduce((sum, f) => sum + f.addedCount, 0);
        const totalRemoved = files.reduce((sum, f) => sum + f.removedCount, 0);
        const fileCount = files.length;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this._panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <title>Git Changes</title>
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
            background-color: var(--vscode-editor-background);
            padding: 16px;
        }

        .summary {
            padding: 12px 16px;
            margin-bottom: 16px;
            background-color: var(--vscode-sideBar-background);
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }

        .summary-text {
            font-size: 14px;
        }

        .summary .badge {
            margin-left: 8px;
        }

        .no-changes {
            padding: 32px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }

        .file-container {
            margin-bottom: 16px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }

        .file-header {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            background-color: var(--vscode-sideBar-background);
            cursor: pointer;
            user-select: none;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .file-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }

        .collapse-icon {
            margin-right: 8px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            transition: transform 0.2s ease;
            display: inline-block;
        }

        .collapse-icon.collapsed {
            transform: rotate(-90deg);
        }

        .file-path {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 13px;
            flex: 1;
            word-break: break-all;
        }

        .badges {
            display: flex;
            gap: 6px;
            margin-left: 12px;
        }

        .badge {
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 3px;
            font-weight: 600;
        }

        .badge.added {
            background-color: var(--vscode-gitDecoration-addedResourceForeground, #28a745);
            color: white;
        }

        .badge.removed {
            background-color: var(--vscode-gitDecoration-deletedResourceForeground, #dc3545);
            color: white;
        }

        .file-diff {
            overflow-x: auto;
        }

        .file-diff.collapsed {
            display: none;
        }

        .diff-table {
            width: 100%;
            border-collapse: collapse;
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            line-height: 1.5;
        }

        .diff-table tr {
            border: none;
            height: 18px;
            max-height: 18px;
        }

        .diff-table td {
            padding: 0 2px;
            white-space: pre;
            vertical-align: middle;
            line-height: 18px;
            height: 18px;
            max-height: 18px;
            overflow: hidden;
        }

        /* Allow comment button to extend outside the cell */
        .diff-table td.line-content {
            overflow: visible;
        }

        .line-num {
            width: 50px;
            min-width: 50px;
            text-align: right;
            color: var(--vscode-editorLineNumber-foreground);
            background-color: var(--vscode-editorGutter-background, var(--vscode-editor-background));
            border-right: 1px solid var(--vscode-panel-border);
            user-select: none;
        }

        .line-num.old {
            padding-right: 2px;
        }

        .line-num.new {
            padding-left: 2px;
            padding-right: 2px;
        }

        .line-content {
            width: 100%;
        }

        .line-content .prefix {
            display: inline-block;
            width: 16px;
            text-align: center;
            margin-right: 2px;
        }

        tr.added {
            background-color: var(--vscode-diffEditor-insertedLineBackground, rgba(40, 167, 69, 0.2));
        }

        tr.added .line-num {
            background-color: var(--vscode-diffEditor-insertedLineBackground, rgba(40, 167, 69, 0.3));
        }

        tr.removed {
            background-color: var(--vscode-diffEditor-removedLineBackground, rgba(220, 53, 69, 0.2));
        }

        tr.removed .line-num {
            background-color: var(--vscode-diffEditor-removedLineBackground, rgba(220, 53, 69, 0.3));
        }

        tr.context {
            background-color: var(--vscode-editor-background);
        }

        /* Toolbar */
        .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 16px;
        }

        .toolbar button {
            padding: 6px 12px;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 2px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        .toolbar button:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        .toolbar button.primary {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .toolbar button.primary:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .toolbar button.primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .toolbar .spacer {
            flex: 1;
        }

        /* Base branch selector */
        .branch-selector {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .branch-selector label {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            white-space: nowrap;
        }

        .branch-selector input {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
            border-radius: 2px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-editor-font-family, monospace);
            font-size: 12px;
            width: 150px;
        }

        .branch-selector input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .branch-selector input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        /* Comment button on lines */
        .line-content {
            position: relative;
        }

        .comment-btn {
            position: absolute;
            /* Position button to the left, near the line number columns */
            left: -52px;
            top: 50%;
            transform: translateY(-50%);
            width: 20px;
            height: 20px;
            padding: 0;
            border: none;
            border-radius: 3px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s ease;
        }

        tr:hover .comment-btn {
            opacity: 1;
        }

        .comment-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        /* Comment row styles */
        .comment-row {
            background-color: var(--vscode-editor-background);
        }

        .comment-row.hidden {
            display: none;
        }

        .comment-cell {
            padding: 8px 16px !important;
            white-space: normal !important;
        }

        .comment-input-container {
            margin-bottom: 8px;
        }

        .comment-input-container.hidden {
            display: none;
        }

        .comment-textarea {
            width: 100%;
            min-height: 60px;
            padding: 8px;
            border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
            border-radius: 4px;
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            resize: vertical;
        }

        .comment-textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }

        .comment-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }

        .comment-actions button {
            padding: 4px 12px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        .comment-save-btn {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .comment-save-btn:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .comment-cancel-btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .comment-cancel-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Comments list */
        .comments-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .comment-item {
            padding: 8px 12px;
            background-color: var(--vscode-textBlockQuote-background, rgba(127, 127, 127, 0.1));
            border-left: 3px solid var(--vscode-textLink-foreground, #007acc);
            border-radius: 0 4px 4px 0;
        }

        .comment-text {
            white-space: pre-wrap;
            word-break: break-word;
        }

        .comment-item-actions {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }

        .comment-edit-btn,
        .comment-delete-btn {
            padding: 2px 8px;
            font-size: 11px;
            border: none;
            border-radius: 2px;
            cursor: pointer;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .comment-edit-btn:hover,
        .comment-delete-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }

        /* Comment count badge */
        .badge.comment-count {
            background-color: var(--vscode-textLink-foreground, #007acc);
            color: white;
        }

        /* Review comment count in summary */
        .review-comment-count {
            margin-left: 16px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="summary">
        <span class="summary-text">
            ${fileCount} file${fileCount !== 1 ? 's' : ''} changed
            <span class="badge added">+${totalAdded}</span>
            <span class="badge removed">-${totalRemoved}</span>
        </span>
    </div>

    <div class="toolbar">
        <button id="expand-all-btn">Expand All</button>
        <button id="collapse-all-btn">Collapse All</button>
        <div class="branch-selector">
            <label for="base-branch-input">Base branch:</label>
            <input type="text" id="base-branch-input" value="${escapedBaseBranch}" placeholder="e.g., main, origin/main">
            <button id="refresh-diff-btn">Update Diff</button>
        </div>
        <div class="spacer"></div>
        <span id="total-comment-count" class="review-comment-count"></span>
        <button id="submit-review-btn" class="primary" disabled>Submit Review</button>
    </div>

    <div class="diff-content">
        ${diffHtml}
    </div>

    <script nonce="${nonce}">
        (function() {
            // VS Code API for messaging
            const vscode = acquireVsCodeApi();

            // Track collapsed state per file
            const collapsedState = {};

            // Store all comments
            const comments = {};
            let commentIdCounter = 0;

            function generateCommentId() {
                return 'comment-' + (++commentIdCounter) + '-' + Date.now();
            }

            function toggleFile(index) {
                const diffElement = document.getElementById('diff-' + index);
                const iconElement = document.getElementById('icon-' + index);

                if (diffElement && iconElement) {
                    if (diffElement.classList.contains('collapsed')) {
                        diffElement.classList.remove('collapsed');
                        iconElement.classList.remove('collapsed');
                        collapsedState[index] = false;
                    } else {
                        diffElement.classList.add('collapsed');
                        iconElement.classList.add('collapsed');
                        collapsedState[index] = true;
                    }
                }
            }

            function expandAll() {
                const diffs = document.querySelectorAll('.file-diff');
                const icons = document.querySelectorAll('.collapse-icon');

                diffs.forEach((diff, i) => {
                    diff.classList.remove('collapsed');
                    collapsedState[i] = false;
                });

                icons.forEach(icon => {
                    icon.classList.remove('collapsed');
                });
            }

            function collapseAll() {
                const diffs = document.querySelectorAll('.file-diff');
                const icons = document.querySelectorAll('.collapse-icon');

                diffs.forEach((diff, i) => {
                    diff.classList.add('collapsed');
                    collapsedState[i] = true;
                });

                icons.forEach(icon => {
                    icon.classList.add('collapsed');
                });
            }

            function updateCommentCounts() {
                // Count comments per file
                const fileCounts = {};
                let totalCount = 0;

                for (const lineId in comments) {
                    const lineComments = comments[lineId];
                    if (lineComments && lineComments.length > 0) {
                        const lineRow = document.getElementById(lineId);
                        if (lineRow) {
                            const filePath = lineRow.getAttribute('data-file-path');
                            fileCounts[filePath] = (fileCounts[filePath] || 0) + lineComments.length;
                            totalCount += lineComments.length;
                        }
                    }
                }

                // Update file badges
                document.querySelectorAll('.file-container').forEach((container, index) => {
                    const filePath = container.getAttribute('data-file-path');
                    const badge = document.getElementById('comment-count-' + index);
                    if (badge) {
                        const count = fileCounts[filePath] || 0;
                        if (count > 0) {
                            badge.textContent = count;
                            badge.style.display = '';
                        } else {
                            badge.style.display = 'none';
                        }
                    }
                });

                // Update total comment count
                const totalCountEl = document.getElementById('total-comment-count');
                const submitBtn = document.getElementById('submit-review-btn');
                if (totalCountEl) {
                    if (totalCount > 0) {
                        totalCountEl.textContent = totalCount + ' comment' + (totalCount !== 1 ? 's' : '');
                    } else {
                        totalCountEl.textContent = '';
                    }
                }
                if (submitBtn) {
                    submitBtn.disabled = totalCount === 0;
                }
            }

            function showCommentInput(lineId) {
                const commentRow = document.getElementById('comment-row-' + lineId);
                const inputContainer = document.getElementById('comment-input-' + lineId);
                if (commentRow && inputContainer) {
                    commentRow.classList.remove('hidden');
                    inputContainer.classList.remove('hidden');
                    const textarea = inputContainer.querySelector('.comment-textarea');
                    if (textarea) {
                        textarea.value = '';
                        textarea.focus();
                    }
                }
            }

            function hideCommentInput(lineId) {
                const commentRow = document.getElementById('comment-row-' + lineId);
                const inputContainer = document.getElementById('comment-input-' + lineId);
                const commentsList = document.getElementById('comments-' + lineId);

                if (inputContainer) {
                    inputContainer.classList.add('hidden');
                    const textarea = inputContainer.querySelector('.comment-textarea');
                    if (textarea) {
                        textarea.value = '';
                    }
                }

                // Hide the entire row if no comments exist
                if (commentRow && commentsList) {
                    const hasComments = comments[lineId] && comments[lineId].length > 0;
                    if (!hasComments) {
                        commentRow.classList.add('hidden');
                    }
                }
            }

            function saveComment(lineId) {
                const inputContainer = document.getElementById('comment-input-' + lineId);
                const textarea = inputContainer ? inputContainer.querySelector('.comment-textarea') : null;
                const lineRow = document.getElementById(lineId);

                if (!textarea || !lineRow) return;

                const text = textarea.value.trim();
                if (!text) {
                    hideCommentInput(lineId);
                    return;
                }

                const comment = {
                    id: generateCommentId(),
                    filePath: lineRow.getAttribute('data-file-path'),
                    lineNumber: parseInt(lineRow.getAttribute('data-line-num'), 10),
                    lineType: lineRow.getAttribute('data-line-type'),
                    lineContent: decodeHtmlEntities(lineRow.getAttribute('data-line-content')),
                    text: text
                };

                // Store comment
                if (!comments[lineId]) {
                    comments[lineId] = [];
                }
                comments[lineId].push(comment);

                // Render comment
                renderComments(lineId);
                hideCommentInput(lineId);
                updateCommentCounts();
            }

            function decodeHtmlEntities(str) {
                const textarea = document.createElement('textarea');
                textarea.innerHTML = str;
                return textarea.value;
            }

            function renderComments(lineId) {
                const commentsList = document.getElementById('comments-' + lineId);
                const commentRow = document.getElementById('comment-row-' + lineId);
                if (!commentsList) return;

                const lineComments = comments[lineId] || [];

                if (lineComments.length === 0) {
                    commentsList.innerHTML = '';
                    return;
                }

                // Show the comment row
                if (commentRow) {
                    commentRow.classList.remove('hidden');
                }

                commentsList.innerHTML = lineComments.map(c => {
                    const escapedText = escapeHtml(c.text);
                    const escapedId = escapeHtml(c.id);
                    const escapedLineId = escapeHtml(lineId);
                    return '<div class="comment-item" data-comment-id="' + escapedId + '">' +
                        '<div class="comment-text">' + escapedText + '</div>' +
                        '<div class="comment-item-actions">' +
                        '<button class="comment-edit-btn" data-line-id="' + escapedLineId + '" data-comment-id="' + escapedId + '">Edit</button>' +
                        '<button class="comment-delete-btn" data-line-id="' + escapedLineId + '" data-comment-id="' + escapedId + '">Delete</button>' +
                        '</div>' +
                        '</div>';
                }).join('');

                // Attach edit/delete handlers
                commentsList.querySelectorAll('.comment-edit-btn').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const lId = this.getAttribute('data-line-id');
                        const cId = this.getAttribute('data-comment-id');
                        editComment(lId, cId);
                    });
                });

                commentsList.querySelectorAll('.comment-delete-btn').forEach(btn => {
                    btn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        const lId = this.getAttribute('data-line-id');
                        const cId = this.getAttribute('data-comment-id');
                        deleteComment(lId, cId);
                    });
                });
            }

            function editComment(lineId, commentId) {
                const lineComments = comments[lineId] || [];
                const comment = lineComments.find(c => c.id === commentId);
                if (!comment) return;

                const inputContainer = document.getElementById('comment-input-' + lineId);
                const commentRow = document.getElementById('comment-row-' + lineId);
                if (inputContainer && commentRow) {
                    commentRow.classList.remove('hidden');
                    inputContainer.classList.remove('hidden');
                    const textarea = inputContainer.querySelector('.comment-textarea');
                    if (textarea) {
                        textarea.value = comment.text;
                        textarea.focus();
                    }

                    // Delete the old comment so save will create a new one
                    deleteComment(lineId, commentId, true);
                }
            }

            function deleteComment(lineId, commentId, skipRender) {
                const lineComments = comments[lineId] || [];
                const index = lineComments.findIndex(c => c.id === commentId);
                if (index !== -1) {
                    lineComments.splice(index, 1);
                }

                if (!skipRender) {
                    renderComments(lineId);
                    updateCommentCounts();

                    // Hide row if no comments
                    if (lineComments.length === 0) {
                        const commentRow = document.getElementById('comment-row-' + lineId);
                        const inputContainer = document.getElementById('comment-input-' + lineId);
                        if (commentRow && inputContainer && inputContainer.classList.contains('hidden')) {
                            commentRow.classList.add('hidden');
                        }
                    }
                }
            }

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            function getAllComments() {
                const allComments = [];
                for (const lineId in comments) {
                    const lineComments = comments[lineId];
                    if (lineComments) {
                        allComments.push(...lineComments);
                    }
                }
                return allComments;
            }

            function submitReview() {
                const allComments = getAllComments();
                if (allComments.length === 0) return;

                vscode.postMessage({
                    command: 'submitReview',
                    comments: allComments
                });
            }

            function changeBranch() {
                const branchInput = document.getElementById('base-branch-input');
                if (branchInput) {
                    const branchName = branchInput.value.trim();
                    if (branchName) {
                        vscode.postMessage({
                            command: 'changeBranch',
                            branchName: branchName
                        });
                    }
                }
            }

            // Attach event listeners to file headers
            document.querySelectorAll('.file-header').forEach(header => {
                header.addEventListener('click', () => {
                    const index = header.getAttribute('data-index');
                    if (index !== null) {
                        toggleFile(index);
                    }
                });
            });

            // Attach event listeners to toolbar buttons
            const expandBtn = document.getElementById('expand-all-btn');
            const collapseBtn = document.getElementById('collapse-all-btn');
            const submitBtn = document.getElementById('submit-review-btn');
            const refreshBtn = document.getElementById('refresh-diff-btn');
            const branchInput = document.getElementById('base-branch-input');

            if (expandBtn) {
                expandBtn.addEventListener('click', expandAll);
            }
            if (collapseBtn) {
                collapseBtn.addEventListener('click', collapseAll);
            }
            if (submitBtn) {
                submitBtn.addEventListener('click', submitReview);
            }
            if (refreshBtn) {
                refreshBtn.addEventListener('click', changeBranch);
            }
            // Allow pressing Enter in the branch input to trigger refresh
            if (branchInput) {
                branchInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        changeBranch();
                    }
                });
            }

            // Attach comment button listeners
            document.querySelectorAll('.comment-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const lineId = this.getAttribute('data-line-id');
                    showCommentInput(lineId);
                });
            });

            // Attach save/cancel button listeners
            document.querySelectorAll('.comment-save-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const lineId = this.getAttribute('data-line-id');
                    saveComment(lineId);
                });
            });

            document.querySelectorAll('.comment-cancel-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const lineId = this.getAttribute('data-line-id');
                    hideCommentInput(lineId);
                });
            });
        })();
    </script>
</body>
</html>`;
    }
}
