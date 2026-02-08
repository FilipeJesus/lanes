# Lanes Stabilization

## What This Is

A comprehensive stabilization effort for Lanes, a VS Code extension that manages isolated Claude Code sessions using Git worktrees. The extension provides session lifecycle management, workflow execution with state machines, and MCP server integration.

This project addresses technical debt, improves reliability, and hardens security — all while maintaining backwards compatibility for existing users.

## Core Value

Users can reliably create and manage isolated Claude Code sessions without data loss, security vulnerabilities, or unexpected failures.

## Requirements

### Validated

*Capabilities that already exist and must continue working:*

- ✓ Session creation and management via Git worktrees
- ✓ Tree view providers for sessions, previous sessions, and workflows
- ✓ Session form provider for creating new sessions
- ✓ Git changes panel for reviewing worktree diffs
- ✓ Workflow state machine with persistence
- ✓ MCP server integration for external communication
- ✓ Code agent layer for Claude Code execution
- ✓ Git service for worktree operations
- ✓ Local settings propagation to worktrees

### Active

*Current scope — stabilization and hardening:*

**Reliability:**
- [ ] Fix file system race conditions in session creation
- [ ] Fix Git branch detection instability for non-standard branch names
- [ ] Improve error handling (reduce excessive null returns)
- [ ] Stabilize flaky test environment

**Security:**
- [ ] Harden path traversal protection in session names
- [ ] Add strict schema validation for configuration values
- [ ] Review and audit all user input handling

**Maintainability:**
- [ ] Refactor large `extension.ts` file (2917 lines → smaller modules)
- [ ] Standardize async file I/O throughout
- [ ] Split large test files into focused modules
- [ ] Create abstraction layer for MCP integration
- [ ] Extract worktree service with clear interface

### Out of Scope

- New features or functionality additions
- Changes to public APIs or user-facing commands
- Workflow system redesign
- UI/UX changes
- Database-backed session tracking (scaling beyond filesystem)

## Context

**Existing Codebase:**
- TypeScript 5.9, VS Code Extension API, Node.js 18+
- MCP SDK 1.25.2 for workflow tool integration
- esbuild for bundling, Mocha for testing

**Known Issues from Codebase Mapping:**
- `extension.ts` is 2917 lines (single responsibility violation)
- 40+ `return null` instances indicate poor error handling
- Mixed sync/async file I/O causes blocking
- Path traversal vulnerabilities in session name handling
- Git branch detection fails with non-standard branch names
- Flaky tests due to VS Code test environment instability
- MCP integration is fragile (file-based IPC, external SDK dependency)

**Technical Debt:**
- Large files are difficult to test and maintain
- Inconsistent error handling leads to runtime errors
- Synchronous operations block the UI thread
- Limited test coverage for error paths

## Constraints

- **Backwards Compatibility:** All changes must maintain compatibility for existing users — no breaking changes to public APIs, commands, or configuration
- **Quality over Speed:** Take time needed to do each fix properly
- **Triage Approach:** Not all concerns need to be addressed — prioritize based on impact and effort as we go

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Parallel across categories | Address security, reliability, and maintainability together rather than sequentially | — Pending |
| No breaking changes | Users depend on existing behavior | — Pending |
| Standardize on async I/O | Synchronous operations cause blocking and poor UX | — Pending |
| Extract large modules | 2917-line extension.ts violates single responsibility principle | — Pending |

---
*Last updated: 2026-02-08 after initialization*
