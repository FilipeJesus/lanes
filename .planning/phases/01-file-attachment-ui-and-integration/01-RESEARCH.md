# Phase 1: File Attachment UI & Integration - Research

**Researched:** 2026-02-09
**Domain:** VS Code extension webview UI, file picker API, message passing
**Confidence:** HIGH

## Summary

This phase adds file attachment capability to the Lanes session creation form using VS Code's native `showOpenDialog` API for file selection and webview message passing for communication. The implementation follows established VS Code extension patterns: webview UI handles display and user interaction, extension handles file system operations, and bidirectional message passing coordinates between them.

The technical stack is straightforward: VS Code built-in APIs (`window.showOpenDialog`, webview `postMessage`), standard HTML/CSS for the chip UI, and VS Code's codicons for file type icons. No external libraries are needed.

**Primary recommendation:** Use message-passing architecture where the webview sends a "showFilePicker" message to the extension (which invokes `showOpenDialog`), then extension returns selected file URIs back to webview for display. This keeps file system access in the extension context (where it belongs) and maintains security boundaries.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Button placement & style:**
- Paperclip icon button, no text label
- Positioned inside the bottom-right corner of the starting prompt textarea, overlaid
- Tooltip on hover: "Attach files"
- Button appearance does not change when files are attached (no count badge or state change)

**Attachment list layout:**
- Chip/tag style, horizontal wrapping row
- Chips appear directly below the textarea (between textarea and next form field)
- Each chip shows: file type icon + filename
- No tooltip on chips — full path is not shown in the UI

**File picker behavior:**
- Uses VS Code `showOpenDialog` (extension-side, not webview)
- Multi-file selection enabled
- Allows selecting files from anywhere on the filesystem (not restricted to workspace)
- Duplicate file selection shows a brief notification ("File already attached") then dismisses
- Reasonable file limit (e.g., ~20 files max)

**Prompt formatting:**
- Attachment section appears BEFORE the user's typed text in the assembled prompt
- Format is a labeled section with separator:
  ```
  Attached files:
  - /absolute/path/to/file1.ts
  - /absolute/path/to/file2.ts

  [user's typed prompt text]
  ```
- Always uses absolute paths, regardless of whether files are in workspace
- If user types no prompt text and only attaches files, send just the file list (no default instruction added)

### Claude's Discretion

- Default directory for file picker (workspace root or other sensible default)
- Exact styling of chips (colors, borders, spacing) — should follow VS Code webview conventions
- How the brief duplicate notification is displayed and dismissed
- File type icon implementation approach

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| VS Code Extension API | ^1.75.0 | File picker, message passing | Built-in, required for all VS Code extensions |
| VS Code Codicons | Built-in | File type icons | VS Code's official icon font, theme-aware, no external deps |
| Standard HTML/CSS | N/A | Webview UI (chips, overlaid button) | Built-in browser capabilities, no framework needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vscode.Uri | Built-in | Cross-platform file path handling | Always use for file paths (handles Windows/Mac/Linux differences) |
| webview CSP | Built-in | Security policy for webview | Required for all webviews to prevent XSS |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Codicons | External icon library (e.g., file-icons-js) | External: more file types, but adds bundle size, theme mismatch risk |
| Message passing | Direct file API in webview | Not possible — webviews cannot access file system directly due to sandbox |
| Simple extension mapping | VS Code language detection API | Language detection requires opening file, too heavyweight for UI icons |

**Installation:**
```bash
# No additional packages needed - all APIs are built into VS Code
# Codicons are bundled with VS Code and automatically available in webviews
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── SessionFormProvider.ts   # Existing webview provider - modify to add attachment UI
└── services/
    └── SessionService.ts     # Existing session creation - modify to format prompt
```

**Rationale:** Minimal file changes. Attachment UI lives in the form webview, prompt formatting happens in session creation logic.

### Pattern 1: Message-Passing for File Picker Invocation

**What:** Webview sends "showFilePicker" message to extension, extension invokes `window.showOpenDialog`, extension sends selected file URIs back to webview.

**When to use:** Always for file system operations from webviews (security requirement).

**Why:** Webviews are sandboxed and cannot access the file system directly. Extensions must handle all file system operations.

**Example:**
```typescript
// In SessionFormProvider.ts (extension side)
webviewView.webview.onDidReceiveMessage(async message => {
  switch (message.command) {
    case 'showFilePicker':
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: 'Attach',
        defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
      });

      if (uris && uris.length > 0) {
        // Send file paths back to webview
        this._view?.webview.postMessage({
          command: 'filesSelected',
          files: uris.map(uri => ({
            path: uri.fsPath,  // Absolute cross-platform path
            name: path.basename(uri.fsPath)
          }))
        });
      }
      break;
  }
});

// In webview HTML/JavaScript
const vscode = acquireVsCodeApi();

attachButton.addEventListener('click', () => {
  vscode.postMessage({ command: 'showFilePicker' });
});

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.command === 'filesSelected') {
    addFilesToAttachmentList(message.files);
  }
});
```

**Source:** [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview)

### Pattern 2: Overlaid Button with CSS Position Absolute

**What:** Wrapper div with `position: relative` contains textarea and button. Button has `position: absolute; bottom: [padding]; right: [padding];` to overlay inside textarea's visual bounds.

**When to use:** When UI requires a button to appear inside another input element's visual area.

**Why:** Textareas cannot contain child elements. Position absolute allows visual overlay while keeping button accessible in DOM.

**Example:**
```html
<!-- HTML Structure -->
<div class="textarea-wrapper">
  <textarea id="prompt" placeholder="Describe the task..."></textarea>
  <button class="attach-btn" title="Attach files">📎</button>
</div>

<style>
.textarea-wrapper {
  position: relative;
  width: 100%;
}

.textarea-wrapper textarea {
  width: 100%;
  min-height: 80px;
  padding-bottom: 36px; /* Reserve space for button */
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
}

.attach-btn:hover {
  background-color: var(--vscode-list-hoverBackground);
  border-radius: 3px;
}
</style>
```

**Source:** [CSS Position Absolute Patterns](https://mimo.org/glossary/css/position-absolute), [Overlapping Interactive Areas](https://www.tempertemper.net/blog/overlapping-interactive-areas)

### Pattern 3: Chip/Tag Components with Remove Buttons

**What:** Horizontal flex container with individual chip elements. Each chip contains icon + filename + remove button.

**When to use:** Displaying a removable list of selected items inline.

**Why:** Standard UI pattern for multi-select with visual feedback and easy removal.

**Example:**
```html
<!-- HTML Structure -->
<div class="attachment-chips">
  <div class="chip" data-path="/absolute/path/file.ts">
    <span class="chip-icon">📄</span>
    <span class="chip-label">file.ts</span>
    <button class="chip-remove" aria-label="Remove file.ts">×</button>
  </div>
</div>

<style>
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
  padding: 4px 4px 4px 8px;
  background-color: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 3px;
  font-size: 12px;
}

.chip-icon {
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
}

.chip-remove:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
</style>

<script>
// Remove chip on click
chipRemoveBtn.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  const filePath = chip.dataset.path;
  removeFileFromAttachments(filePath);
  chip.remove();
});
</script>
```

**Sources:** [PatternFly Chip Accessibility](https://www.patternfly.org/components/chip/accessibility/), [Chips UI Component Guide](https://prototype.jacksonholetraveler.com/core-signal/chips-ui-component-guide-examples-and-best-practices-1764799531)

### Pattern 4: State Persistence in Webview

**What:** Save attachment list in webview state using `vscode.setState()` so attachments persist when webview is hidden/recreated.

**When to use:** Always for webview form data that should survive webview disposal.

**Why:** VS Code may dispose webviews when they're not visible to save memory. State persistence maintains UX.

**Example:**
```javascript
// In webview JavaScript
const vscode = acquireVsCodeApi();
let attachments = [];

function saveState() {
  vscode.setState({
    name: nameInput.value,
    prompt: promptInput.value,
    attachments: attachments, // Array of {path, name}
    // ... other form fields
  });
}

// Restore on load
const previousState = vscode.getState();
if (previousState?.attachments) {
  attachments = previousState.attachments;
  renderAttachmentChips(attachments);
}

// Save whenever attachments change
function addAttachment(file) {
  attachments.push(file);
  saveState();
  renderAttachmentChips(attachments);
}

function removeAttachment(filePath) {
  attachments = attachments.filter(f => f.path !== filePath);
  saveState();
  renderAttachmentChips(attachments);
}
```

**Source:** [VS Code Webview API - State Persistence](https://code.visualstudio.com/api/extension-guides/webview#persistence)

### Anti-Patterns to Avoid

- **Accessing file system from webview JavaScript:** Webviews are sandboxed. Always use message passing to extension for file operations.
- **Using relative paths for attachments:** Relative paths break when worktree changes. Always use `uri.fsPath` for absolute cross-platform paths.
- **Inline scripts/styles without CSP:** Violates Content Security Policy. Use nonce-based script tags and separate style blocks.
- **Displaying full paths in UI chips:** Security/privacy risk, clutters UI. Show filenames only, store full paths in data attributes.
- **Not handling file picker cancellation:** User may cancel dialog. Check if `uris` is undefined before processing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File picker dialog | Custom HTML file input in webview | `vscode.window.showOpenDialog` | Native OS dialog, better UX, workspace-aware, keyboard accessible |
| Cross-platform paths | String manipulation for paths | `vscode.Uri.fsPath` | Handles Windows backslashes, Mac/Linux forward slashes, UNC paths, drive letter normalization |
| File type icons | Custom icon mapping logic | VS Code codicons + extension mapping | Theme-aware, maintained by VS Code, covers common file types |
| Duplicate detection | Manual array searching | `Set` or `Map` with path as key | O(1) lookup vs O(n), handles edge cases (case sensitivity) |
| Form state persistence | `localStorage` or custom storage | `vscode.setState()` | Built-in, survives webview disposal, no quota limits |

**Key insight:** VS Code provides well-tested APIs for common extension needs. Custom implementations introduce cross-platform bugs, accessibility issues, and theme inconsistencies. Use built-in APIs unless there's a specific limitation.

## Common Pitfalls

### Pitfall 1: File Picker Returns Undefined on Cancel

**What goes wrong:** Extension crashes or sends invalid data to webview when user cancels file picker.

**Why it happens:** `showOpenDialog` returns `undefined` if user cancels. Developers forget to check return value.

**How to avoid:**
```typescript
const uris = await vscode.window.showOpenDialog(options);
if (uris && uris.length > 0) {  // Check for undefined AND empty array
  // Process files
}
// If undefined or empty, do nothing (user cancelled)
```

**Warning signs:** Extension host error logs, webview receiving `filesSelected` message with undefined files array.

**Source:** [VS Code API - showOpenDialog](https://code.visualstudio.com/api/references/vscode-api)

### Pitfall 2: Case-Sensitive Duplicate Detection on Case-Insensitive File Systems

**What goes wrong:** Windows/Mac file systems are case-insensitive, but JavaScript string comparison is case-sensitive. User can "attach" `/path/File.txt` and `/path/file.txt` as "different" files, but they're the same file.

**Why it happens:** Using `Array.includes()` or `===` for path comparison without normalization.

**How to avoid:**
```typescript
// Normalize paths to lowercase for comparison on case-insensitive platforms
const attachedPathsSet = new Set(
  attachments.map(f => f.path.toLowerCase())
);

function isDuplicate(newPath: string): boolean {
  return attachedPathsSet.has(newPath.toLowerCase());
}
```

**Warning signs:** User reports attaching "same file twice" but sees two chips in UI.

**Source:** Development best practices for cross-platform file handling

### Pitfall 3: Not Reserving Space for Overlaid Button in Textarea

**What goes wrong:** User types text and it disappears under the attach button. Text is still there but visually hidden.

**Why it happens:** Overlaid button covers bottom-right corner without textarea padding compensation.

**How to avoid:**
```css
.textarea-wrapper textarea {
  padding-bottom: 36px; /* Reserve vertical space */
  padding-right: 36px;  /* Reserve horizontal space */
  /* If button is only 28px wide, extra padding provides breathing room */
}
```

**Warning signs:** User types in textarea, text "disappears" or is obscured by button.

**Source:** [CSS Position Absolute for Textareas](https://snook.ca/archives/html_and_css/absolute-position-textarea)

### Pitfall 4: Sending Non-Serializable Data in postMessage

**What goes wrong:** Extension sends `vscode.Uri` objects directly to webview via `postMessage`. Webview receives empty objects `{}` instead of file paths.

**Why it happens:** `postMessage` only serializes JSON-compatible data. `vscode.Uri` is a class instance with methods, not a plain object.

**How to avoid:**
```typescript
// BAD: Sending Uri objects directly
this._view?.webview.postMessage({
  command: 'filesSelected',
  files: uris  // These are Uri instances - won't serialize correctly
});

// GOOD: Extract plain data from Uri objects
this._view?.webview.postMessage({
  command: 'filesSelected',
  files: uris.map(uri => ({
    path: uri.fsPath,  // String
    name: path.basename(uri.fsPath)  // String
  }))
});
```

**Warning signs:** Webview console shows `{}` or `[object Object]` instead of file data.

**Source:** [VS Code Webview Message Passing](https://code.visualstudio.com/api/extension-guides/webview), [WebView postMessage Serialization](https://medium.com/@ashleyluu87/data-flow-from-vs-code-extension-webview-panel-react-components-2f94b881467e)

### Pitfall 5: File Limit Not Enforced Before Picker

**What goes wrong:** User attaches 15 files, opens picker again, selects 10 more. Now has 25 files but limit is 20. Either silently truncates (confusing) or shows error after selection (frustrating).

**Why it happens:** Limit check happens after `showOpenDialog` returns, not before showing dialog.

**How to avoid:**
```javascript
// In webview - check limit before requesting picker
attachButton.addEventListener('click', () => {
  if (attachments.length >= MAX_FILES) {
    // Show inline warning, don't invoke picker
    showWarning(`Maximum ${MAX_FILES} files allowed`);
    return;
  }

  vscode.postMessage({ command: 'showFilePicker' });
});

// In extension - also check limit when files selected (defensive)
const availableSlots = MAX_FILES - currentAttachmentCount;
if (uris.length > availableSlots) {
  vscode.window.showWarningMessage(
    `Can only attach ${availableSlots} more files (limit: ${MAX_FILES})`
  );
  // Optionally: take first N files instead of rejecting all
  uris = uris.slice(0, availableSlots);
}
```

**Warning signs:** User reports "some files didn't attach" or "confusing error after selecting files."

**Source:** [File Upload UX Best Practices](https://uploadcare.com/blog/file-uploader-ux-best-practices/)

### Pitfall 6: Prompt Assembly Breaks on Special Characters in File Paths

**What goes wrong:** File path contains characters like backticks, quotes, or newlines (rare but possible on some systems). Assembled prompt string breaks formatting or causes injection issues.

**Why it happens:** Naive string concatenation without escaping or validation.

**How to avoid:**
```typescript
// Simple validation: check for obviously problematic characters
function isValidFilePath(path: string): boolean {
  // Reject paths with newlines, nulls, or other control characters
  return !/[\n\r\0]/.test(path);
}

// Format prompt with explicit structure (no user-controlled formatting)
function assemblePrompt(attachments: string[], userPrompt: string): string {
  let prompt = '';

  if (attachments.length > 0) {
    prompt += 'Attached files:\n';
    for (const filePath of attachments) {
      if (!isValidFilePath(filePath)) {
        console.warn(`Skipping invalid file path: ${filePath}`);
        continue;
      }
      prompt += `- ${filePath}\n`;  // Simple list format
    }
    prompt += '\n';
  }

  if (userPrompt.trim()) {
    prompt += userPrompt;
  }

  return prompt;
}
```

**Warning signs:** Prompt formatting looks broken in terminal, unexpected line breaks.

**Source:** [File Upload Security Best Practices](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)

## Code Examples

### Example 1: Complete showOpenDialog Invocation

```typescript
// In SessionFormProvider.ts - extension side
async handleShowFilePicker(): Promise<void> {
  const options: vscode.OpenDialogOptions = {
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: 'Attach',
    title: 'Select files to attach',
    defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri
    // Note: No 'filters' property - allow all file types per requirements
  };

  const uris = await vscode.window.showOpenDialog(options);

  if (!uris || uris.length === 0) {
    // User cancelled - do nothing
    return;
  }

  // Convert Uri objects to plain serializable data
  const files = uris.map(uri => ({
    path: uri.fsPath,  // Cross-platform absolute path
    name: path.basename(uri.fsPath)
  }));

  // Send to webview
  this._view?.webview.postMessage({
    command: 'filesSelected',
    files: files
  });
}
```

**Source:** [VS Code API - OpenDialogOptions](https://code.visualstudio.com/api/references/vscode-api)

### Example 2: File Type Icon Mapping (Simple Extension-Based)

```typescript
// In webview JavaScript - simple icon mapping
function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  // Map common extensions to codicon classes
  const iconMap: Record<string, string> = {
    // Code files
    'js': 'file-code',
    'ts': 'file-code',
    'jsx': 'file-code',
    'tsx': 'file-code',
    'py': 'file-code',
    'java': 'file-code',
    'cpp': 'file-code',
    'c': 'file-code',
    'h': 'file-code',
    'go': 'file-code',
    'rs': 'file-code',

    // Markup/Data
    'html': 'file-code',
    'css': 'file-code',
    'json': 'json',
    'xml': 'file-code',
    'yaml': 'file-code',
    'yml': 'file-code',
    'md': 'markdown',

    // Media
    'png': 'file-media',
    'jpg': 'file-media',
    'jpeg': 'file-media',
    'gif': 'file-media',
    'svg': 'file-media',
    'mp4': 'file-media',
    'mp3': 'file-media',

    // Documents
    'pdf': 'file-pdf',
    'txt': 'file-text',

    // Archives
    'zip': 'file-zip',
    'tar': 'file-zip',
    'gz': 'file-zip',
  };

  return iconMap[ext] || 'file';  // Default to generic file icon
}

function renderChip(file: {path: string, name: string}): string {
  const iconClass = getFileIcon(file.name);
  return `
    <div class="chip" data-path="${escapeHtml(file.path)}">
      <span class="codicon codicon-${iconClass} chip-icon"></span>
      <span class="chip-label">${escapeHtml(file.name)}</span>
      <button class="chip-remove" aria-label="Remove ${escapeHtml(file.name)}">×</button>
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

**Note:** Need to include codicons CSS in webview HTML:

```html
<link rel="stylesheet" href="${webview.asWebviewUri(
  vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
)}">
```

**Alternative (no npm install needed):** Use VS Code's built-in codicon font:
```html
<style>
/* Codicons are available via VS Code's webview API */
@font-face {
  font-family: 'codicon';
  src: url('${webview.asWebviewUri(
    vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.ttf')
  )}') format('truetype');
}

.codicon {
  font-family: 'codicon';
  font-size: 16px;
  font-style: normal;
  font-weight: normal;
  line-height: 1;
}

.codicon-file::before { content: "\\ea7b"; }
.codicon-file-code::before { content: "\\ea85"; }
/* ... more icon codes as needed */
</style>
```

**Sources:** [VS Code Codicons](https://microsoft.github.io/vscode-codicons/), [@vscode/codicons npm](https://www.npmjs.com/package/@vscode/codicons)

### Example 3: Prompt Assembly with Attachments

```typescript
// In SessionService.ts - when creating session
function assembleStartingPrompt(
  userPrompt: string,
  attachments: string[]
): string {
  let prompt = '';

  // Attachments section (if any) comes FIRST
  if (attachments.length > 0) {
    prompt += 'Attached files:\n';
    for (const filePath of attachments) {
      prompt += `- ${filePath}\n`;
    }
    prompt += '\n';  // Blank line separator
  }

  // User's typed prompt (if any) comes SECOND
  if (userPrompt.trim()) {
    prompt += userPrompt;
  }

  return prompt;
}

// Usage in createSession
export async function createSession(
  name: string,
  userPrompt: string,
  permissionMode: PermissionMode,
  sourceBranch: string,
  workflow: string | null,
  attachments: string[],  // NEW PARAMETER
  baseRepoPath: string | undefined,
  sessionProvider: ClaudeSessionProvider,
  codeAgent: CodeAgent
): Promise<void> {
  // ... existing session setup code ...

  // Assemble prompt with attachments
  const startingPrompt = assembleStartingPrompt(userPrompt, attachments);

  // Open terminal with assembled prompt
  await openClaudeTerminal(
    name,
    worktreePath,
    startingPrompt,  // Send assembled prompt
    permissionMode,
    workflow,
    codeAgent,
    baseRepoPath
  );
}
```

**Source:** User requirements from CONTEXT.md

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTML `<input type="file">` in webview | `vscode.window.showOpenDialog` | VS Code 1.30+ | Native OS dialog, better accessibility, workspace-aware defaults |
| Custom icon fonts/SVGs | VS Code Codicons | VS Code 1.42+ (2020) | Theme consistency, automatic updates, smaller bundle |
| `localStorage` for state | `vscode.setState()` | VS Code 1.32+ | Survives webview disposal, no quota limits, cleaner API |
| Webview UI Toolkit | Direct HTML/CSS | Toolkit deprecated Jan 2025 | Use standard HTML/CSS with VS Code CSS variables instead |

**Deprecated/outdated:**
- **Webview UI Toolkit**: Deprecated January 1, 2025. Don't use `vscode-webview-ui-toolkit` npm package. Use standard HTML elements styled with VS Code CSS variables.
- **File scheme URIs in webview**: Must use `webview.asWebviewUri()` to convert file URIs. Direct `file://` URIs don't work in webviews.

**Sources:** [Webview UI Toolkit Deprecation](https://github.com/microsoft/vscode-webview-ui-toolkit), [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)

## Open Questions

1. **Should file picker default to workspace root or last-used directory?**
   - What we know: `defaultUri` accepts `vscode.workspace.workspaceFolders?.[0]?.uri` for workspace root
   - What's unclear: VS Code may remember last-used directory automatically (OS-level behavior)
   - Recommendation: Start with workspace root. Test on different OS to confirm behavior. Users can navigate as needed.

2. **How to handle very long filenames in chips (>150 characters)?**
   - What we know: `text-overflow: ellipsis` truncates with "...", `max-width` controls cutoff
   - What's unclear: Optimal max-width for sidebar webview (varies by user's sidebar width)
   - Recommendation: Use `max-width: 150px` as starting point, adjust based on testing. Full filename stored in `data-path` attribute for debugging.

3. **Should duplicate notification be VS Code info message or inline warning?**
   - What we know: User requirement is "brief notification that dismisses"
   - What's unclear: Whether `vscode.window.showInformationMessage()` is preferred over custom inline UI
   - Recommendation: Use inline warning div that auto-dismisses after 3 seconds. Less disruptive than modal notification, keeps user in flow. Falls under "Claude's Discretion" from CONTEXT.md.

## Sources

### Primary (HIGH confidence)
- [VS Code Webview API Documentation](https://code.visualstudio.com/api/extension-guides/webview) - Message passing, security, CSP
- [VS Code API Reference - showOpenDialog](https://code.visualstudio.com/api/references/vscode-api) - File picker API signature
- [VS Code Codicons](https://microsoft.github.io/vscode-codicons/) - Official icon font
- [@vscode/codicons npm](https://www.npmjs.com/package/@vscode/codicons) - Icon package and usage

### Secondary (MEDIUM confidence)
- [PatternFly Chip Accessibility](https://www.patternfly.org/components/chip/accessibility/) - Chip component best practices
- [File Upload UX Best Practices](https://uploadcare.com/blog/file-uploader-ux-best-practices/) - Validation, limits, feedback
- [Smashing Magazine - Accessible Components](https://www.smashingmagazine.com/2021/03/complete-guide-accessible-front-end-components/) - General accessibility patterns

### Tertiary (LOW confidence, needs verification)
- [file-icons-js](https://github.com/exuanbo/file-icons-js) - Alternative icon mapping library (not using, but referenced for comparison)
- [CSS Position Absolute Patterns](https://mimo.org/glossary/css/position-absolute) - General CSS reference (standard technique, low risk)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All APIs are official VS Code built-ins, well-documented, stable since VS Code 1.32+
- Architecture: HIGH - Message-passing pattern is required by webview sandbox, verified in official docs
- Pitfalls: MEDIUM-HIGH - Based on common VS Code extension development patterns, some from direct experience with similar extensions, some from general web development best practices

**Research date:** 2026-02-09
**Valid until:** ~90 days (March 2026) - VS Code APIs are very stable, but check release notes for any webview-related changes
