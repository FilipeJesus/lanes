---
phase: 02-agent-abstraction-enhancement
plan: 01
subsystem: infra
tags: [factory-pattern, singleton, vscode-settings, codex, cli-validation]

# Dependency graph
requires:
  - phase: 01-foundation-refactoring
    provides: "CodeAgent abstract class, ClaudeCodeAgent implementation, agent-agnostic service container"
provides:
  - "Agent factory with hardcoded map and singleton caching (getAgent, getAvailableAgents, getDefaultAgent)"
  - "CodexAgent stub extending CodeAgent with minimal implementations"
  - "CLI availability validation using command -v (POSIX builtin)"
  - "lanes.defaultAgent VS Code setting with claude/codex enum"
  - "Factory-based agent creation in extension activation"
affects: [02-02, 02-03, 03-codex-implementation]

# Tech tracking
tech-stack:
  added: []
  patterns: ["factory with hardcoded map and singleton lifecycle", "CLI availability check via command -v"]

key-files:
  created:
    - "src/codeAgents/CodexAgent.ts"
    - "src/codeAgents/factory.ts"
  modified:
    - "src/codeAgents/index.ts"
    - "src/extension.ts"
    - "package.json"

key-decisions:
  - "Factory uses synchronous singleton caching via Map to avoid race conditions"
  - "CLI check uses command -v with /bin/sh shell and 5s timeout for cross-platform reliability"
  - "Factory returns null for unavailable CLI, extension falls back to Claude"
  - "CodexAgent uses blue terminal icon to visually differentiate from Claude's green"

patterns-established:
  - "Factory pattern: add new agent = one line in agentConstructors map + agent class"
  - "Singleton lifecycle: Map<string, CodeAgent> ensures same object reference on repeated calls"
  - "Fallback chain: validateAndGetAgent() -> getAgent('claude') -> throw Error"

# Metrics
duration: 3min
completed: 2026-02-10
---

# Phase 2 Plan 1: Agent Factory and CodexAgent Stub Summary

**Agent factory with hardcoded map, singleton caching, CLI validation via command -v, and CodexAgent stub implementing all CodeAgent abstract methods**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-10T11:32:13Z
- **Completed:** 2026-02-10T11:34:50Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created CodexAgent stub with all 17 abstract methods implemented (minimal valid returns for Phase 2 infrastructure)
- Created agent factory with hardcoded constructor map, singleton caching, and CLI availability validation
- Added `lanes.defaultAgent` VS Code setting with `claude`/`codex` enum options defaulting to `claude`
- Replaced direct `new ClaudeCodeAgent()` in extension activation with factory-based creation and CLI validation
- All 643 existing tests pass unchanged (backward compatibility maintained)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create CodexAgent stub and agent factory module** - `5cb6813` (feat)
2. **Task 2: Add lanes.defaultAgent setting and update extension activation** - `37e6c24` (feat)

## Files Created/Modified
- `src/codeAgents/CodexAgent.ts` - Stub CodexAgent with all abstract methods, blue terminal icon, no hooks/MCP
- `src/codeAgents/factory.ts` - Factory with getAgent, getAvailableAgents, getDefaultAgent, isCliAvailable, validateAndGetAgent
- `src/codeAgents/index.ts` - Added exports for CodexAgent and all factory functions
- `src/extension.ts` - Replaced ClaudeCodeAgent import/instantiation with factory-based creation
- `package.json` - Added lanes.defaultAgent setting in Lanes: General configuration section

## Decisions Made
- Factory uses synchronous Map-based singleton caching (no async initialization needed since constructors are synchronous)
- CLI availability check uses `command -v` with explicit `/bin/sh` shell and 5-second timeout for POSIX compliance
- When selected agent's CLI is not available, extension falls back to Claude rather than failing activation
- CodexAgent status states limited to `['active', 'idle']` since hookless agents cannot report granular status

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Factory infrastructure is ready for Plan 02-02 (session metadata persistence) and Plan 02-03 (settings format abstraction)
- CodexAgent stub is ready for Phase 3 full implementation (command building, session ID capture, terminal tracking)
- Extension activation cleanly handles both available and unavailable agent CLIs

## Self-Check: PASSED

All files verified present. All commits verified in git log.

---
*Phase: 02-agent-abstraction-enhancement*
*Completed: 2026-02-10*
