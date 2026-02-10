---
phase: 02-agent-abstraction-enhancement
plan: 02
subsystem: infra
tags: [session-metadata, hookless-tracking, terminal-lifecycle, backward-compat]

# Dependency graph
requires:
  - phase: 02-agent-abstraction-enhancement
    plan: 01
    provides: "CodeAgent abstract class with getHookEvents(), CodexAgent stub with empty hooks, agent factory"
provides:
  - "agentName field in AgentSessionData (optional, backward-compatible)"
  - "getSessionAgentName() helper for direct agent name lookup"
  - "supportsHooks() method on CodeAgent base class (infers from getHookEvents())"
  - "Hookless session file writing during createSession() for agents without hooks"
  - "Terminal lifecycle tracking (active/idle) via hooklessTerminals Map"
  - "registerHooklessTerminalTracking() and trackHooklessTerminal() in TerminalService"
affects: [02-03, 03-codex-implementation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["hookless terminal tracking via Map<Terminal, worktreePath> and onDidCloseTerminal", "backward-compatible session field (missing = implicit Claude)"]

key-files:
  modified:
    - "src/codeAgents/CodeAgent.ts"
    - "src/AgentSessionProvider.ts"
    - "src/services/SessionService.ts"
    - "src/services/TerminalService.ts"
    - "src/extension.ts"

key-decisions:
  - "supportsHooks() uses default implementation inferring from getHookEvents().length > 0 (not abstract)"
  - "agentName field is optional in AgentSessionData for backward compatibility"
  - "Missing agentName in legacy session files defaults to 'claude' (no migration needed)"
  - "Hookless agents get 'active' status on terminal open, 'idle' on terminal close (no granular working/waiting)"

patterns-established:
  - "Hookless tracking pattern: Map<Terminal, worktreePath> + onDidCloseTerminal listener registered at activation"
  - "Session file creation for hookless agents: Lanes writes directly in createSession() instead of relying on CLI hooks"
  - "Backward-compatible field addition: optional field + default fallback in reading functions"

# Metrics
duration: 5min
completed: 2026-02-10
---

# Phase 2 Plan 2: Session Metadata Persistence and Hookless Terminal Tracking Summary

**Per-session agentName field with backward-compatible reading, hookless session file creation, and terminal open/close lifecycle tracking for agents without hook systems**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-10T11:38:53Z
- **Completed:** 2026-02-10T11:44:13Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `agentName` field to `AgentSessionData` interface with backward-compatible reading (missing = Claude)
- Added `supportsHooks()` method to `CodeAgent` base class that infers hook support from `getHookEvents()`
- Session creation now writes initial session file with `agentName` for hookless agents (e.g., Codex)
- Terminal lifecycle tracking writes `active` status on terminal open and `idle` on terminal close for hookless agents
- All 643 existing tests pass unchanged (backward compatibility maintained)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add agentName to session data model and update session creation** - `feb2647` (feat)
2. **Task 2: Add hookless terminal lifecycle tracking in TerminalService** - `9b57c16` (feat)

## Files Created/Modified
- `src/codeAgents/CodeAgent.ts` - Added `supportsHooks()` method with default implementation
- `src/AgentSessionProvider.ts` - Added `agentName` to `AgentSessionData`, updated `getSessionId()`, added `getSessionAgentName()`
- `src/services/SessionService.ts` - Added hookless session file writing in `createSession()` with `ensureDir`/`writeJson`
- `src/services/TerminalService.ts` - Added `hooklessTerminals` Map, `registerHooklessTerminalTracking()`, `trackHooklessTerminal()`, updated `openAgentTerminal()`
- `src/extension.ts` - Registered hookless terminal tracking during activation

## Decisions Made
- `supportsHooks()` is a concrete method with default implementation (not abstract) - infers hook support from `getHookEvents().length > 0`, so ClaudeCodeAgent returns true and CodexAgent returns false without any changes to either subclass
- `agentName` field is optional in `AgentSessionData` to maintain backward compatibility with existing session files that lack the field
- Legacy session files without `agentName` default to `'claude'` in both `getSessionId()` and `getSessionAgentName()` - no migration or rewriting of existing files needed
- Hookless terminal status uses `active`/`idle` states only (not `working`/`waiting_for_user`) since terminal events cannot distinguish granular agent activity

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Session metadata infrastructure ready for Plan 02-03 (settings format abstraction)
- Hookless tracking infrastructure ready for Phase 3 (full Codex implementation with session ID capture)
- `supportsHooks()` provides the branching point for all hook-dependent vs hookless code paths

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 02-agent-abstraction-enhancement*
*Completed: 2026-02-10*
