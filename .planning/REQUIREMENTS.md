# Requirements: Lanes File Attachment Support

**Defined:** 2026-02-09
**Core Value:** Users can reference specific files in their session prompts without manually typing file paths

## v1 Requirements

### UI - Attachment Button

- [ ] **UI-01**: User sees a "+" button adjacent to the starting prompt textarea in the session form
- [ ] **UI-02**: "+" button is visually consistent with the existing form design (VS Code webview styling)

### Picker - File Selection

- [ ] **PICK-01**: Clicking "+" opens a VS Code native file picker dialog
- [ ] **PICK-02**: File picker allows selecting multiple files at once
- [ ] **PICK-03**: File picker allows selecting any file type (no extension filter)

### Display - Attachment List

- [ ] **DISP-01**: Selected files appear as a list below the starting prompt textarea
- [ ] **DISP-02**: Each file in the list shows the filename (not full path) for readability
- [ ] **DISP-03**: Each file in the list has an "X" remove button to deselect it
- [ ] **DISP-04**: Clicking the "X" removes the file from the attachment list
- [ ] **DISP-05**: Adding more files via "+" appends to the existing list (doesn't replace)

### Integration - Prompt Assembly

- [ ] **INT-01**: When session is created, the starting prompt includes the attachment paths
- [ ] **INT-02**: Attachments are appended as a formatted list with full absolute file paths
- [ ] **INT-03**: If no attachments are selected, the prompt is sent as-is (no empty attachment section)

## v2 Requirements

### Enhanced Attachment UX

- **DND-01**: User can drag and drop files onto the form to attach them
- **PREV-01**: User can hover over an attachment to see the full file path as a tooltip
- **FOLD-01**: User can attach entire folders/directories

## Out of Scope

| Feature | Reason |
|---------|--------|
| File content embedding in prompt | Claude reads files itself; embedding would bloat prompts |
| File type filtering | User should be able to attach any file |
| File content preview | Adds complexity; filenames are sufficient |
| Attachment persistence across form resets | Not needed; each session creation is independent |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| UI-01 | Phase 1 | Pending |
| UI-02 | Phase 1 | Pending |
| PICK-01 | Phase 1 | Pending |
| PICK-02 | Phase 1 | Pending |
| PICK-03 | Phase 1 | Pending |
| DISP-01 | Phase 1 | Pending |
| DISP-02 | Phase 1 | Pending |
| DISP-03 | Phase 1 | Pending |
| DISP-04 | Phase 1 | Pending |
| DISP-05 | Phase 1 | Pending |
| INT-01 | Phase 1 | Pending |
| INT-02 | Phase 1 | Pending |
| INT-03 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-02-09*
*Last updated: 2026-02-09 after roadmap creation*
