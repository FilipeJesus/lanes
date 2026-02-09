# Testing Patterns

**Analysis Date:** 2026-02-09

## Test Framework

**Runner:**
- VS Code Test CLI (`@vscode/test-cli` 0.0.12)
- Mocha test framework (built into VS Code)
- Config: None (uses VS Code defaults)

**Assertion Library:**
- Node.js built-in `assert` module
- All tests use: `import * as assert from 'assert'`
- Common assertions: `assert.strictEqual()`, `assert.ok()`, `assert.match()`, `assert.deepStrictEqual()`

**Run Commands:**
```bash
npm test                # Run all tests (also runs compile and lint first via pretest)
npm run compile         # Compile TypeScript (required before tests)
npm run lint            # Run ESLint validation
npm run watch           # Watch mode for development
```

## Test File Organization

**Location:**
- Co-located with source: Tests live in `src/test/` alongside the code they test
- Mirrors source structure: `src/test/core/`, `src/test/session/`, `src/test/git/`, `src/test/workflow/`, `src/test/integration/`

**Naming:**
- Pattern: `*.test.ts` suffix
- Examples: `projectManager.test.ts`, `extension-hook-script.test.ts`, `generate-diff.test.ts`

**Structure:**
```
src/test/
├── core/                          # Core functionality tests
│   ├── session-provider-workflow.test.ts
│   ├── generate-diff.test.ts
│   ├── chime-configuration.test.ts
│   ├── local-settings.test.ts
│   └── workflow-summary.test.ts
├── config/                        # Configuration tests
├── git/                           # Git integration tests
├── session/                       # Session-specific tests
├── workflow/                      # Workflow tests
├── integration/                   # Integration tests
├── projectManager.test.ts         # Project Manager tests
└── extension-hook-script.test.ts  # Hook script generation tests
```

## Test Structure

**Suite Organization:**
```typescript
suite('Suite Name', () => {
    let tempDir: string;

    setup(() => {
        // Run before each test in this suite
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-prefix-'));
    });

    teardown(() => {
        // Run after each test in this suite
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    suite('Nested Suite Name', () => {
        test('should do something when X is true', () => {
            // Arrange
            const input = 'value';

            // Act
            const result = someFunction(input);

            // Assert
            assert.strictEqual(result, 'expected');
        });
    });
});
```

**Patterns:**
- `suite()` for test groups, supports nesting
- `setup()` runs before each test (equivalent to beforeEach)
- `teardown()` runs after each test (equivalent to afterEach)
- `test()` for individual test cases
- AAA pattern: Arrange, Act, Assert (used in comments)
- Comments document test intent: `// Given...`, `// When...`, `// Then...` patterns
- Async tests: `test('name', async () => { ... })`

Example from `projectManager.test.ts`:
```typescript
test('should extract repository name from absolute path', () => {
    // Arrange
    const repoPath = '/Users/user/projects/my-awesome-repo';

    // Act
    const result = getRepoName(repoPath);

    // Assert
    assert.strictEqual(result, 'my-awesome-repo', 'Should return the last path segment');
});
```

## Mocking

**Framework:** Sinon 21.0.1

**Patterns:**
- Used for spying and stubbing VS Code APIs
- No comprehensive mocking examples in current codebase, but installed and available
- Manual setup/teardown for filesystem mocks using memfs

**What to Mock:**
- VS Code extension APIs that would require live extension host
- External API calls that are expensive or non-deterministic
- File I/O when testing behavior, not the file operations themselves

**What NOT to Mock:**
- FileService async functions - use real fs/promises for file operations
- Internal service functions - test the integration instead
- Date/time unless specifically testing time-dependent logic

## Fixtures and Factories

**Test Data:**
```typescript
// From extension-hook-script.test.ts - setup/teardown pattern
setup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-hook-script-test-'));
    worktreesDir = path.join(tempDir, '.worktrees');
    fs.mkdirSync(worktreesDir, { recursive: true });
    globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

    // Initialize with mock context
    const mockUri = vscode.Uri.file(globalStorageDir);
    initializeGlobalStorageContext(mockUri, tempDir);
});

teardown(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(globalStorageDir, { recursive: true, force: true });
});
```

**Location:**
- No dedicated fixtures directory
- Fixtures created in `setup()` blocks specific to test needs
- Temporary directories created with `fs.mkdtempSync()`
- Cleanup in `teardown()` blocks

## Coverage

**Requirements:** No coverage enforcement detected in config

**View Coverage:**
- No coverage reporting script found
- `npm test` runs full test suite but no coverage collection configured

## Test Types

**Unit Tests:**
- Test individual functions in isolation
- Use actual file system but with temporary directories
- Examples: `FileService` operations, utility functions like `sanitizeSessionName()`
- Run synchronously or async with await

**Integration Tests:**
- Located in `src/test/integration/`
- Test multiple modules working together
- Use actual git operations and file system
- Example: Session creation with worktree setup

**E2E Tests:**
- Located in `src/test/`
- Test extension activation, commands, providers
- Use VS Code Test CLI for extension host context
- Examples: `extension.test.ts` (if present), hook script generation

**Configuration/Documentation Tests:**
- Tests that document expected behavior without complex setup
- Examples: `generate-diff.test.ts` documents merge-base behavior
- Assertions on configuration values and defaults

## Common Patterns

**Async Testing:**
```typescript
test('getWorkflowStatus returns workflow status from valid state file', async () => {
    // Arrange
    const worktreePath = path.join(tempDir, 'with-workflow');
    fs.mkdirSync(worktreePath, { recursive: true });

    // Act
    const status = await getWorkflowStatus(worktreePath);

    // Assert
    assert.ok(status, 'Should return workflow status');
});
```

**File System Testing:**
```typescript
// From generate-diff.test.ts
setup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-diff-test-'));
    testWorktreePath = path.join(tempDir, 'test-worktree');
    fs.mkdirSync(testWorktreePath, { recursive: true });
});

teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});
```

**Platform-Specific Testing:**
```typescript
// From extension-hook-script.test.ts
if (process.platform !== 'win32') {
    assert.ok((stats.mode & 0o111) !== 0, 'Hook script should be executable');
}
```

**Error Testing:**
```typescript
// Test error conditions by verifying behavior when operations fail
test('should fall back to base branch when merge-base fails', async () => {
    // This test documents the fallback behavior
    // When includeUncommitted is true but merge-base fails:
    // 1. Error is logged with console.warn
    // 2. Falls back to: execGit(['diff', baseBranch], worktreePath)
    assert.ok(true, 'Test documents fallback behavior');
});
```

**Testing with VS Code APIs:**
```typescript
// From extension-hook-script.test.ts
const mockUri = vscode.Uri.file(globalStorageDir);
initializeGlobalStorageContext(mockUri, tempDir);

// Testing configuration
const config = vscode.workspace.getConfiguration('lanes');
const includeUncommitted = config.get<boolean>('includeUncommittedChanges', true);
assert.ok(typeof includeUncommitted === 'boolean', 'Should be boolean');
```

## Test Isolation

**Pre-test Requirements:**
- Compile TypeScript: `npm run compile` (enforced by `pretest` script)
- Lint code: `npm run lint` (enforced by `pretest` script)
- Git worktrees are fully functional in test environment

**Shared Setup:**
- Global storage context initialized per test suite
- Configuration state managed per test with cleanup in teardown
- Temporary directories unique per test run

**Known Limitations:**
- VS Code configuration updates in test environment may be limited
- Full git worktree operations require actual git repository
- Some integration tests document expected behavior rather than testing live APIs

---

*Testing analysis: 2026-02-09*
