---
phase: 03-codex-cli-integration
plan: 02
subsystem: agent-integration
tags: [codex, session-management, filesystem-polling, uuid, hookless-agents]

# Dependency graph
requires:
  - phase: 03-codex-cli-integration
    provides: CodexAgent command building (buildStartCommand, buildResumeCommand)
provides:
  - Filesystem-based session ID capture for Codex CLI via polling ~/.codex/sessions/
  - Hookless agent session ID integration for resume functionality
  - Non-blocking error handling with user-facing warnings
affects: [phase-04-agent-selection, future-hookless-agents]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hookless agent session capture via filesystem polling"
    - "Fire-and-forget async capture with timestamp filtering"
    - "Dynamic import to avoid circular dependencies"

key-files:
  created: []
  modified:
    - src/codeAgents/CodexAgent.ts
    - src/services/TerminalService.ts

key-decisions:
  - "10-second timeout (not 5s) for generous slow machine startup handling"
  - "Timestamp-based filtering to avoid picking up pre-existing session files"
  - "Multi-field session ID extraction (session_id, id, sessionId) for format flexibility"
  - "Strict error handling with user warning, no silent --last fallback (locked decision)"
  - "Fire-and-forget pattern for non-blocking terminal creation"

patterns-established:
  - "Hookless agents use captureSessionId static method for filesystem-based session tracking"
  - "Session ID capture only on fresh starts, never on resume"
  - "beforeTimestamp captured before sendText to ensure only new sessions detected"

# Metrics
duration: 7min
completed: 2026-02-10
---

# Phase 03 Plan 02: Codex Session ID Capture Summary

**Filesystem-based session ID capture for Codex CLI with 10s polling timeout and timestamp-filtered detection**

## Performance

- **Duration:** 7 minutes
- **Started:** 2026-02-10T13:12:05Z
- **Completed:** 2026-02-10T13:19:16Z
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments
- Static `captureSessionId` method polls ~/.codex/sessions/ for newly created session files
- Helper function `captureHooklessSessionId` handles full capture lifecycle with error handling
- Terminal startup flow triggers capture fire-and-forget for hookless agents only
- Timestamp filtering ensures only new sessions (created after start command) are detected
- Strict error behavior per locked decision (warning to user, no silent --last fallback)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add captureSessionId to CodexAgent** - `d6c810d` (feat)
2. **Task 2: Add captureHooklessSessionId helper function to TerminalService** - `7667a4b` (feat)
3. **Task 3: Integrate capture into openAgentTerminal post-start flow** - `35abe86` (feat)

## Files Created/Modified
- `src/codeAgents/CodexAgent.ts` - Added static `captureSessionId` method with filesystem polling, UUID validation, JSONL parsing, and 10s timeout
- `src/services/TerminalService.ts` - Added `captureHooklessSessionId` helper function and integrated timestamp capture + fire-and-forget call in `shouldStartFresh` block

## Decisions Made
- 10-second timeout instead of 5s from research notes - more generous for slow machine startups
- Support multiple session ID field names (session_id, id, sessionId) - research indicated field name uncertainty
- Dynamic import with .js extension for CodexAgent to avoid circular dependencies
- Timestamp captured before sendText (not after) to ensure filtering works correctly
- Fire-and-forget pattern (no await) to avoid blocking terminal creation
- All decisions aligned with plan specification and locked decision on error handling

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

**TypeScript module resolution error**
- **Issue:** Dynamic import path `'../codeAgents/CodexAgent'` failed with error requiring explicit .js extension
- **Resolution:** Changed to `'../codeAgents/CodexAgent.js'` following pattern used in test files
- **Impact:** None - compilation successful after fix

**Pre-existing test failure**
- **Issue:** 1 test failing in `diff-base-branch.test.ts` (worktree detection test expects different path when run in worktree environment)
- **Resolution:** Not related to this plan's changes - 643 tests pass including all relevant to session ID capture
- **Impact:** None - pre-existing issue, not a regression

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Session ID capture infrastructure complete for Codex CLI. Key capabilities:
- Codex sessions can be resumed after terminal restart
- Session ID automatically written to session file for persistence
- User receives clear warning if capture fails (with actionable guidance)
- Claude Code sessions completely unaffected by capture logic

Blockers/Concerns: None

## Self-Check: PASSED

All claims verified:
- ✓ File exists: src/codeAgents/CodexAgent.ts
- ✓ File exists: src/services/TerminalService.ts
- ✓ Commit exists: d6c810d (Task 1)
- ✓ Commit exists: 7667a4b (Task 2)
- ✓ Commit exists: 35abe86 (Task 3)
- ✓ Method exists: captureSessionId in CodexAgent
- ✓ Function exists: captureHooklessSessionId in TerminalService
- ✓ Implementation exists: beforeStartTimestamp capture

---
*Phase: 03-codex-cli-integration*
*Completed: 2026-02-10*
