# Testing Patterns

**Analysis Date:** 2026-02-10

## Test Framework

**Runner:**
- VS Code Test CLI (vscode-test)
- Config: `package.json` scripts section
- Framework: Mocha (VS Code's built-in test framework)

**Assertion Library:**
- Node.js built-in `assert` module
- Strict assertions via `assert.strictEqual()`, `assert.deepStrictEqual()`, `assert.ok()`

**Run Commands:**
```bash
npm test                # Run all tests
npm run compile && npm test  # Compile and run tests (recommended before commit)
npm run pretest         # Run linting and compile before tests
```

## Test File Organization

**Location:**
- Co-located in `src/test/` directory hierarchy
- Tests mirror source structure: `src/extension.ts` → `src/test/extension-hook-script.test.ts`
- Subdirectories organize test categories:
  - `src/test/core/` - Core functionality (session provider, local settings, workflow)
  - `src/test/config/` - Configuration and storage (global storage, prompts folder)
  - `src/test/git/` - Git operations
  - `src/test/session/` - Session management
  - `src/test/workflow/` - Workflow templates
  - `src/test/integration/` - Integration tests and error paths
- Utilities shared in `src/test/testSetup.ts`

**Naming:**
- Format: `[descriptor].test.ts` or `[domain-name].test.ts`
- Examples: `validation.test.ts`, `local-settings.test.ts`, `session-provider-workflow.test.ts`, `extension-hook-script.test.ts`

**Structure:**
```
src/test/
├── testSetup.ts                    # Shared test utilities
├── asyncQueue.test.ts
├── validation.test.ts
├── sanitization.test.ts
├── core/                           # Core functionality tests
│   ├── local-settings.test.ts
│   ├── session-provider-workflow.test.ts
│   ├── extension-settings-workflow.test.ts
│   ├── generate-diff.test.ts
│   └── ...
├── config/                         # Configuration tests
│   ├── global-storage.test.ts
│   ├── prompts-storage.test.ts
│   └── ...
├── git/                            # Git operation tests
│   └── ...
├── session/                        # Session management tests
│   └── ...
├── workflow/                       # Workflow template tests
│   └── ...
└── integration/                    # Integration tests
    ├── error-paths.test.ts
    └── ...
```

## Test Structure

**Suite Organization:**
```typescript
// From src/test/errorHandling.test.ts
suite('Error Handling', () => {

    suite('GitError', () => {
        test('includes command and exit code', () => {
            // Arrange
            const command = ['worktree', 'add', '/path/to/worktree', 'branch-name'];
            const exitCode = 128;
            const cause = 'fatal: not a valid object name: branch-name';

            // Act
            const error = new GitError(command, exitCode, cause);

            // Assert
            assert.strictEqual(error.kind, 'git', 'kind should be "git"');
            assert.deepStrictEqual(error.command, command, 'command should be set');
            assert.strictEqual(error.exitCode, exitCode, 'exitCode should be set');
            assert.ok(error.userMessage.includes('Exit code: 128'), 'userMessage should include exit code');
        });

        test('handles undefined exit code (spawn failure)', () => {
            // Arrange
            const command = ['status'];
            const cause = 'ENOENT: git executable not found';

            // Act
            const error = new GitError(command, undefined, cause);

            // Assert
            assert.strictEqual(error.kind, 'git');
            assert.deepStrictEqual(error.command, command);
            assert.strictEqual(error.exitCode, undefined, 'exitCode should be undefined for spawn failures');
        });
    });
});
```

**Patterns:**
- Mocha's `suite(name, fn)` for test groups
- Mocha's `test(name, fn)` for individual tests
- Mocha's `setup(fn)` for test setup/initialization
- Mocha's `teardown(fn)` for cleanup
- AAA pattern: **Arrange** → **Act** → **Assert** (with comments)
- Assert messages provide context: `assert.strictEqual(result.valid, false, 'Should reject empty name')`

## Mocking

**Framework:**
- Sinon.js for stubs and mocks (`sinon` package)
- In-memory filesystem via memfs (`memfs` package for isolated file operations)
- Direct fixture creation using temp directories (real filesystem for integration tests)

**Patterns:**

### Memfs-based Mocking (Isolated File Operations):
```typescript
// From src/test/testSetup.ts
import { fs as memfs, vol } from 'memfs';

export function setupMemfs(): MemfsSetupResult {
    return {
        vol,
        reset: () => vol.reset(),
    };
}

// In test:
const memfsSetup = setupMemfs();
memfsSetup.vol.fromJSON({
    '/test/file.txt': 'content',
    '/test/.git/config': '[core]\nrepositoryformatversion = 0'
});
// Use memfs for operations
memfsSetup.reset();  // Clean up
```

### Sinon Stubs (Git Operations):
```typescript
// From src/test/testSetup.ts
export function setupGitStubs(): GitStubsResult {
    const execGit = sinon.stub();
    return {
        execGit,
        restore: () => execGit.restore(),
    };
}

// In test:
const gitStubs = setupGitStubs();
gitStubs.execGit
    .withArgs(['status'])
    .resolves({ stdout: '', stderr: '', exitCode: 0 });
// Use stub for git operations
gitStubs.restore();  // Clean up
```

### Temp Directory Fixtures (Integration Tests):
```typescript
// From src/test/testSetup.ts - real filesystem for realistic scenarios
export function createTempDir(): TempDirResult {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
    const worktreesDir = path.join(tempDir, '.worktrees');
    return { tempDir, worktreesDir };
}

// In test:
let dirs: TempDirResult;
setup(() => {
    dirs = createTempDir();
    // Set up real files in temp directory
    fs.mkdirSync(path.join(dirs.tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dirs.tempDir, '.claude', 'settings.local.json'), JSON.stringify({}));
});

teardown(() => {
    cleanupTempDir(dirs.tempDir);  // Recursive cleanup
});
```

**What to Mock:**
- External commands (git) via Sinon stubs
- File system operations in unit tests via memfs (ensures isolation)
- VS Code API via direct mocking (GlobalStorageUri, configuration)
- Test repo structure via memfs `.fromJSON()` for filesystem-based tests

**What NOT to Mock:**
- Core Node.js modules (`path`, `crypto`)
- Test utilities from `testSetup.ts` (these are meant to be real helpers)
- File operations in integration tests (use real temp directories to catch path issues)
- Error types (test with real error objects)

## Fixtures and Factories

**Test Data:**

### Git Repository Fixture:
```typescript
// From src/test/testSetup.ts
export function createTestRepo(volume: VolumeType, basePath = '/test-repo'): void {
    const gitDir = path.join(basePath, '.git');
    volume.fromJSON({
        [path.join(gitDir, 'config')]: `[core]
    repositoryformatversion = 0
    filemode = true
    bare = false
    logallrefupdates = true`,
        [path.join(gitDir, 'HEAD')]: 'ref: refs/heads/main',
        [path.join(gitDir, 'objects', 'info')]: '',
        [path.join(gitDir, 'objects', 'pack')]: '',
        [path.join(gitDir, 'refs', 'heads')]: '',
        [path.join(gitDir, 'refs', 'tags')]: '',
        [path.join(gitDir, 'refs', 'remotes')]: '',
        [path.join(basePath, 'README.md')]: '# Test Repository\n',
    });
}
```

### Worktree Structure Fixture:
```typescript
// From src/test/testSetup.ts
export function createWorktree(
    volume: VolumeType,
    repoPath: string,
    worktreeName: string,
    branch = 'feature/test-session'
): void {
    const worktreesDir = path.join(repoPath, '.worktrees', worktreeName);
    volume.fromJSON({
        [path.join(worktreesDir, 'gitdir')]: path.join(repoPath, '.git', 'worktrees', worktreeName),
        [path.join(worktreesDir, 'HEAD')]: `ref: refs/heads/${branch}`,
        [path.join(worktreesDir, 'commondir')]: path.join(repoPath, '.git'),
    });
}
```

**Location:**
- Shared utilities in `src/test/testSetup.ts`: `createTempDir()`, `cleanupTempDir()`, `setupMemfs()`, `setupGitStubs()`, `createTestRepo()`, `createWorktree()`
- Domain-specific factories in test files when needed (avoid over-abstraction)

## Coverage

**Requirements:**
- No formal coverage target enforced (not configured in package.json)
- Tests written for critical paths: validation, error handling, file operations, session management
- 45 test files total covering core functionality, configurations, git operations, and workflows

**View Coverage:**
```bash
# No coverage reporting configured; would require adding nyc or c8
# To add coverage:
npm install --save-dev nyc
# Then run: nyc npm test
```

## Test Types

**Unit Tests:**
- Scope: Single function or module in isolation
- Approach: Use memfs for file operations, Sinon stubs for git commands
- Examples:
  - `validation.test.ts` - Tests individual validation functions
  - `asyncQueue.test.ts` - Tests AsyncQueue queue behavior
  - `errorHandling.test.ts` - Tests error class construction and properties
  - `sanitization.test.ts` - Tests name sanitization logic

**Integration Tests:**
- Scope: Multiple components working together
- Approach: Real temp directories, real file system, test actual interactions
- Examples:
  - `src/test/core/local-settings.test.ts` - Tests settings file propagation to worktrees
  - `src/test/core/session-provider-workflow.test.ts` - Tests session creation with workflows
  - `src/test/integration/error-paths.test.ts` - Tests error conditions across components
  - `src/test/session/` - Tests session management with file system

**E2E Tests:**
- Framework: Not used in current codebase
- VS Code extension testing is performed manually via F5 debug launch
- Test launcher config in `.vscode/launch.json` provides Extension Development Host

## Common Patterns

**Async Testing:**
```typescript
// From src/test/core/local-settings.test.ts
test('should propagate settings.local.json to new worktree', async () => {
    // Arrange: Create a worktree directory manually
    const sessionName = 'test-local-settings';
    const worktreePath = path.join(worktreesDir, sessionName);
    fs.mkdirSync(worktreePath, { recursive: true });

    // Act: Call propagateLocalSettings (returns Promise)
    const { propagateLocalSettings } = await import('../../localSettings.js');
    await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');

    // Assert
    const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
    assert.ok(fs.existsSync(targetPath), 'File should exist in worktree');
    const content = fs.readFileSync(targetPath, 'utf-8');
    assert.deepStrictEqual(JSON.parse(content), { env: { TEST_VAR: 'test-value' } });
});
```

**Error Testing:**
```typescript
// From src/test/errorHandling.test.ts
test('includes command and exit code', () => {
    // Arrange
    const command = ['worktree', 'add', '/path/to/worktree', 'branch-name'];
    const exitCode = 128;
    const cause = 'fatal: not a valid object name: branch-name';

    // Act
    const error = new GitError(command, exitCode, cause);

    // Assert
    assert.strictEqual(error.kind, 'git', 'kind should be "git"');
    assert.deepStrictEqual(error.command, command, 'command should be set');
    assert.strictEqual(error.exitCode, exitCode, 'exitCode should be set');
    assert.ok(error.userMessage.includes('Exit code: 128'), 'userMessage should include exit code');
    assert.ok(error.userMessage.includes('worktree add'), 'userMessage should reference command');
    assert.ok(error.message.includes('failed'), 'internal message should describe failure');
});
```

**Setup/Teardown with Real Filesystem:**
```typescript
// From src/test/extension-hook-script.test.ts
suite('Hook Script Generation', () => {
    let tempDir: string;
    let worktreesDir: string;
    let globalStorageDir: string;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-hook-script-test-'));
        worktreesDir = path.join(tempDir, '.worktrees');
        fs.mkdirSync(worktreesDir, { recursive: true });
        globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

        // Initialize global storage context for tests
        const mockUri = vscode.Uri.file(globalStorageDir);
        initializeGlobalStorageContext(mockUri, tempDir);

        // Enable global storage for these tests
        const config = vscode.workspace.getConfiguration('lanes');
        await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);
    });

    teardown(async () => {
        // Reset configuration
        const config = vscode.workspace.getConfiguration('lanes');
        await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);

        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(globalStorageDir, { recursive: true, force: true });
    });

    test('generates hook script with executable permissions', async () => {
        // ... test body
    });
});
```

**Validation Testing (Security-Focused):**
```typescript
// From src/test/validation.test.ts
suite('Validation Module - Session Name Validation', () => {

    test('rejects empty session name', () => {
        const result = validateSessionName('');
        assert.strictEqual(result.valid, false, 'Should reject empty name');
        assert.ok(result.error?.includes('empty'), 'Error should mention empty');
    });

    test('rejects session name containing .. (path traversal)', () => {
        const result = validateSessionName('../etc/passwd');
        assert.strictEqual(result.valid, false, 'Should reject path traversal');
        assert.ok(result.error?.includes('..'), 'Error should mention ..');
    });

    test('rejects session name containing null byte', () => {
        const result = validateSessionName('test\x00name');
        assert.strictEqual(result.valid, false, 'Should reject null byte');
        assert.ok(result.error?.includes('null'), 'Error should mention null byte');
    });
});
```

## Pre-commit Verification

**Hook Enforcement:**
- Husky pre-commit hook enforces: `npm run compile && npm run lint`
- Tests run via `npm run pretest` which does: `npm run compile && npm run lint`
- Full test suite (`npm test`) must pass before committing

**Safe Test Practices:**
- Test files may use sync fs methods (exempt from ESLint ban)
- Production code must use async fs/promises
- Tests validate both happy paths and security concerns (path traversal, null bytes, etc.)

---

*Testing analysis: 2026-02-10*
