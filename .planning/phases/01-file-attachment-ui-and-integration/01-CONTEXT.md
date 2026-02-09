# Phase 1: File Attachment UI & Integration - Context

**Gathered:** 2026-02-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Add file attachment capability to the Lanes session creation form. Users click a "+" button to select files via VS Code's native file picker, see selected files as a removable chip list, and have those file paths automatically included in the starting prompt when creating a session. Only file paths are included — Claude reads file content itself.

</domain>

<decisions>
## Implementation Decisions

### Button placement & style
- Paperclip icon button, no text label
- Positioned inside the bottom-right corner of the starting prompt textarea, overlaid
- Tooltip on hover: "Attach files"
- Button appearance does not change when files are attached (no count badge or state change)

### Attachment list layout
- Chip/tag style, horizontal wrapping row
- Chips appear directly below the textarea (between textarea and next form field)
- Each chip shows: file type icon + filename
- No tooltip on chips — full path is not shown in the UI

### File picker behavior
- Uses VS Code `showOpenDialog` (extension-side, not webview)
- Multi-file selection enabled
- Allows selecting files from anywhere on the filesystem (not restricted to workspace)
- Duplicate file selection shows a brief notification ("File already attached") then dismisses
- Reasonable file limit (e.g., ~20 files max)

### Prompt formatting
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

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches that match VS Code's native look and feel.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-file-attachment-ui-and-integration*
*Context gathered: 2026-02-09*
