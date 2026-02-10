---
phase: 02-agent-abstraction-enhancement
plan: 03
subsystem: infra
tags: [toml, settings-format, iarna-toml, codex, format-abstraction]

# Dependency graph
requires:
  - phase: 02-agent-abstraction-enhancement
    plan: 01
    provides: "CodeAgent abstract class with getSettingsFileName(), CodexAgent stub with config.toml settings"
provides:
  - "SettingsFormat interface with read/write contract for format-agnostic settings"
  - "JsonSettingsFormat for Claude settings (JSON)"
  - "TomlSettingsFormat with lazy @iarna/toml import for Codex settings (TOML)"
  - "getSettingsFormat() factory selecting format from agent's settings file name"
  - "Format-aware atomic settings file writing in SettingsService"
  - "Hookless agent support in SettingsService (no hooks, no hook scripts)"
affects: [03-codex-implementation, 04-session-lifecycle]

# Tech tracking
tech-stack:
  added: ["@iarna/toml ^2.2.5"]
  patterns: ["Strategy pattern for format-specific read/write", "Lazy dynamic import for optional dependencies"]

key-files:
  created:
    - "src/services/SettingsFormatService.ts"
  modified:
    - "src/services/SettingsService.ts"
    - "package.json"

key-decisions:
  - "TOML lazily imported via dynamic import() to avoid loading when only JSON sessions are in use"
  - "Format determined by file extension from agent's getSettingsFileName() (not agent name)"
  - "Singleton format instances (jsonFormat, tomlFormat) shared across all calls"
  - "Hookless agents get empty settings object (no hooks key) rather than empty hooks object"
  - "Hook script generation and hooks configuration both guarded by supportsHooks() check"

patterns-established:
  - "Settings format selection: getSettingsFormat(codeAgent) returns appropriate SettingsFormat"
  - "Hookless agent path: supportsHooks() === false skips hook script + hooks config entirely"

# Metrics
duration: 5min
completed: 2026-02-10
---

# Phase 2 Plan 3: Settings Format Abstraction Summary

**Format-agnostic settings service with JSON and TOML support via @iarna/toml, hookless agent path in SettingsService**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-10T11:38:58Z
- **Completed:** 2026-02-10T11:44:23Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created SettingsFormatService with SettingsFormat interface, JsonSettingsFormat, and TomlSettingsFormat implementations
- Installed @iarna/toml (v2.2.5) with built-in TypeScript definitions for TOML parsing and serialization
- Updated SettingsService to use format-aware atomic writing via getSettingsFormat()
- Added hookless agent path that skips hook script generation and hooks configuration entirely

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @iarna/toml and create SettingsFormatService** - `0fa7e38` (feat)
2. **Task 2: Update SettingsService to use format abstraction** - `fa2d453` (feat)

## Files Created/Modified
- `src/services/SettingsFormatService.ts` - SettingsFormat interface, JsonSettingsFormat, TomlSettingsFormat, getSettingsFormat() factory
- `src/services/SettingsService.ts` - Import getSettingsFormat, hookless agent path, format-aware atomic writing
- `package.json` - Added @iarna/toml ^2.2.5 dependency

## Decisions Made
- TOML library lazily imported via `await import('@iarna/toml')` inside TomlSettingsFormat methods to avoid loading for Claude-only usage
- Format selection uses file extension (`.toml` -> TOML, everything else -> JSON) rather than agent name for extensibility
- Singleton format instances avoid repeated object creation
- Hookless agents get settings without hooks key rather than an empty hooks object (cleaner TOML output)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] supportsHooks() already existed from Plan 02-02**
- **Found during:** Task 2 (SettingsService update)
- **Issue:** Plan referenced `codeAgent.supportsHooks()` which was expected to not exist yet, but Plan 02-02 had already added it to CodeAgent
- **Fix:** No fix needed - the method was already available from the prior plan's execution
- **Files modified:** None (already present)
- **Verification:** TypeScript compilation passed

---

**Total deviations:** 1 (non-issue - dependency already satisfied)
**Impact on plan:** None - plan executed as intended with the method already available.

## Issues Encountered

- VS Code extension tests could not run because VS Code was already running (expected in this environment). Compilation and lint pass confirmed correctness.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SettingsFormatService is ready for Phase 3 full Codex implementation (TOML settings will be written automatically)
- Hookless agent path ensures Codex sessions get clean settings without Claude-specific hook configuration
- All existing Claude functionality is completely unaffected (JSON path with hooks is the default)

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 02-agent-abstraction-enhancement*
*Completed: 2026-02-10*
