---
phase: 01-foundation-refactoring
plan: 01
subsystem: extension-core
tags: [code-agent, abstraction, file-paths, watchers, terminal-names]

# Dependency graph
requires: []
provides:
  - Agent-agnostic file path resolution via CodeAgent methods in all shared services
  - DEFAULTS constant for backward-compatible fallback file names
  - getLocalSettingsFiles() abstract method on CodeAgent for settings propagation
  - Watch patterns constructed from CodeAgent methods instead of hardcoded strings
  - Terminal names constructed via codeAgent.getTerminalName() in all command handlers
affects: [01-02-localSettings-generalization, 01-03-rename-functions, 01-04-rename-files]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DEFAULTS constant pattern for backward-compatible fallbacks when CodeAgent is undefined"
    - "Agent method call pattern: codeAgent?.getXxxFileName() || DEFAULTS.xxxFileName"

key-files:
  created: []
  modified:
    - src/ClaudeSessionProvider.ts
    - src/services/SettingsService.ts
    - src/watchers.ts
    - src/commands/sessionCommands.ts
    - src/codeAgents/CodeAgent.ts
    - src/codeAgents/ClaudeCodeAgent.ts

key-decisions:
  - "Exported DEFAULTS constant from ClaudeSessionProvider for reuse in SettingsService and watchers"
  - "Kept fallback ternaries (codeAgent ? ... : 'Claude: ...') for backward compatibility when no agent is configured"

patterns-established:
  - "DEFAULTS constant: Single source of truth for fallback file names when no CodeAgent is available"
  - "Agent method delegation: getGlobalCodeAgent()?.getStatusFileName() || DEFAULTS.statusFileName"
  - "getLocalSettingsFiles(): Abstract method returning array of { dir, file } for settings propagation"

# Metrics
duration: 3min
completed: 2026-02-10
---

# Phase 1 Plan 01: Replace Hardcoded Strings with CodeAgent Methods Summary

**All shared services now resolve file paths, watch patterns, and terminal names through CodeAgent methods with DEFAULTS constant fallbacks**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-10T10:21:01Z
- **Completed:** 2026-02-10T10:24:28Z
- **Tasks:** 1
- **Files modified:** 6

## Accomplishments
- Replaced all hardcoded `.claude-session`, `.claude-status` strings in shared code with CodeAgent method calls
- Added `DEFAULTS` constant in ClaudeSessionProvider as the single source of truth for fallback file names
- Updated `SettingsService.getStatusWatchPattern()` and `getSessionWatchPattern()` to use `getGlobalCodeAgent()?.getStatusFileName()` / `getSessionFileName()`
- Updated `watchers.ts` global storage watchers to use `codeAgent?.getStatusFileName()` / `getSessionFileName()`
- Updated `sessionCommands.ts` delete and openInNewWindow handlers to use `codeAgent.getTerminalName()` and `codeAgent.getStatusFileName()`
- Added `getLocalSettingsFiles()` abstract method to `CodeAgent` and implemented in `ClaudeCodeAgent`
- Added legacy fallback comment in `getClaudeStatus()` documenting backward compatibility path

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace hardcoded file paths and terminal names with CodeAgent method calls** - `2796c36` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `src/ClaudeSessionProvider.ts` - Added DEFAULTS constant, updated getClaudeSessionPath/getClaudeStatusPath to use DEFAULTS, added legacy fallback comment
- `src/services/SettingsService.ts` - Updated getStatusWatchPattern/getSessionWatchPattern to use CodeAgent methods with DEFAULTS fallback
- `src/watchers.ts` - Updated global storage watcher patterns to use CodeAgent methods with DEFAULTS fallback
- `src/commands/sessionCommands.ts` - Updated deleteSession and openInNewWindow terminal name resolution and status file name lookup
- `src/codeAgents/CodeAgent.ts` - Added getLocalSettingsFiles() abstract method
- `src/codeAgents/ClaudeCodeAgent.ts` - Implemented getLocalSettingsFiles() returning .claude/settings.local.json

## Decisions Made
- Exported DEFAULTS constant from ClaudeSessionProvider rather than duplicating it, so SettingsService and watchers import from the same source
- Kept fallback ternaries (`codeAgent ? codeAgent.getTerminalName(...) : \`Claude: ...\``) in all locations for backward compatibility when no CodeAgent is configured

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All shared code now uses CodeAgent methods for agent-specific behavior
- DEFAULTS constant is ready for import by Plan 01-02 (localSettings generalization)
- getLocalSettingsFiles() method is ready for use by Plan 01-02
- No blockers for subsequent plans

---
*Phase: 01-foundation-refactoring*
*Completed: 2026-02-10*
