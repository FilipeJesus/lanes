# Phase 5: Test Foundation - Research

**Researched:** 2026-02-08
**Domain:** VS Code extension testing, flaky test prevention, test organization
**Confidence:** HIGH

## Summary

Phase 5 focuses on stabilizing the test suite to pass consistently in CI without intermittent failures. The current test suite shows signs of flakiness: tests are skipped due to git worktree race conditions, file system operations use real `fs` calls that can fail in CI environments, and the monolithic `extension.test.ts` file (1874+ lines) indicates need for better organization.

**Primary recommendation:** Use `memfs` for in-memory file system mocking to eliminate file system race conditions, split the monolithic test file into focused modules by functionality, and apply Microsoft's VS Code testing best practices for flaky test prevention. No new test framework required - existing Mocha + @vscode/test-electron setup is the standard stack.

---

## Standard Stack

### Core (No Changes - Existing Stack)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Mocha | Current via @vscode/test-cli | Test framework | VS Code's official test framework |
| @vscode/test-electron | ^2.5.2 | VS Code extension testing | Official VS Code testing runtime |
| @types/mocha | ^10.0.10 | Type definitions | Required for TypeScript |
| Node.js | 18.x | Runtime | CI environment standard |

### Testing Utilities (To Add)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| memfs | ^3.x | In-memory file system mocking | Tests that read/write files |
| sinon | ^15.x (or latest) | Spies, stubs, mocks | Mocking git operations, VS Code APIs |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| memfs | mock-fs | mock-fs has compatibility issues with Node 20+, memfs is actively maintained |
| sinon | Manual stubs | Sinon provides cleaner API, built-in assertions, easier to read tests |
| Mocha | Jest | Jest would require full test rewrite, Mocha is VS Code's official choice |

**Installation:**
```bash
npm install --save-dev memfs sinon
npm install --save-dev @types/sinon  # For TypeScript
```

---

## Architecture Patterns

### Recommended Test File Organization

**Current State:**
```
src/test/
├── extension.test.ts       # 1874 lines - TOO LARGE
├── sanitization.test.ts
├── projectManager.test.ts
├── sessionForm.test.ts
├── brokenWorktree.test.ts
├── gitChanges.test.ts
├── localSettings.test.ts
├── codeAgent.test.ts
├── mcp.test.ts
├── workflow.test.ts
├── workflow-resume.test.ts
├── edgeCases.test.ts
├── session.test.ts
├── session-clear.test.ts
├── configuration.test.ts
├── previousSession.test.ts
├── asyncQueue.test.ts
├── branchValidation.test.ts
├── mergeBaseHandling.test.ts
├── errorHandling.test.ts
├── validation.test.ts
└── extension-hook-script.test.ts
```

**Target State (after split):**
```
src/test/
├── core/
│   ├── extension-activation.test.ts    # Extension lifecycle
│   ├── commands.test.ts                # Command registration
│   └── configuration.test.ts           # Settings management
├── session/
│   ├── session-creation.test.ts        # Session creation logic
│   ├── session-management.test.ts      # Listing, deletion
│   ├── session-form.test.ts            # Form UI (existing)
│   └── session-clear.test.ts           # Session clearing (existing)
├── git/
│   ├── git-operations.test.ts          # Git wrappers
│   ├── branch-validation.test.ts       # Branch name validation (existing)
│   ├── merge-base.test.ts              # Merge-base handling (existing)
│   └── git-changes.test.ts             # Diff viewing (existing)
├── worktree/
│   ├── worktree-creation.test.ts       # Worktree operations
│   ├── broken-worktree.test.ts         # Repair logic (existing)
│   └── local-settings.test.ts          # Settings propagation (existing)
├── workflow/
│   ├── workflow-state.test.ts          # State machine
│   ├── workflow-resume.test.ts         # Resume logic (existing)
│   ├── code-agent.test.ts              # Code agents (existing)
│   └── mcp.test.ts                     # MCP integration (existing)
├── validation/
│   ├── sanitization.test.ts            # Name sanitization (existing)
│   ├── validation.test.ts              # Centralized validation (existing)
│   └── edge-cases.test.ts              # Edge case scenarios (existing)
├── errorHandling/
│   └── errorHandling.test.ts           # Error types (existing)
└── integration/
    ├── asyncQueue.test.ts              # Queue behavior (existing)
    └── previousSession.test.ts         # Recent sessions (existing)
```

### Pattern 1: File System Mocking with memfs

**What:** Use `memfs` to create an in-memory file system for tests, eliminating race conditions from real file I/O.

**When to use:** For all tests that read or write files, especially tests that create temp directories.

**Example:**
```typescript
// Source: memfs documentation + VS Code testing patterns
import { fs, vol } from 'memfs';
import * as vscode from 'vscode';

suite('File System Operations with memfs', () => {
    setup(() => {
        // Reset the virtual filesystem before each test
        vol.reset();
        // Create a mock vscode.workspace.fs API backed by memfs
        // This requires injecting the mock or using a wrapper
    });

    teardown(() => {
        vol.reset();
    });

    test('should create session file in global storage', async () => {
        // Arrange: Create virtual directories
        const globalStoragePath = '/vscode-global-storage';
        const repoIdentifier = 'test-repo';
        const sessionName = 'test-session';

        fs.mkdirSync(`${globalStoragePath}/${repoIdentifier}/${sessionName}`, { recursive: true });

        // Act: Call function that creates session file
        await createSessionSettings(sessionName, globalStoragePath, repoIdentifier);

        // Assert: Verify file was created (in memory, no real I/O)
        const settingsPath = `${globalStoragePath}/${repoIdentifier}/${sessionName}/claude-settings.json`;
        assert.ok(fs.existsSync(settingsPath));
        const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        assert.ok(content.hooks);
    });
});
```

### Pattern 2: Git Operation Mocking with Sinon

**What:** Stub git operations to avoid real git calls in tests, which can be slow and flaky.

**When to use:** For all tests that call `execGit()` or other git service functions.

**Example:**
```typescript
// Source: Sinon.js documentation
import sinon from 'sinon';
import * as gitService from '../gitService';

suite('Git Operations with Sinon', () => {
    let execGitStub: sinon.SinonStub;

    setup(() => {
        execGitStub = sinon.stub(gitService, 'execGit');
    });

    teardown(() => {
        execGitStub.restore();
    });

    test('should handle merge-base failure gracefully', async () => {
        // Arrange: Mock git failures
        execGitStub
            .withArgs(['merge-base', sinon.match.any])
            .rejects(new Error('fatal: not a valid commit'));

        // Act: Call function that uses merge-base
        const result = await getDiffContent('/worktree', 'origin/main');

        // Assert: Verify fallback behavior
        assert.ok(execGitStub.calledWith(['diff', 'origin/main...HEAD']));
    });

    test('should retry on fetch failure', async () => {
        // Arrange: Mock fetch then success
        execGitStub
            .onCall(0).rejects(new Error('connection timeout'))
            .onCall(1).resolves('abc123');

        // Act
        const result = await fetchWithRetry('/worktree', 'origin/main');

        // Assert
        assert.strictEqual(execGitStub.callCount, 2);
        assert.strictEqual(result, 'abc123');
    });
});
```

### Pattern 3: Test Isolation for Parallel Execution

**What:** Ensure each test uses unique identifiers to prevent interference when tests run in parallel.

**When to use:** For all tests that create temp files, directories, or git resources.

**Example:**
```typescript
// Source: VS Code testing best practices
suite('Parallel-Safe Tests', () => {
    test('should not interfere with other tests', async () => {
        // Use random/cryptographic identifier for temp resources
        const testId = crypto.randomUUID();
        const tempDir = `/tmp/test-${testId}`;
        const sessionName = `session-${testId}`;

        // ... test logic ...

        // Cleanup with unique path
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
});
```

### Anti-Patterns to Avoid

- **Real file system in tests:** Don't use `fs.mkdtempSync()` with real paths. Use memfs instead.
- **Real git operations:** Don't call actual `git worktree` in tests. Mock `execGit` responses.
- **Shared state:** Don't use shared variables between tests. Use setup/teardown for isolation.
- **Long timeouts:** Don't use `setTimeout` to wait for async operations. Use proper await or Sinon fake timers.
- **Skipping tests instead of fixing:** Don't use `test.skip()` permanently. Fix the underlying flakiness.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File system mocking | Custom fs wrapper with in-memory Map | memfs | memfs implements full Node fs API, handles edge cases (permissions, streams, etc.) |
| Git operation stubs | Manual function replacement | sinon.stub() | Sinon provides call counting, argument matching, and restoration |
| Test file splitting | Manual copy-paste | Move related tests together | Clearer organization, easier to find tests by functionality |
| Fake timers | Manual Date.now() mocking | sinon.useFakeTimers() | Proper async/scheduler handling, automatic cleanup |

**Key insight:** The existing test framework (Mocha + @vscode/test-electron) is VS Code's official stack. The issues are with file system and git operation mocking, not the test runner itself.

---

## Common Pitfalls

### Pitfall 1: Race Conditions from Real File System

**What goes wrong:** Tests use `fs.mkdtempSync()` to create temp directories, but parallel tests can interfere with each other or fail on CI with permission errors.

**Why it happens:** Real file system operations are non-deterministic in CI environments (different OS, different timing, concurrent execution).

**How to avoid:** Use `memfs` for all file operations. This makes tests deterministic and fast.

**Warning signs:** Tests that fail intermittently in CI but pass locally, tests that use `fs.mkdtempSync()`, tests with `setTimeout` for file operations.

### Pitfall 2: Real Git Worktree Operations in Tests

**What goes wrong:** Tests create actual git worktrees, which are slow and can fail with `.git/index: index file open failed: Not a directory`.

**Why it happens:** Git worktree operations have complex file system dependencies and can race with other git operations.

**How to avoid:** Mock `execGit` to return expected results without actually running git commands.

**Warning signs:** Tests with `test.skip()` comments mentioning "flaky", tests that call real git commands, tests with long execution times.

### Pitfall 3: Monolithic Test Files

**What goes wrong:** `extension.test.ts` has 1874+ lines, making it hard to find tests and understand what's being tested.

**Why it happens:** Tests are added organically without reorganization.

**How to avoid:** Split tests by functionality (see organization pattern above).

**Warning signs:** Files over 500 lines, test suites with 20+ tests, unclear test groupings.

### Pitfall 4: Improper Async/Await Handling

**What goes wrong:** Tests return promises but don't await them, leading to false positives or false negatives.

**Why it happens:** Mocha supports both promises and callbacks, mixing them can cause issues.

**How to avoid:** Always use `async/await` for test functions. Never mix promises with callbacks.

**Warning signs:** Tests with `done` parameter alongside `async`, tests without explicit `await`, tests that finish "too quickly".

### Pitfall 5: Configuration Pollution

**What goes wrong:** Tests modify VS Code configuration but don't clean up, affecting subsequent tests.

**Why it happens:** `vscode.workspace.getConfiguration().update()` is called without proper teardown.

**How to avoid:** Always reset configuration in `teardown()` using `undefined` value.

**Warning signs:** Tests that pass in isolation but fail when run with other tests, tests that depend on execution order.

---

## Code Examples

### Current State: Flaky Test with Real File System

```typescript
// Current: Uses real file system - causes flakiness
suite('Broken Worktree Repair', () => {
    let tempDir: string;
    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-repair-test-'));
        // Real git operations - slow and flaky
        await execGit(['init'], tempDir);
        await execGit(['config', 'user.email', 'test@test.com'], tempDir);
        await execGit(['commit', '-m', 'Initial'], tempDir);
    });

    // TODO: This test is flaky in VS Code test environment
    test.skip('should successfully repair a broken worktree', async function() {
        // Real git worktree operations - race conditions!
        await execGit(['worktree', 'add', worktreePath, sessionName], tempDir);
        // ...
    });
});
```

### Target State: Mocked File System + Git

```typescript
// Target: Uses memfs + sinon - deterministic and fast
suite('Broken Worktree Repair', () => {
    let execGitStub: sinon.SinonStub;

    setup(() => {
        // Reset virtual filesystem
        vol.reset();
        // Create test directory structure in memory
        fs.mkdirSync('/test-repo/.git/worktrees', { recursive: true });
        // Stub git operations
        execGitStub = sinon.stub(gitService, 'execGit');
    });

    teardown(() => {
        vol.reset();
        execGitStub.restore();
    });

    test('should successfully repair a broken worktree', async () => {
        // Arrange: Mock git worktree operations
        execGitStub
            .withArgs(['worktree', 'add'])
            .resolves('/worktree/path');
        execGitStub
            .withArgs(['worktree', 'prune'])
            .resolves('');

        // Act: Call repair function
        const result = await repairWorktree('/test-repo', brokenWorktreeInfo);

        // Assert: Verify correct git operations were called
        assert.ok(result.success);
        assert.ok(execGitStub.calledWith(['worktree', 'prune']));
    });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Real file system in tests | memfs virtual filesystem | Phase 5 | Eliminates race conditions, faster tests |
| Real git operations | Sinon-stubbed git calls | Phase 5 | Deterministic tests, no git dependencies |
| Monolithic test files | Organized by functionality | Phase 5 | Easier to find tests, clearer responsibility |
| test.skip for flaky tests | Proper mocking, no skips | Phase 5 | All tests pass reliably |

**Deprecated/outdated:**
- Real file system operations in tests (`fs.mkdtempSync`, real temp directories)
- Real git worktree operations in tests
- Permanent `test.skip()` for flaky tests
- Test files over 500 lines

---

## Current Codebase Analysis

### Flaky Tests Identified

| Test File | Issue | Root Cause | Fix Approach |
|-----------|-------|------------|--------------|
| `brokenWorktree.test.ts:254` | Skipped with TODO comment | Real git worktree operations, `.git/index` error | Mock execGit, use memfs |
| `gitChanges.test.ts:80` | Skipped - git traverses parents | Real git repo detection logic | Mock getBaseRepoPath |
| `gitChanges.test.ts:225` | Skipped - git parent directory | Same as above | Mock getBaseRepoPath |
| `gitChanges.test.ts:1155` | Skipped - non-git directory | Same as above | Mock getBaseRepoPath |
| `brokenWorktree.test.ts:350` | Skipped with TODO | Real git worktree operations | Mock execGit, use memfs |

### Files Requiring Split

| File | Lines | Target Splits |
|------|-------|---------------|
| `extension.test.ts` | 1874 | core/, session/, git/ subdirectories |
| `gitChanges.test.ts` | 1754 | Already focused, but large - could split further |
| `workflow.test.ts` | (estimated large) | Split into workflow/ subdirectory modules |

### Functions Requiring Mocking

Based on analysis of test failures:

- `execGit()` - All git operations should be stubbed
- `fs.mkdtempSync()` - Use memfs vol.fromJSON() instead
- `fs.readdirSync()` / `fs.readFileSync()` - Use memfs
- `getBaseRepoPath()` - Mock to return fixed paths
- `branchExists()` - Mock via execGit stub

---

## Open Questions

1. **Migration strategy:** Should we migrate tests incrementally or all at once?
   - **Recommendation:** Incremental. Fix flaky tests first (brokenWorktree, gitChanges), then split files, then migrate remaining tests to memfs.

2. **memfs integration:** Should we replace all fs calls or only in affected tests?
   - **Recommendation:** Start with tests that show flakiness (brokenWorktree, gitChanges). Expand to other tests incrementally.

3. **Test execution time:** Will mocking slow down test development?
   - **Recommendation:** No benefit. Mocked tests run faster than real git operations. Setup is straightforward.

4. **CI-specific tests:** Should we keep some real integration tests?
   - **Recommendation:** Keep a small subset of integration tests (max 5) that use real git to verify end-to-end functionality. Tag them as `@integration` and run separately if needed.

---

## Sources

### Primary (HIGH confidence)

- [Testing Extensions - Official VS Code API](https://code.visualstudio.com/api/working-with-extensions/testing-extension) - Official VS Code extension testing guide
- [Dealing with Test Flakiness - Microsoft VSCode Wiki](https://github.com/microsoft/vscode/wiki/Dealing-with-Test-Flakiness) - Official guidance on handling flaky tests
- [Testing API - Visual Studio Code Extension API](https://code.visualstudio.com/api/extension-guides/testing) - VS Code testing API documentation
- [memfs npm package](https://www.npmjs.com/package/memfs) - In-memory file system for Node.js
- [Sinon.js - Official Documentation](https://sinonjs.org/) - Test doubles (spies, stubs, mocks) for JavaScript

### Secondary (MEDIUM confidence)

- [Flaky Tests: Causes, Examples, and Best Practices](https://dev.to/agileactors/flaky-tests-causes-examples-and-best-practices-2fml) - General flaky test patterns
- [Testing filesystem in Node.js: The easy way](https://medium.com/nerd-for-tech/testing-in-node-js-easy-way-to-mock-filesystem-883b9f822ea4) - File system mocking approaches
- [8 Effective Strategies for Handling Flaky Tests - Codecov](https://about.codecov.io/blog/effective-strategies-for-handling-flaky-tests/) - Flaky test handling strategies
- [use workspace.fs and fake-fs for extension tests #78189](https://github.com/microsoft/vscode/issues/78189) - GitHub issue on VS Code file system mocking

### Tertiary (LOW confidence)

- [How to unit test vscode extensions with basic mocks](https://www.luker.dev/blog/unit-testing-vscode-extensions/) - Community guide (2022)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - VS Code's official testing stack, no changes needed
- Architecture: HIGH - memfs and sinon are industry standards, well-documented
- Pitfalls: HIGH - Direct analysis of existing flaky tests in codebase
- Test organization: HIGH - Standard patterns for organizing tests by module

**Research date:** 2026-02-08
**Valid until:** 2026-05-08 (90 days - testing libraries and patterns are stable)

---

*Next step: Create PLAN.md with detailed task breakdown based on this research.*
