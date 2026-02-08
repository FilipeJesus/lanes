# Phase 1: Critical Bug Fixes - Context

**Gathered:** 2026-02-08
**Status:** Ready for planning

## Phase Boundary

Eliminate race conditions in session creation and fix Git instability when viewing changes for branches with non-standard names (e.g., `feature/.`, `feature/*`) and remote branches that fail merge-base computation.

## Implementation Decisions

### Race condition approach
- **Queue pending requests** - Multiple rapid session creations are queued and processed sequentially
- **Silent queue** - Only show the current operation, no queue status display to the user
- **Fail with error** - If a worktree for the same branch already exists, fail fast with a clear error message
- **30 second timeout** - Single worktree initialization has 30 second timeout before failing

### Branch name handling
- **Pre-flight validation** - Check branch name when user initiates session creation, before invoking Git
- **Block Git-invalid chars** - Reject branches with characters that break Git: `~^:.\`, null bytes, leading/trailing dots, `..`, `@{` sequences
- **Explain the problem** - Error message format: "Branch 'feature/.' contains invalid characters. Worktrees cannot be created from this branch."

### Merge-base errors
- **Claude's Discretion** - User chose "you decide" for the fallback approach when merge-base fails
- **Show warning** - User should see a warning notification when merge-base fails and fallback is used: "Using fallback diff method - merge-base unavailable"
- **Auto-fetch** - For remote branches, fetch from remote before computing merge-base

### Testing strategy
- **Mocked git operations** - Test race condition fixes using mocked/spied git commands for deterministic, fast tests
- **Fuzz testing** - Use property-based testing with random strings for branch name validation
- **Reproduce reported issues** - Add regression tests for the exact bugs reported: `feature/.` branch, remote merge-base, rapid creation

## Specific Ideas

- Race condition queue should be silent - don't overwhelm user with queue status
- Pre-flight validation gives faster feedback than letting Git fail
- Explain exactly what's wrong in error messages (show the problematic branch name)
- Auto-fetch for remote branches ensures merge-base has the best chance to succeed

## Deferred Ideas

None — discussion stayed within phase scope.

---

*Phase: 01-critical-bug-fixes*
*Context gathered: 2026-02-08*
