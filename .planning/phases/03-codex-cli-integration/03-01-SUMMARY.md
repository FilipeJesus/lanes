---
phase: 03-codex-cli-integration
plan: 01
subsystem: codeAgents
tags: [codex, command-building, permissions, shell-escaping]
dependencies:
  requires: [02-01, 02-02]
  provides: [codex-command-generation, permission-modes]
  affects: [TerminalService]
tech_stack:
  added: []
  patterns: [dual-flag-permissions, shell-escaping, uuid-validation]
key_files:
  created: []
  modified: [src/codeAgents/CodexAgent.ts]
decisions:
  - Permission modes use dual-flag system (--sandbox + --ask-for-approval)
  - Codex ignores settingsPath/mcpConfigPath (no config file generation)
  - Resume command validates UUID format strictly (throws on invalid)
  - No local settings propagation in Phase 3 (future phase decision)
metrics:
  duration: 118s
  completed: 2026-02-10T13:07:26Z
---

# Phase 03 Plan 01: CodexAgent Command Building Summary

**One-liner:** Implemented CodexAgent command building with dual-flag permission system, shell escaping, and strict UUID validation for Codex CLI integration.

## Completed Tasks

| Task | Name | Commit | Files Modified |
|------|------|--------|----------------|
| 1 | Implement permission modes, command building, and shell escaping | 4eafecb | src/codeAgents/CodexAgent.ts |

## Implementation Details

### Command Building

Implemented full command building functionality for Codex CLI:

1. **buildStartCommand()** - Generates `codex [permission-flags] ['prompt']`
   - No --settings or --mcp-config flags (Codex doesn't support them)
   - Permission flags are combined dual-flag strings
   - Prompts are shell-escaped and wrapped in single quotes

2. **buildResumeCommand()** - Generates `codex resume <UUID>`
   - Validates UUID format before building command
   - Throws Error on invalid session ID (strict, no fallback)
   - Ignores settingsPath/mcpConfigPath from options

### Permission Modes

Replaced 3 stub modes with 2 production modes using dual-flag system:

- **acceptEdits**: `--sandbox workspace-write --ask-for-approval on-failure`
- **bypassPermissions**: `--sandbox danger-full-access --ask-for-approval never`

Each mode combines both `--sandbox` and `--ask-for-approval` flags in a single string for atomic application.

### Shell Escaping

Added `escapeForSingleQuotes()` helper that follows ClaudeCodeAgent pattern:
- Replaces `'` with `'\''` for safe shell command construction
- Ensures prompts with quotes/special characters work correctly

### UUID Validation

Added strict UUID validation matching ClaudeCodeAgent:
- Static `SESSION_ID_PATTERN` regex for consistency
- `validateSessionId()` throws Error on invalid format
- `parseSessionData()` returns null for non-UUID session IDs

### Local Settings

Updated `getLocalSettingsFiles()` to return empty array with comment explaining no propagation in this phase (deferred to future phase per user decision).

## Verification Results

- TypeScript compilation: PASSED
- ESLint: PASSED (no warnings)
- Test suite: 643/644 passing (1 pre-existing failure in worktree detection, unrelated to changes)
- No regressions introduced

## Deviations from Plan

None - plan executed exactly as written.

## Next Phase Readiness

### Blockers

None.

### Prerequisites for Next Plan

Plan 03-02 (Terminal Integration) can proceed. All required command building methods are implemented and tested.

## Self-Check: PASSED

Verified created files exist:
```bash
FOUND: src/codeAgents/CodexAgent.ts
```

Verified commits exist:
```bash
FOUND: 4eafecb
```

All claimed functionality verified through compilation, linting, and test execution.
