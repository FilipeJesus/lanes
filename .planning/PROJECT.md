# Lanes - File Attachment Support

## What This Is

An enhancement to the Lanes VS Code extension that adds file attachment capability to the session creation form. Users attach files via a paperclip button, see them as removable chips, and have file paths automatically included in the starting prompt sent to Claude.

## Core Value

Users can reference specific files in their session prompts without manually typing file paths, ensuring Claude has accurate context about which files to work with from the start.

## Requirements

### Validated

- ✓ Session creation form exists with starting prompt textarea — existing
- ✓ Webview-based form with message passing between extension and webview — existing
- ✓ VS Code file picker API available for file selection — existing platform capability
- ✓ Sessions receive a starting prompt that is written to a file and passed to Claude — existing
- ✓ Paperclip button visible in the starting prompt section of the session form — v1.0
- ✓ Clicking button opens VS Code file picker allowing multi-select of any file type — v1.0
- ✓ Selected files displayed as removable chip list (file icon + filename + X remove) — v1.0
- ✓ On session creation, prompt includes attachment paths as formatted list — v1.0
- ✓ Multiple file selection supported in a single picker dialog — v1.0
- ✓ Attachments persist in form state until session is created or user removes them — v1.0

### Active

(None — next milestone not yet defined)

### Out of Scope

- File content embedding — Only paths are included, not file contents (Claude reads files itself)
- Drag-and-drop file attachment — Potential v2 enhancement
- Folder/directory attachment — Only individual files for now
- File type filtering — Any file type is allowed
- File preview in the form — Only filenames/paths shown, no content preview

## Context

Shipped v1.0 with ~2,500 LOC TypeScript across 5 source files and 1 test file.
Tech stack: TypeScript, VS Code Extension API, Webview message passing.
643 tests passing (12 new for attachment feature). 0 regressions.
All 13 v1 requirements implemented and verified via milestone audit.

Key files modified:
- `src/SessionFormProvider.ts` — Attachment UI (paperclip button, chip list, file picker message handling)
- `src/services/SessionService.ts` — `assembleStartingPrompt` function
- `src/extension.ts` — Callback chain (form → service)
- `src/commands/sessionCommands.ts` — Command palette integration
- `src/test/session/session-form.test.ts` — 12 new attachment tests

## Constraints

- **Platform**: VS Code extension webview — limited to VS Code webview API capabilities
- **Security**: File paths must be properly escaped in HTML to prevent XSS in the webview
- **Architecture**: File picker can only be invoked from the extension host, not directly from webview JavaScript
- **Compatibility**: Must work with existing session creation flow without breaking current tests

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Paths only, not content | Claude can read files itself; embedding content would bloat prompts | ✓ Good |
| Extension-side file picker | VS Code API restriction — showOpenDialog unavailable in webview context | ✓ Good |
| Append paths as list to prompt | Clean format for Claude to parse; doesn't interfere with user's prompt text | ✓ Good |
| 20-file limit | Reasonable upper bound to prevent prompt bloat | ✓ Good |
| Case-insensitive duplicate detection | Prevents accidental re-attachment on case-insensitive file systems | ✓ Good |
| Paperclip icon in textarea corner | Consistent with common attachment UX; minimal space usage | ✓ Good |
| Chip/tag display with file icons | Compact, visually clear, easy to remove individual files | ✓ Good |

---
*Last updated: 2026-02-09 after v1.0 milestone*
