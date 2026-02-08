# Roadmap: Lanes Stabilization

## Overview

Lanes stabilization progresses through five focus areas: critical bugs, error handling, security hardening, testing reliability, and maintainability improvements. Each phase delivers verifiable improvements to reliability, security, or code quality while maintaining backwards compatibility for existing users.

The journey begins by eliminating known race conditions and Git instability, then establishes proper error handling throughout the codebase. Security hardening follows with input validation and audits, after which testing improvements stabilize the flaky test environment. The stabilization concludes with major refactoring to improve long-term maintainability.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Critical Bug Fixes** - Eliminate race conditions and Git instability
- [ ] **Phase 2: Error Handling** - Replace null returns with proper error types
- [x] **Phase 3: Input Validation** - Harden security through strict input validation **COMPLETED 2026-02-08**
- [ ] **Phase 4: Security Auditing** - Audit file system and command execution security
- [ ] **Phase 5: Test Foundation** - Stabilize flaky tests and split test files
- [x] **Phase 6: Integration Testing** - Add error path and MCP integration tests **COMPLETED 2026-02-08**
- [x] **Phase 7: Module Extraction** - Split extension.ts and extract worktree service **COMPLETED 2026-02-08**
- [ ] **Phase 8: Code Quality** - Standardize async I/O and create MCP abstraction

## Phase Details

### Phase 1: Critical Bug Fixes

**Goal**: Users can create sessions reliably without race conditions or Git errors

**Depends on**: Nothing (first phase)

**Requirements**: REL-01, REL-02

**Success Criteria** (what must be TRUE):
1. User can create sessions rapidly without worktree initialization failures
2. User can view Git changes for branches with non-standard names (e.g., feature/., feature/*)
3. No "Cannot get merge-base" errors when showing changes from remote branches

**Plans**: 1
- [ ] 01-01-PLAN.md — Async queue, branch validation, and merge-base improvements

### Phase 2: Error Handling

**Goal**: Users receive clear, actionable error messages instead of silent failures

**Depends on**: Phase 1

**Requirements**: REL-04, REL-06, TEST-01

**Success Criteria** (what must be TRUE):
1. User sees descriptive error messages when operations fail (not generic errors)
2. All critical functions have tests covering error paths
3. Error types are consistent across the codebase (no mixed null/throw patterns)

**Plans**: 1
- [x] 02-01-PLAN.md — Custom error types (LanesError hierarchy) and error path tests **COMPLETED 2026-02-08**

### Phase 3: Input Validation

**Goal**: User inputs are validated before use, preventing security vulnerabilities

**Depends on**: Phase 2

**Requirements**: SEC-01, SEC-02, SEC-03

**Success Criteria** (what must be TRUE):
1. User cannot create sessions with malicious names (e.g., ../../etc/passwd)
2. Invalid configuration values are rejected with clear error messages
3. All user-facing inputs pass through validation before use

**Plans**: 1
- [x] 03-01-PLAN.md — Centralized validation module and security test coverage **COMPLETED 2026-02-08**

### Phase 4: Security Auditing

**Goal**: File system and command execution operations are secure against exploitation

**Depends on**: Phase 3

**Requirements**: SEC-04, SEC-05

**Success Criteria** (what must be TRUE):
1. All file system operations use safe path handling
2. External command execution uses proper argument escaping
3. Security audit report documents all reviewed operations

**Plans**: 1
- [ ] 04-01-PLAN.md — Security audit of file system and command execution operations

### Phase 5: Test Foundation

**Goal**: Tests pass reliably in CI without flakiness

**Depends on**: Phase 4

**Requirements**: REL-03, MAINT-05, TEST-03

**Success Criteria** (what must be TRUE):
1. Test suite passes consistently in CI environment (no intermittent failures)
2. Test files are organized by functionality (not monolithic files)
3. File system operations in tests use proper mocking to avoid race conditions

**Plans**: 4
- [ ] 05-01-PLAN.md — Install test utilities (memfs, sinon) and create testSetup.ts
- [ ] 05-02-PLAN.md — Fix flaky tests (brokenWorktree, gitChanges) with mocking
- [ ] 05-03-PLAN.md — Split large test files into organized modules
- [ ] 05-04-PLAN.md — Close gaps: split remaining large files (diff, settings, mcp, previousSession)

### Phase 6: Integration Testing

**Goal**: Error paths and MCP integration are thoroughly tested

**Depends on**: Phase 5

**Requirements**: REL-05, TEST-02

**Success Criteria** (what must be TRUE):
1. All error scenarios have documented test coverage
2. MCP workflow integration tests verify end-to-end functionality
3. Test suite can be run reproducibly in any environment

**Plans**: 3
- [x] 06-01-PLAN.md — Error path integration tests (GitError, ValidationError propagation) **COMPLETED 2026-02-08**
- [x] 06-02-PLAN.md — MCP workflow integration tests (state persistence, transitions) **COMPLETED 2026-02-08**
- [x] 06-03-PLAN.md — Git error recovery tests (fallback behaviors, retries) **COMPLETED 2026-02-08**

### Phase 7: Module Extraction

**Goal**: Extension code is organized in focused, maintainable modules

**Depends on**: Phase 6

**Requirements**: MAINT-01, MAINT-03

**Success Criteria** (what must be TRUE):
1. extension.ts is split into modules by functionality (session management, workflow, MCP)
2. Worktree operations are isolated behind a clear service interface
3. Each module has a single, well-defined responsibility

**Plans**: 5
- [x] 07-01-PLAN.md — Extract foundational services (BrokenWorktree, Settings, Diff) **COMPLETED 2026-02-08**
- [x] 07-02-PLAN.md — Extract Workflow and SessionProcess services **COMPLETED 2026-02-08**
- [x] 07-03-PLAN.md — Extract SessionService and TerminalService **COMPLETED 2026-02-08**
- [x] 07-04-PLAN.md — Extract command registration module **COMPLETED 2026-02-08**
- [x] 07-05-PLAN.md — Thin extension.ts entry point and file watchers **COMPLETED 2026-02-08**

### Phase 8: Code Quality

**Goal**: Code follows consistent patterns with standardized async I/O

**Depends on**: Phase 7

**Requirements**: MAINT-02, MAINT-04, MAINT-06

**Success Criteria** (what must be TRUE):
1. All file I/O operations use async/await consistently
2. MCP integration is isolated behind an abstraction layer
3. Code style follows established conventions (verified by linting)

**Plans**: 5
- [x] 08-01-PLAN.md — Create FileService and enhance ESLint **COMPLETED 2026-02-08**
- [x] 08-02-PLAN.md — Create MCP abstraction layer **COMPLETED 2026-02-08**
- [x] 08-03-PLAN.md — Migrate ClaudeSessionProvider and PreviousSessionProvider **COMPLETED 2026-02-08**
- [x] 08-04-PLAN.md — Migrate MCP tools, workflow state, and session commands **COMPLETED 2026-02-08**
- [ ] 08-05-PLAN.md — Complete final migration pass

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Critical Bug Fixes | 0/1 | Ready to execute | - |
| 2. Error Handling | 1/1 | ✓ Complete | 2026-02-08 |
| 3. Input Validation | 1/1 | ✓ Complete | 2026-02-08 |
| 4. Security Auditing | 0/1 | Ready to execute | - |
| 5. Test Foundation | 0/3 | Ready to execute | - |
| 6. Integration Testing | 3/3 | ✓ Complete | 2026-02-08 |
| 7. Module Extraction | 5/5 | ✓ Complete | 2026-02-08 |
| 8. Code Quality | 4/5 | In progress | - |
