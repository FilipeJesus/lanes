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
 * Provides a webview panel that displays git diff in a GitLab-style format.
 * Features collapsible file sections, context lines, and VS Code theme integration.
 */
export class GitChangesPanel {
    public static currentPanel: GitChangesPanel | undefined;

    public static readonly viewType = 'gitChangesPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    /**
     * Creates or shows the git changes panel.
     * @param extensionUri The URI of the extension
     * @param sessionName The name of the session (used in panel title)
     * @param diffContent The raw unified diff content to display
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        sessionName: string,
        diffContent: string
    ): void {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it
        if (GitChangesPanel.currentPanel) {
            GitChangesPanel.currentPanel._panel.reveal(column);
            GitChangesPanel.currentPanel._update(sessionName, diffContent);
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

        GitChangesPanel.currentPanel = new GitChangesPanel(panel, extensionUri, sessionName, diffContent);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        sessionName: string,
        diffContent: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        // Set initial content
        this._update(sessionName, diffContent);

        // Listen for when the panel is disposed
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
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

    private _update(sessionName: string, diffContent: string): void {
        this._panel.title = `Changes: ${sessionName}`;
        this._panel.webview.html = this._getHtmlForWebview(diffContent);
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
            return '<div class="no-changes">No changes to display</div>';
        }

        return files.map((file, index) => {
            const hunksHtml = file.hunks.map(hunk => {
                const linesHtml = hunk.lines.map(line => {
                    const oldNum = line.oldLineNumber !== null ? line.oldLineNumber : '';
                    const newNum = line.newLineNumber !== null ? line.newLineNumber : '';
                    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
                    const escapedContent = this._escapeHtml(line.content);

                    return `<tr class="${line.type}">
                        <td class="line-num old">${oldNum}</td>
                        <td class="line-num new">${newNum}</td>
                        <td class="line-content"><span class="prefix">${prefix}</span>${escapedContent}</td>
                    </tr>`;
                }).join('\n');

                return `<table class="diff-table">${linesHtml}</table>`;
            }).join('\n');

            const fileStatus = file.isNew ? ' (new)' : file.isDeleted ? ' (deleted)' : file.isRenamed ? ' (renamed)' : '';

            return `
                <div class="file-container" data-index="${index}">
                    <div class="file-header" data-index="${index}">
                        <span class="collapse-icon" id="icon-${index}">&#9660;</span>
                        <span class="file-path">${this._escapeHtml(file.filePath)}${fileStatus}</span>
                        <span class="badges">
                            <span class="badge added">+${file.addedCount}</span>
                            <span class="badge removed">-${file.removedCount}</span>
                        </span>
                    </div>
                    <div class="file-diff" id="diff-${index}">
                        ${hunksHtml}
                    </div>
                </div>
            `;
        }).join('\n');
    }

    private _getHtmlForWebview(diffContent: string): string {
        const nonce = this._getNonce();
        const files = parseDiff(diffContent);
        const diffHtml = this._generateDiffHtml(files);

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
        }

        .diff-table td {
            padding: 0 8px;
            white-space: pre;
            vertical-align: top;
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
            padding-right: 4px;
        }

        .line-num.new {
            padding-left: 4px;
            padding-right: 8px;
        }

        .line-content {
            width: 100%;
        }

        .line-content .prefix {
            display: inline-block;
            width: 16px;
            text-align: center;
            margin-right: 4px;
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
    </div>

    <div class="diff-content">
        ${diffHtml}
    </div>

    <script nonce="${nonce}">
        (function() {
            // Track collapsed state per file
            const collapsedState = {};

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

            if (expandBtn) {
                expandBtn.addEventListener('click', expandAll);
            }
            if (collapseBtn) {
                collapseBtn.addEventListener('click', collapseAll);
            }
        })();
    </script>
</body>
</html>`;
    }
}
