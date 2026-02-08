# Testing Patterns

**Analysis Date:** 2026-02-08

## Test Framework

**Runner:**
- Framework: VS Code Test Extension (@vscode/test-cli)
- Config: Default VS Code test runner configuration
- Test pattern: Extension testing in isolated VS Code instance

**Assertion Library:**
- Node.js built-in `assert` module
- No external assertion libraries used

**Run Commands:**
```bash
npm test              # Run full test suite (compiles, lints, then tests)
npm run pretest       # Compile, lint, then run tests
npm run compile        # Compile TypeScript
npm run lint          # Run ESLint
```

## Test File Organization

**Location:**
- Pattern: co-located with source files in `src/test/`
- Each source file has corresponding test file when needed

**Naming:**
- Pattern: `[feature].test.ts`
  - `sanitization.test.ts` for `sanitizeSessionName`
  - `extension.test.ts` for extension settings
  - `mcp.test.ts` for MCP server functionality
  - `workflow.test.ts` for workflow management

**Structure:**
```
src/
├── extension.ts
├── utils.ts
└── test/
    ├── extension.test.ts
    ├── sanitization.test.ts
    └── mcp.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
suite('Extension Settings File', () => {
    let tempDir: string;
    let worktreesDir: string;
    let globalStorageDir: string;

    setup(async () => {
        // Setup temporary directory structure
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-ext-settings-test-'));
        // ... other setup
    });

    teardown(async () => {
        // Cleanup temporary directories
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    suite('Settings File Location', () => {
        test('should create settings file at correct global storage path', async () => {
            // Arrange
            // Act
            // Assert
        });
    });
});
```

**Patterns:**
- Use `suite()` for test groups with descriptive names
- Use `setup()` and `teardown()` for test lifecycle
- Use nested suites for logical grouping
- Arrange-Act-Assert pattern consistently used
- Async tests with `async/await`

## Mocking

**Framework:** None - no mocking framework used
- Tests use real implementations
- Temporary directories for filesystem isolation
- Minimal mocking of VS Code APIs

**Patterns:**
```typescript
// Create temporary test environment
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
const mockUri = vscode.Uri.file(tempDir);

// Mock VS Code configuration
const config = vscode.workspace.getConfiguration('lanes');
await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);
```

**What to Mock:**
- VS Code APIs when needed (configuration, URIs)
- Filesystem operations through temporary directories
- Git operations through temporary repositories

**What NOT to Mock:**
- Core business logic (sanitizeSessionName, workflow management)
- Extension activation/deactivation
- File system utilities (fs, path modules)

## Fixtures and Factories

**Test Data:**
```typescript
export interface TempDirResult {
    tempDir: string;
    worktreesDir: string;
}

export function createTempDir(): TempDirResult {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
    const worktreesDir = path.join(tempDir, '.worktrees');
    return { tempDir, worktreesDir };
}

export function cleanupTempDir(tempDir: string): void {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
```

**Location:**
- Common utilities in `src/test/testSetup.ts`
- Re-exported for convenience in test files

## Coverage

**Requirements:** Not enforced by configuration
- No coverage percentage targets
- Coverage reports available via VS Code test runner
- Manual code review for coverage gaps

**View Coverage:**
```bash
# No built-in coverage command
# Use VS Code Test Explorer for visual coverage
```

## Test Types

**Unit Tests:**
- Focus: Individual functions and utilities
- Examples: `sanitizeSessionName`, path manipulation
- Pattern: Isolated testing with input/output verification
- Location: Majority of tests in `src/test/`

**Integration Tests:**
- Focus: Extension activation and VS Code API interaction
- Examples: Extension settings file management
- Pattern: Mock VS Code environment, test extension behavior
- Location: `extension.test.ts`, configuration tests

**E2E Tests:**
- Framework: Not used (VS Code extension testing is limited)
- Limitations: Cannot test actual worktree creation in CI
- Workaround: Test the logic in isolation with mocked environments

## Common Patterns

**Async Testing:**
```typescript
test('should create session with async operations', async () => {
    // Arrange
    const sessionName = 'test-session';

    // Act
    const result = await createSession(sessionName);

    // Assert
    assert.ok(result.sessionId);
    assert.strictEqual(result.name, sessionName);
});
```

**Error Testing:**
```typescript
test('should throw error for invalid workflow', async () => {
    await assert.rejects(
        () => validateWorkflow('invalid-template', extensionPath, workspaceRoot),
        /Invalid workflow template/
    );
});
```

**Filesystem Testing:**
```typescript
test('should create settings file with proper directory structure', async () => {
    // Arrange
    const worktreePath = path.join(worktreesDir, 'test-session');
    fs.mkdirSync(worktreePath, { recursive: true });

    // Act
    const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

    // Assert
    assert.ok(fs.existsSync(settingsPath));
    assert.ok(path.isAbsolute(settingsPath));
});
```

**Test Cleanup:**
```typescript
teardown(async () => {
    // Reset configuration
    const config = vscode.workspace.getConfiguration('lanes');
    await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

    // Cleanup files
    fs.rmSync(tempDir, { recursive: true, force: true });
});
```

## Test Organization by Feature

**Extension Core:**
- `extension.test.ts`: Settings file management, configuration
- `sanitization.test.ts`: Git branch name validation
- `session.test.ts`: Session lifecycle management

**Git Integration:**
- `gitChanges.test.ts`: Git diff and status display
- `brokenWorktree.test.ts`: Worktree repair functionality

**Workflow System:**
- `workflow.test.ts`: Workflow state machine and progression
- `workflow-resume.test.ts`: State persistence and recovery

**UI Components:**
- `sessionForm.test.ts`: Webview form validation
- `previousSession.test.ts`: Session history management

**Code Agents:**
- `codeAgent.test.ts`: Agent initialization and delegation

**MCP Integration:**
- `mcp.test.ts`: MCP server tools and workflow management
- `configuration.test.ts`: Extension configuration handling

**Edge Cases:**
- `edgeCases.test.ts`: Error handling and boundary conditions

---

*Testing analysis: 2026-02-08*