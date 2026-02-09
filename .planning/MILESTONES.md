# Milestones

## v1.0 File Attachment Support (Shipped: 2026-02-09)

**Delivered:** File attachment capability for the session creation form, enabling users to attach files via a visual picker and have paths automatically included in the starting prompt.

**Phases completed:** 1 (2 plans total)

**Key accomplishments:**

- Paperclip attachment button overlaid inside the session form textarea
- VS Code native file picker with multi-select support via extension-side message passing
- Chip-based attachment display with file-type icons, filenames, and remove buttons
- Prompt assembly that prepends formatted file paths before user text
- 12 new tests covering UI elements, callbacks, and state persistence

**Stats:**

- 5 source files modified + 1 test file added
- ~2,500 lines of TypeScript (feature + tests)
- 1 phase, 2 plans
- 1 day (2026-02-09)
- 643 tests passing (12 new, 0 regressions)

**Git range:** `dc88e8b` → `266e8b7`

**What's next:** v2 enhancements — drag-and-drop, folder attachment, full-path tooltips

---
