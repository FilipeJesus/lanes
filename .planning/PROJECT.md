# Lanes - File Attachment Support

## What This Is

An enhancement to the Lanes VS Code extension that adds file attachment capability to the session creation form. Users can attach files via a "+" button next to the starting prompt textarea, and those file paths are automatically included in the prompt sent to Claude when creating a session.

## Core Value

Users can reference specific files in their session prompts without manually typing file paths, ensuring Claude has accurate context about which files to work with from the start.

## Requirements

### Validated

- ✓ Session creation form exists with starting prompt textarea — existing
- ✓ Webview-based form with message passing between extension and webview — existing
- ✓ VS Code file picker API available for file selection — existing platform capability
- ✓ Sessions receive a starting prompt that is written to a file and passed to Claude — existing

### Active

- [ ] "+" button visible in the starting prompt section of the session form
- [ ] Clicking "+" opens VS Code file picker allowing multi-select of any file type
- [ ] Selected files displayed as a removable list (filename + "X" remove button) in the form
- [ ] On session creation, prompt includes attachment paths as a formatted list
- [ ] Multiple file selection supported in a single picker dialog
- [ ] Attachments persist in form state until session is created or user removes them

### Out of Scope

- File content embedding — Only paths are included, not file contents (Claude reads files itself)
- Drag-and-drop file attachment — Out of scope for v1, may add later
- Folder/directory attachment — Only individual files
- File type filtering — Any file type is allowed
- File preview in the form — Only filenames/paths shown, no content preview

## Context

- The session form is implemented in `src/SessionFormProvider.ts` as a VS Code WebviewViewProvider
- The form already handles session name, source branch, permission mode, workflow, and starting prompt
- Webview ↔ extension communication uses `postMessage` with command-based message protocol
- The starting prompt is passed to `SessionService.createSession()` and written to a prompt file
- The form uses inline HTML/CSS/JS generated in `_getHtmlForWebview()` method
- VS Code's `vscode.window.showOpenDialog()` API provides native file picker with multi-select support
- The file picker must be triggered from the extension side (not webview), so the webview sends a message requesting file selection, and the extension responds with selected paths

## Constraints

- **Platform**: VS Code extension webview — limited to VS Code webview API capabilities
- **Security**: File paths must be properly escaped in HTML to prevent XSS in the webview
- **Architecture**: File picker can only be invoked from the extension host, not directly from webview JavaScript
- **Compatibility**: Must work with existing session creation flow without breaking current tests

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Paths only, not content | Claude can read files itself; embedding content would bloat prompts | — Pending |
| Extension-side file picker | VS Code API restriction — showOpenDialog unavailable in webview context | — Pending |
| Append paths as list to prompt | Clean format for Claude to parse; doesn't interfere with user's prompt text | — Pending |

---
*Last updated: 2026-02-09 after initialization*
