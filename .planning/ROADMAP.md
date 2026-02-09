# Roadmap: Lanes File Attachment Support

## Overview

Add file attachment capability to the Lanes session creation form. Users click a "+" button to select files via VS Code's native file picker, see selected files as a removable list, and have those file paths automatically included in the starting prompt when creating a session.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: File Attachment UI & Integration** - Complete attachment feature from UI to prompt integration

## Phase Details

### Phase 1: File Attachment UI & Integration
**Goal**: Users can attach files to their session starting prompt via a visual file picker and see those paths automatically included in the prompt.

**Depends on**: Nothing (first phase)

**Requirements**: UI-01, UI-02, PICK-01, PICK-02, PICK-03, DISP-01, DISP-02, DISP-03, DISP-04, DISP-05, INT-01, INT-02, INT-03

**Success Criteria** (what must be TRUE):
  1. User sees a "+" button in the session form next to the starting prompt textarea
  2. User can click the "+" button and select multiple files from the VS Code file picker dialog
  3. User sees selected files displayed as a list with filenames and "X" remove buttons
  4. User can remove individual files from the list by clicking the "X" button
  5. User can create a session and the starting prompt includes the full file paths in a formatted list

**Plans**: 2 plans

Plans:
- [ ] 01-01: Implement attachment UI (button, file picker, removable list in webview)
- [ ] 01-02: Integrate attachments into prompt assembly and session creation

## Progress

**Execution Order:**
Phases execute in numeric order.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. File Attachment UI & Integration | 0/2 | Not started | - |
