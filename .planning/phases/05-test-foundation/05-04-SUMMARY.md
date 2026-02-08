# Phase 05 Plan 04: Test File Organization Gap Closure Summary

Split 4 large test files that exceeded the 500-line target into focused modules.

## One-Liner
Split 4 oversized test files (diff.test.ts: 1795 lines, settings.test.ts: 1341 lines, mcp.test.ts: 856 lines, previousSession.test.ts: 521 lines) into 11 focused modules under 500 lines each.

## Metrics
- **Duration:** ~25 minutes
- **Completed Date:** 2026-02-08
- **Test Files Before:** 4 files with 4,513 total lines
- **Test Files After:** 11 files with 3,861 total lines
- **Lines Reduced:** 652 lines (14.4% reduction)

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Split diff.test.ts | 97ea0a9 | Created 6 test files, deleted diff.test.ts |
| 2 | Split settings.test.ts | b71edbd | Created 3 test files, deleted settings.test.ts |
| 3 | Split mcp.test.ts and previousSession.test.ts | 348dff7 | Created 5 test files, deleted 2 original files |

## Files Created

### Git Diff Tests
- `src/test/git/diff-base-branch.test.ts` (421 lines) - Base branch detection and selection
- `src/test/git/diff-branches.test.ts` (112 lines) - Branch handling utilities
- `src/test/git/diff-command.test.ts` (91 lines) - Command registration
- `src/test/git/diff-comments.test.ts` (336 lines) - Review comment feature
- `src/test/git/diff-parsing.test.ts` (455 lines) - Diff parsing utilities
- `src/test/git/diff-webview.test.ts` (195 lines) - Webview rendering tests

### Config Tests
- `src/test/config/global-storage.test.ts` (316 lines) - Global storage path tests
- `src/test/config/package-config.test.ts` (211 lines) - Package.json config tests
- `src/test/config/prompts-storage.test.ts` (321 lines) - Prompts path storage tests

### Workflow Tests
- `src/test/workflow/mcp-workflow-control.test.ts` (221 lines) - workflowStart, SetTasks, Advance
- `src/test/workflow/mcp-state-context.test.ts` (344 lines) - workflowStatus, Context, persistence
- `src/test/workflow/mcp-artefacts.test.ts` (270 lines) - workflowRegisterArtefacts, session creation

### Previous Session Tests
- `src/test/previous-session-item.test.ts` (65 lines) - PreviousSessionItem class
- `src/test/previous-session-provider.test.ts` (265 lines) - PreviousSessionProvider, getPromptsDir

## Files Deleted
- `src/test/git/diff.test.ts` (1795 lines)
- `src/test/config/settings.test.ts` (1341 lines)
- `src/test/workflow/mcp.test.ts` (856 lines)
- `src/test/previousSession.test.ts` (521 lines)

## Deviations from Plan

**Rule 1 - Bug (Test Failure):** Fixed test issue in `global-storage.test.ts`
- **Found during:** Task 2 commit pre-commit hook
- **Issue:** Test was checking `result.startsWith(globalStorageDir)` but the actual global storage directory used was `mockGlobalStorageDir`
- **Fix:** Added `mockGlobalStorageDir` variable to the nested suite setup and used it for assertions
- **Files modified:** `src/test/config/global-storage.test.ts`
- **Commit:** b71edbd

**Rule 1 - Bug (TypeScript Compilation):** Fixed import path issues in new test files
- **Found during:** Task 3 commit pre-commit hook
- **Issue:** Import paths used `../../../mcp/tools` but should have been `../../mcp/tools` (one less level)
- **Fix:** Corrected import paths in all 3 new mcp test files
- **Files modified:** `src/test/workflow/mcp-workflow-control.test.ts`, `src/test/workflow/mcp-state-context.test.ts`, `src/test/workflow/mcp-artefacts.test.ts`
- **Commit:** 348dff7

**Rule 1 - Bug (Dynamic Import Issues):** Replaced dynamic imports with static imports
- **Found during:** Task 3 compilation
- **Issue:** Tests used dynamic imports like `await import('../../../mcp/tools')` which caused TS errors
- **Fix:** Added missing imports at top of file and used them directly
- **Files modified:** `src/test/workflow/mcp-artefacts.test.ts`, `src/test/previous-session-provider.test.ts`
- **Commit:** 348dff7

**Rule 1 - Bug (State Persistence Test):** Fixed test missing state save
- **Found during:** Task 3 test execution
- **Issue:** Test `Workflow state persists across server restarts` was missing `saveState` call after final advance
- **Fix:** Added `await saveState(tempDir, machine1.getState());` before loading state
- **Files modified:** `src/test/workflow/mcp-state-context.test.ts`
- **Commit:** 348dff7

## Verification

All tests pass (1357 passing, 11 pending):
```bash
npm test
# 1357 passing (14s)
```

All new test files are under 500 lines:
```bash
wc -l src/test/git/*.test.ts src/test/config/*.test.ts src/test/workflow/mcp-*.test.ts src/test/previous-session-*.test.ts
```

## Self-Check: PASSED

- [x] All 11 new test files exist
- [x] All 4 original test files deleted
- [x] All 3 commits exist (97ea0a9, b71edbd, 348dff7)
- [x] All new files under 500 lines
- [x] Full test suite passes
