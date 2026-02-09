# Phase 6: Integration Testing - Research

**Researched:** 2026-02-08
**Domain:** VS Code extension integration testing, error path testing, MCP workflow testing
**Confidence:** HIGH

## Summary

Phase 6 focuses on integration testing for two critical areas: error paths and MCP (Model Context Protocol) workflow integration. The existing test infrastructure from Phase 5 (memfs, sinon, Mocha) provides a solid foundation, but integration tests are needed to verify end-to-end error handling and workflow state management. The codebase has a well-defined error hierarchy with discriminated unions, but error paths throughout the codebase lack comprehensive test coverage. MCP workflow integration uses persistent state files but lacks integration tests for multi-tool workflows.

**Primary recommendation:** Build on Phase 5 test infrastructure to create integration tests that verify error propagation across module boundaries and MCP workflow state persistence. No new testing framework required - existing Mocha + memfs + sinon stack is sufficient. Focus on testing error paths at integration boundaries (git service error -> extension handling -> user notification) and MCP workflow state machine transitions.

---

## Standard Stack

### Core (No Changes - Existing Stack from Phase 5)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Mocha | Current via @vscode/test-cli | Test framework | VS Code's official test framework |
| @vscode/test-electron | ^2.5.2 | VS Code extension testing | Official VS Code testing runtime |
| memfs | ^4.56.10 | In-memory file system mocking | Eliminates file system race conditions |
| sinon | ^21.0.1 | Spies, stubs, mocks | Mocking git operations and external dependencies |

### Integration Testing Additions (Minimal)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (None) | - | - | Existing stack sufficient for integration testing |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sinon + manual test assembly | Supertest | Supertest is for HTTP APIs, not VS Code extensions |
| Manual integration tests | Playwright | Playwright is for browser/UI automation, overkill for extension logic |
| memfs | Real temp directories | Real directories cause flakiness in CI, memfs is deterministic |

**Installation:** No new packages needed. All dependencies from Phase 5 are sufficient.

---

## Architecture Patterns

### Integration Test Organization

**Current State (from Phase 5):**
```
src/test/
├── core/          # Extension lifecycle tests
├── session/       # Session management tests
├── git/           # Git operation tests
├── workflow/      # Workflow state tests
├── config/        # Configuration tests
└── validation/    # Validation tests
```

**Target State (Phase 6 additions):**
```
src/test/
├── integration/   # NEW: Integration tests
│   ├── error-paths.test.ts        # Error propagation across modules
│   ├── mcp-workflow.test.ts       # MCP workflow end-to-end
│   ├── git-error-recovery.test.ts # Git failure scenarios
│   └── state-persistence.test.ts  # Workflow state file operations
├── core/          # (existing - unit tests)
├── session/       # (existing - unit tests)
├── git/           # (existing - unit tests)
├── workflow/      # (existing - unit tests)
├── config/        # (existing - unit tests)
└── validation/    # (existing - unit tests)
```

### Pattern 1: Error Path Integration Testing

**What:** Test error propagation from source (git operation, validation) through the extension layer to user notification.

**When to use:** For all error scenarios defined in the error hierarchy (GitError, ValidationError, LanesError).

**Example:**
```typescript
// Source: Integration testing pattern for error paths
import sinon from 'sinon';
import { vol } from 'memfs';
import * as gitService from '../../gitService';
import * as extension from '../../extension';
import { GitError, ValidationError } from '../../errors';

suite('Error Path Integration: Git Operations', () => {
    let execGitStub: sinon.SinonStub;

    setup(() => {
        vol.reset();
        // Create virtual repository structure
        vol.fromJSON({
            '/test-repo/.git/config': '[core]\nrepositoryformatversion = 0',
            '/test-repo/.git/HEAD': 'ref: refs/heads/main',
        });
        // Stub git operations
        execGitStub = sinon.stub(gitService, 'execGit');
    });

    teardown(() => {
        execGitStub.restore();
        vol.reset();
    });

    test('should propagate GitError from worktree creation to user notification', async () => {
        // Arrange: Mock git worktree failure
        execGitStub
            .withArgs(['worktree', 'add', sinon.match.string, 'feature/test'])
            .rejects(new Error('fatal: Invalid branch name'));

        // Act: Attempt to create session via extension command
        const result = await extension.createSession('test-session', 'feature/test', '/test-repo');

        // Assert: Verify error propagation chain
        assert.strictEqual(result.success, false, 'operation should fail');
        assert.ok(result.error instanceof GitError, 'should be GitError instance');
        assert.strictEqual(result.error.kind, 'git', 'error kind should be git');
        assert.ok(result.error.userMessage.includes('branch name'), 'user message should be actionable');
        assert.deepStrictEqual(result.error.command, ['worktree', 'add', sinon.match.string, 'feature/test']);
    });

    test('should handle ValidationError with user-friendly message', async () => {
        // Arrange: Invalid session name with path traversal
        const invalidName = '../../../etc/passwd';

        // Act: Attempt to create session with invalid name
        const result = await extension.createSession(invalidName, 'feature', '/test-repo');

        // Assert: Validation prevents git operations
        assert.strictEqual(result.success, false);
        assert.ok(result.error instanceof ValidationError);
        assert.strictEqual(result.error.field, 'sessionName');
        assert.ok(result.error.userMessage.includes('path traversal'), 'should explain validation failure');
        assert.ok(!execGitStub.called, 'git operations should not execute');
    });
});
```

### Pattern 2: MCP Workflow State Integration Testing

**What:** Test MCP workflow state machine transitions with persistent state file operations.

**When to use:** For all MCP tool handlers (workflow_start, workflow_advance, workflow_set_tasks, etc.).

**Example:**
```typescript
// Source: MCP workflow integration testing pattern
import { vol } from 'memfs';
import * as path from 'path';
import { workflowStart, workflowAdvance, saveState, loadState } from '../../mcp/tools';
import { WorkflowStateMachine } from '../../workflow/state';

suite('MCP Workflow Integration: State Persistence', () => {
    const worktreePath = '/test-worktree';

    setup(() => {
        vol.reset();
        // Create virtual worktree structure
        vol.fromJSON({
            [path.join(worktreePath, '.git')]: '',
        });
    });

    teardown(() => {
        vol.reset();
    });

    test('should persist workflow state across tool calls', async () => {
        // Arrange: Start a workflow
        const startResult = await workflowStart(worktreePath, {
            name: 'test-workflow',
            description: 'Test',
            steps: [
                { id: 'step1', agent: 'coder', description: 'First step' },
                { id: 'step2', agent: 'test-engineer', description: 'Second step' }
            ]
        });

        assert.ok(startResult.success);

        // Act: Load state (simulates server restart or new tool call)
        const loadedState = await loadState(worktreePath);

        // Assert: State was persisted correctly
        assert.ok(loadedState);
        assert.strictEqual(loadedState.workflowId, 'test-workflow');
        assert.strictEqual(loadedState.step, 'step1');
        assert.strictEqual(loadedState.status, 'in-progress');
        assert.strictEqual(loadedState.outputs.size, 0);
    });

    test('should advance workflow state and persist results', async () => {
        // Arrange: Start workflow
        await workflowStart(worktreePath, {
            name: 'test-workflow',
            steps: [
                { id: 'step1', agent: 'coder', description: 'First step' },
                { id: 'step2', agent: 'test-engineer', description: 'Second step' }
            ]
        });

        // Act: Advance workflow with output
        const advanceResult = await workflowAdvance(worktreePath, {
            output: 'Step 1 completed',
            artifacts: ['file1.ts', 'file2.ts']
        });

        assert.ok(advanceResult.success);

        // Assert: State updated and persisted
        const loadedState = await loadState(worktreePath);
        assert.strictEqual(loadedState.step, 'step2');
        assert.strictEqual(loadedState.outputs.get('step1'), 'Step 1 completed');
        assert.deepStrictEqual(loadedState.artifacts, ['file1.ts', 'file2.ts']);
    });

    test('should handle concurrent state updates with atomic writes', async () => {
        // Arrange: Start workflow
        await workflowStart(worktreePath, {
            name: 'concurrent-test',
            steps: [{ id: 'step1', agent: 'coder', description: 'Test' }]
        });

        // Act: Simulate concurrent updates
        const statePath = path.join(worktreePath, 'workflow-state.json');
        const promises = [
            saveState(worktreePath, { step: 'step1', status: 'updating', outputs: new Map() }),
            saveState(worktreePath, { step: 'step1', status: 'updating', outputs: new Map() })
        ];

        // Assert: Atomic rename prevents corruption
        await Promise.all(promises);
        const content = vol.readFileSync(statePath, 'utf8');
        const parsed = JSON.parse(content);
        assert.ok(parsed.status === 'updating', 'state should be valid JSON, not corrupted');
    });
});
```

### Pattern 3: Git Error Recovery Integration Testing

**What:** Test how the extension handles and recovers from various git operation failures.

**When to use:** For all git operations that can fail (worktree add, fetch, merge-base, status).

**Example:**
```typescript
// Source: Git error recovery integration pattern
import sinon from 'sinon';
import { vol } from 'memfs';
import * as gitService from '../../gitService';
import { GitError } from '../../errors';

suite('Git Error Recovery Integration', () => {
    let execGitStub: sinon.SinonStub;

    setup(() => {
        vol.reset();
        vol.fromJSON({
            '/test-repo/.git/config': '[core]\nrepositoryformatversion = 0',
        });
        execGitStub = sinon.stub(gitService, 'execGit');
    });

    teardown(() => {
        execGitStub.restore();
        vol.reset();
    });

    test('should fall back to alternative branch detection on merge-base failure', async () => {
        // Arrange: merge-base fails, but diff succeeds
        execGitStub
            .withArgs(['merge-base', 'HEAD', 'origin/main'])
            .rejects(new Error('fatal: not a valid commit'));
        execGitStub
            .withArgs(['diff', 'origin/main...HEAD'])
            .resolves({ stdout: 'diff content', stderr: '', exitCode: 0 });

        // Act: Get diff content
        const result = await getDiffContent('/test-repo', 'origin/main');

        // Assert: Fallback behavior works
        assert.ok(result.includes('diff content'), 'should return diff from fallback');
        assert.ok(execGitStub.calledWith(['diff', 'origin/main...HEAD']), 'should use fallback command');
    });

    test('should handle network timeout on fetch with retry', async () => {
        // Arrange: Fetch fails twice, then succeeds
        execGitStub
            .withArgs(['fetch', 'origin'])
            .onCall(0).rejects(new Error('connection timeout'))
            .onCall(1).rejects(new Error('connection timeout'))
            .onCall(2).resolves({ stdout: '', stderr: '', exitCode: 0 });

        // Act: Fetch with retry
        await fetchWithRetry('/test-repo', 'origin', { maxRetries: 3 });

        // Assert: Retry logic worked
        assert.strictEqual(execGitStub.callCount, 3, 'should retry 3 times');
    });

    test('should prune broken worktree and recreate on git error', async () => {
        // Arrange: Worktree add fails due to existing broken worktree
        execGitStub
            .withArgs(['worktree', 'add', sinon.match.string, 'test-branch'])
            .onFirstCall()
            .rejects(new Error('fatal: not a valid object name: test-branch'));
        execGitStub
            .withArgs(['worktree', 'prune'])
            .resolves({ stdout: '', stderr: '', exitCode: 0 });
        execGitStub
            .withArgs(['worktree', 'add', sinon.match.string, 'test-branch'])
            .onSecondCall()
            .resolves({ stdout: '/worktree/path', stderr: '', exitCode: 0 });

        // Act: Create session with error recovery
        const result = await createSessionWithRetry('test-session', 'test-branch', '/test-repo');

        // Assert: Recovery flow executed
        assert.ok(result.success, 'should succeed after retry');
        assert.ok(execGitStub.calledWith(['worktree', 'prune']), 'should prune before retry');
        assert.strictEqual(execGitStub.callCount, 3, 'add, prune, add');
    });
});
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Error spy tracking | Manual error logging | sinon.assert.calledWith() | Sinon provides built-in assertion methods for call verification |
| State file mocking | Custom in-memory state objects | memfs with vol.fromJSON() | Tests actual file I/O code paths, not just in-memory objects |
| Workflow state assertions | Manual state traversal | WorkflowStateMachine.getCurrentStep() | Use state machine's own methods for verification |
| Git error simulation | Manual error throwing | sinon.stub().rejects() | Consistent with existing test patterns |
| Concurrent update testing | Manual promise coordination | Promise.all() with race conditions | Realistic concurrent scenarios |

**Key insight:** The existing Phase 5 infrastructure (memfs, sinon) is sufficient for integration testing. Focus on testing at module boundaries rather than building new test utilities.

---

## Common Pitfalls

### Pitfall 1: Testing Error Types Instead of Error Behavior

**What goes wrong:** Tests assert `instanceof GitError` but don't verify the error actually reaches the user.

**Why it happens:** Unit tests focus on class types, integration tests need to verify end-to-end behavior.

**How to avoid:** Always test the full error path: source -> propagation -> user notification. Verify `userMessage` is actionable, not just that error type is correct.

**Warning signs:** Tests that pass but errors are still shown to users as raw exceptions in production.

### Pitfall 2: Not Testing Error Recovery Paths

**What goes wrong:** Tests verify errors are thrown but don't verify the system recovers gracefully.

**Why it happens:** Error recovery is often an afterthought in test design.

**How to avoid:** For each error scenario, test: (1) error is detected, (2) user is notified, (3) system remains in consistent state, (4) retry is possible.

**Warning signs:** Tests that only assert `rejects` or `throws` without checking state after the error.

### Pitfall 3: MCP State Corruption Under Concurrent Updates

**What goes wrong:** Multiple MCP tools update state simultaneously, corrupting the state file.

**Why it happens:** File write operations aren't atomic (write then rename).

**How to avoid:** Use the atomic write pattern already in `saveState()`: write to temp file, then rename. Test with `Promise.all()` to simulate concurrency.

**Warning signs:** Tests that pass sequentially but fail with concurrent updates.

### Pitfall 4: Mocking Too Much in Integration Tests

**What goes wrong:** Integration tests mock everything, becoming glorified unit tests.

**Why it happens:** Easier to mock external dependencies than to set up realistic test scenarios.

**How to avoid:** Only mock external dependencies (git commands, VS Code APIs). Test real error handling, validation, and state management code.

**Warning signs:** Tests that pass even when production code has bugs.

### Pitfall 5: Not Testing Workflow State Machine Transitions

**What goes wrong:** Tests verify individual MCP tools work but don't verify workflow state progresses correctly.

**Why it happens:** Testing state machines requires setup and state tracking across multiple test steps.

**How to avoid:** Create integration tests that call multiple MCP tools in sequence and verify state at each step.

**Warning signs:** Workflow tests that only test single tool calls, not multi-step workflows.

---

## Code Examples

### Current State: Missing Integration Tests

```typescript
// Current: No integration tests for error propagation
// src/test/git/branchValidation.test.ts only tests validation in isolation
test('should reject branch names with @{ sequence', () => {
    // Only tests ValidationError class, not how it propagates
    const error = new ValidationError('branchName', '@{bad}', 'contains @{ sequence');
    assert.strictEqual(error.kind, 'validation');
});
```

### Target State: Integration Test for Error Path

```typescript
// Target: Tests full error path from validation to user
test('should reject session creation when branch name is invalid', async () => {
    // Arrange: Invalid branch name
    const invalidBranch = '@{bad}';
    const sessionName = 'test-session';

    // Act: Attempt to create session
    const result = await createSession(sessionName, invalidBranch, '/test-repo');

    // Assert: Full error path verified
    assert.strictEqual(result.success, false);
    assert.ok(result.error instanceof ValidationError);
    assert.strictEqual(result.error.field, 'branchName');
    assert.ok(result.error.userMessage.includes('@{ sequence'));
    assert.ok(vscode.window.showErrorMessage.called, 'user was notified');
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Error paths not tested | Integration tests for all error scenarios | Phase 6 | Catches regressions in error handling |
| MCP tools tested in isolation | End-to-end workflow state tests | Phase 6 | Verifies workflow persistence and recovery |
| Git error handling assumed | Git error recovery integration tests | Phase 6 | Ensures graceful failure handling |
| Manual state management | Automated state persistence tests | Phase 6 | Prevents state corruption in production |

**Deprecated/outdated:**
- Assuming error handling works without tests
- Testing MCP tools in isolation (no state verification)
- Skipping error recovery path testing
- Manual state file verification in tests

---

## Current Codebase Analysis

### Error Paths Requiring Integration Tests

| Error Type | Source Files | Integration Points | Test Priority |
|------------|--------------|-------------------|---------------|
| GitError | gitService.ts | extension.ts (commands), workflow tools | HIGH |
| ValidationError | validators.ts | extension.ts (session creation) | HIGH |
| WorkflowValidationError | loader.ts | MCP tools (workflow_start) | MEDIUM |
| FilesystemError | (future) | Settings management, state persistence | LOW (not implemented yet) |
| ConfigError | (future) | Configuration loading | LOW (not implemented yet) |

### MCP Integration Points Requiring Tests

| MCP Tool | Handler | State Impact | Test Priority |
|----------|---------|--------------|---------------|
| workflow_start | tools.ts | Creates workflow-state.json | HIGH |
| workflow_advance | tools.ts | Updates state, increments step | HIGH |
| workflow_set_tasks | tools.ts | Modifies template in state | MEDIUM |
| workflow_status | tools.ts | Reads state | MEDIUM |
| workflow_context | tools.ts | Returns outputs from state | MEDIUM |
| register_artefacts | tools.ts | Adds artifacts to state | LOW |
| session_create | tools.ts | Creates worktree | HIGH |
| session_clear | tools.ts | Deletes claude-progress.txt | MEDIUM |

### Existing Error Test Coverage

| Test File | Coverage Type | Gaps |
|-----------|---------------|------|
| errorHandling.test.ts | Unit tests for error classes | No integration tests |
| branchValidation.test.ts | Unit tests for validation | No extension integration |
| mergeBaseHandling.test.ts | Git fallback behavior | No error recovery tests |
| workflow/*.test.ts | Individual workflow components | No end-to-end workflow tests |

---

## Open Questions

1. **MCP server testing:** Should we test the MCP server's stdio transport layer?
   - **Recommendation:** No. Test the tool handlers directly. The MCP SDK handles the transport protocol, which is already tested by the SDK maintainers.

2. **VS Code API mocking:** Should we mock vscode.window.showErrorMessage in integration tests?
   - **Recommendation:** Yes. Use sinon to stub VS Code APIs and verify they're called with appropriate error messages.

3. **State file location:** Should we test state persistence with real files in a temp directory?
   - **Recommendation:** No. Use memfs to maintain deterministic tests. Real file I/O causes flakiness.

4. **Git error scenarios:** How many git failure modes should we test?
   - **Recommendation:** Focus on the most common: invalid branch, merge-base failure, network timeout, worktree conflicts. Other errors can use generic error handling tests.

5. **Concurrent MCP updates:** Should we test race conditions in state updates?
   - **Recommendation:** Yes. Test with `Promise.all()` to simulate concurrent tool calls and verify atomic writes prevent corruption.

---

## Sources

### Primary (HIGH confidence)

- [Testing Extensions - Official VS Code API](https://code.visualstudio.com/api/working-with-extensions/testing-extension) - Official VS Code extension testing guide
- [Dealing with Test Flakiness - Microsoft VSCode Wiki](https://github.com/microsoft/vscode/wiki/Dealing-with-Test-Flakiness) - Official guidance on handling flaky tests
- [Model Context Protocol SDK Documentation](https://modelcontextprotocol.io/) - MCP SDK reference
- [memfs npm package](https://www.npmjs.com/package/memfs) - In-memory file system for Node.js
- [Sinon.js - Official Documentation](https://sinonjs.org/) - Test doubles for JavaScript

### Secondary (MEDIUM confidence)

- [Integration Testing Best Practices - Martin Fowler](https://martinfowler.com/bliki/IntegrationTest.html) - Integration testing principles
- [Testing Multi-Agent Systems - MCP Blog](https://modelcontextprotocol.io/blog/testing-multi-agent-systems/) - MCP-specific testing patterns
- [Error Handling in TypeScript - Docusign](https://developers.docusign.com/docs/esign-rest-api/guides/testing/) - Error handling patterns
- [State Machine Testing Patterns - XState](https://stately.ai/blog) - State machine testing best practices

### Tertiary (LOW confidence)

- [TypeScript Error Handling Patterns - Medium](https://medium.com/@dan_shimoon/typescript-error-handling-patterns) - Community patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No changes needed, Phase 5 infrastructure is sufficient
- Architecture: HIGH - Integration testing patterns are well-established
- Error path testing: HIGH - Direct analysis of existing error handling code
- MCP testing: MEDIUM - MCP is relatively new, but SDK provides clear patterns
- Pitfalls: HIGH - Based on common integration testing mistakes

**Research date:** 2026-02-08
**Valid until:** 2026-05-08 (90 days - testing patterns are stable)

---

*Next step: Create PLAN.md with detailed task breakdown based on this research.*
