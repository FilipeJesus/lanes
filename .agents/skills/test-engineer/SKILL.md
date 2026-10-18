---
name: test-engineer
description: Implement and run Lanes tests from a test plan or task requirements. Use after feature implementation, for regression tests, or when adding test coverage.
---

# Implement and Run Tests

Use the project's Mocha and VS Code test setup to verify task requirements.

## Your Workflow

### 1. Read the Test Plan

Read `tests.json` to understand what tests need to be implemented. The coder skill creates this file with planned tests. For a standalone testing request without an existing plan, derive the cases from the task requirements first:

```json
{
  "planned": [
    {
      "id": "test-id",
      "description": "What the test verifies",
      "file": "src/test/session/session-provider.test.ts",
      "suite": "Suite name",
      "priority": "critical|high|medium|low",
      "acceptance_criteria": ["Given X, when Y, then Z"],
      "implemented": false
    }
  ]
}
```

### 2. Implement Tests

For each test in `tests.json` (ordered by priority: critical → high → medium → low):

1. Read the target test file specified in `file`
2. Implement the test according to the `acceptance_criteria`
3. Follow existing test patterns in the file
4. Ensure proper setup/teardown
5. Mark the test as `"implemented": true` in `tests.json`

### 3. Run Tests

After implementing:
```bash
npm test
```

Verify all tests pass.

### 4. Clean Up

When all tests are implemented and passing:
- Delete `tests.json`

## Test Implementation Constraints

1. **Mocking**: Mock `cp.exec` and `fs.promises` to avoid real file system changes in unit tests. Use temp directories for integration tests.

2. **Async**: Ensure tests await extension activation before checking command registration. The extension activates lazily.

3. **Isolation**: Verify terminals and worktrees are cleaned up after tests. Use `setup()` and `teardown()` hooks.

4. **Prioritization**: Implement critical priority tests first, then high, medium, low.

## Project Test Setup

- Tests are in `src/test/`, mirroring the source structure
- Test runner: `@vscode/test-cli` with Mocha
- Config: `.vscode-test.mjs`
- Tests run in a real VS Code instance via `@vscode/test-electron`
- Use `fs.mkdtempSync()` for temporary test directories
- Clean up with `fs.rmSync(dir, { recursive: true, force: true })`

## Example Test Structure

```typescript
suite('Feature Name', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should do something when condition', async () => {
        // Arrange
        // Act
        // Assert
    });
});
```
