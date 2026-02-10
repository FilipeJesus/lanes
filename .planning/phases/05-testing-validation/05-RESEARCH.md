# Phase 05: Testing & Validation - Research

**Researched:** 2026-02-10
**Domain:** VS Code extension testing with Mocha, Sinon, and security validation
**Confidence:** HIGH

## Summary

This phase requires comprehensive unit and integration testing for the multi-agent system (CodexAgent, factory, session form) plus fixing 4 carried-over security/correctness issues before writing tests. The testing domain is well-understood: VS Code extensions use Mocha as the test runner (via @vscode/test-cli), Sinon for mocking/stubbing, and standard Node.js testing patterns.

The existing codebase has extensive test coverage with 45+ test files organized by domain (src/test/core/, src/test/git/, src/test/workflow/, src/test/session/, src/test/integration/). Tests follow a consistent pattern: setup/teardown with temp directories, sinon stubs for fs/vscode API mocking, and Mocha's suite/test structure.

Security fixes are straightforward: replace child_process.exec with execFile to eliminate shell injection, use shell:true for automatic shell resolution, add 'active' to type union, and implement path traversal protection in captureSessionId.

**Primary recommendation:** Write focused unit tests following existing codebase patterns. Mock fs with sinon stubs for session capture, create mock Terminal objects for terminal tracking tests, verify command string construction without CLI invocation. Fix security issues first, then write tests that cover the corrected behavior.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried-over issue fixes:**
- Fix all 4 carried-over issues IN this phase (before writing tests, so tests cover fixed behavior)
- Command injection in `isCliAvailable()`: Replace `exec()` with `execFile()` to eliminate shell injection entirely (no regex needed)
- Hardcoded `/bin/sh` shell path: Use `shell: true` option to let Node.js resolve the shell automatically
- `AgentStatusState` type missing `'active'`: Add `'active'` to the type union
- Path traversal in `captureSessionId`: Claude's discretion on approach (validate resolved paths or filter filenames)

**Test scope & priorities:**
- CodexCodeAgent: Test critical paths only — command building, permission mapping, session ID capture, shell escaping, UUID validation. Skip trivial getters (getAgentName, getTerminalIcon, etc.)
- Factory: Test thoroughly including CLI availability check with injection protection — valid commands, malicious inputs, missing CLIs, timeout behavior
- TOML settings format service: Skip testing — unused by Codex currently, test when a feature exercises it
- Session form: Test individual components separately (dropdown rendering, permission toggle, callback) — not full flow

**Test execution strategy:**
- CodexAgent command building: String construction verification only — assert buildStartCommand()/buildResumeCommand() return correct strings with proper flags and escaping. No real CLI invocation.
- Session ID capture (filesystem polling): Mock fs module with sinon stubs on fs.readdir/fs.readFile to simulate session files appearing. Fast and deterministic.
- Hookless terminal tracking: Mock VS Code terminal events — create mock Terminal objects and fire onDidOpenTerminal/onDidCloseTerminal to test tracking flow

**Backward compatibility:**
- Test old command aliases: Verify each old `claudeWorktrees.*` command ID maps to the new `lanes.*` command
- Test legacy session data: Verify session files without `agentName` field default to 'claude' and load without errors
- Regression gate: Trust CI (pre-commit hook runs full test suite). No explicit regression step needed.

### Claude's Discretion

- Whether to extract duplicated utility functions (escapeForSingleQuotes, validateSessionId) to base class/shared module before testing, or test in place
- Path traversal fix implementation approach
- Exact mock patterns for terminal event testing
- Test file organization (new test files vs extending existing extension.test.ts)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

## Standard Stack

### Core Testing Infrastructure

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @vscode/test-cli | ^0.0.12 | VS Code test runner | Official VS Code testing framework, wraps Mocha |
| @vscode/test-electron | ^2.5.2 | Electron test environment | Required for VS Code extension integration tests |
| mocha | (bundled) | Test framework | Industry standard for Node.js testing, used by all VS Code extensions |
| sinon | ^21.0.1 | Test doubles library | Best-in-class mocking/stubbing for Node.js, supports full stub lifecycle |
| @types/sinon | ^21.0.0 | TypeScript types | Type safety for sinon in TypeScript projects |
| @types/mocha | ^10.0.10 | TypeScript types | Type safety for mocha test declarations |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| memfs | ^4.56.10 | In-memory filesystem | Complex fs mocking (already in devDeps, but sinon stubs sufficient for this phase) |
| assert | (Node built-in) | Assertions | Standard Node.js assertions, used throughout existing tests |

### Test Execution

**Installation:**
```bash
# Already installed in package.json devDependencies
npm install  # No new dependencies needed
```

**Run tests:**
```bash
npm test                # Full test suite (compiles, lints, runs tests)
npm run pretest         # Compile and lint only
```

**Configuration:**
- `.vscode-test.mjs` — Test CLI configuration (already configured)
- `package.json` — Test script runs `vscode-test` command
- No test runner index.ts file needed (VS Code test-cli handles it)

## Architecture Patterns

### Recommended Test File Structure

```
src/test/
├── codeAgents/              # New directory for agent tests
│   ├── codex-agent.test.ts          # CodexAgent unit tests
│   ├── agent-factory.test.ts        # Factory + CLI availability tests
│   └── session-form-agent.test.ts   # Session form agent selection tests
├── integration/             # Existing integration tests
│   └── backward-compat.test.ts      # New: backward compatibility tests
├── workflow/                # Existing workflow tests
├── session/                 # Existing session tests
└── [existing test files]
```

**Rationale:** Group agent-related tests in `src/test/codeAgents/` to mirror the implementation structure (`src/codeAgents/`). Follows existing pattern where test directories mirror source directories.

### Pattern 1: Mocha Suite Organization (Existing Codebase Pattern)

**What:** Nested `suite()` blocks for logical grouping, `setup()`/`teardown()` for lifecycle
**When to use:** All test files — provides clear test organization and isolation
**Example:**
```typescript
// Source: src/test/session/session-provider.test.ts (lines 8-27)
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

suite('AgentSessionProvider', () => {
    let tempDir: string;
    let worktreesDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
        worktreesDir = path.join(tempDir, '.worktrees');
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should return empty array when workspace is undefined', async () => {
        const provider = new AgentSessionProvider(undefined);
        const children = await provider.getChildren();
        assert.deepStrictEqual(children, []);
    });
});
```

### Pattern 2: Sinon Stub Lifecycle Management

**What:** Create stubs in `setup()`, restore in `teardown()` to prevent test pollution
**When to use:** Any test that mocks/stubs functions (fs, child_process, vscode API)
**Example:**
```typescript
// Pattern for fs mocking (based on web search results)
import * as sinon from 'sinon';
import * as fs from 'fs/promises';

suite('CodexAgent Session Capture', () => {
    let readdirStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;
    let statStub: sinon.SinonStub;

    setup(() => {
        readdirStub = sinon.stub(fs, 'readdir');
        readFileStub = sinon.stub(fs, 'readFile');
        statStub = sinon.stub(fs, 'stat');
    });

    teardown(() => {
        readdirStub.restore();
        readFileStub.restore();
        statStub.restore();
    });

    test('captures session ID from newest file', async () => {
        // Configure stub behavior
        readdirStub.resolves(['session1.jsonl', 'session2.jsonl']);
        statStub.onCall(0).resolves({ mtime: new Date('2026-01-01') });
        statStub.onCall(1).resolves({ mtime: new Date('2026-01-02') });
        readFileStub.resolves('{"session_id":"12345678-1234-1234-1234-123456789abc"}');

        const sessionId = await CodexAgent.captureSessionId(new Date('2026-01-01'));
        assert.strictEqual(sessionId, '12345678-1234-1234-1234-123456789abc');
    });
});
```

### Pattern 3: Mock VS Code API Objects

**What:** Create plain JavaScript objects matching VS Code API shapes, no need for complex mocking library
**When to use:** Testing code that consumes VS Code API (Terminal, TreeItem, etc.)
**Example:**
```typescript
// Based on VS Code extension testing patterns
import * as vscode from 'vscode';

suite('Terminal Tracking', () => {
    test('tracks terminal open event', () => {
        // Create mock terminal matching vscode.Terminal interface
        const mockTerminal: vscode.Terminal = {
            name: 'Codex: test-session',
            processId: Promise.resolve(12345),
            creationOptions: {},
            exitStatus: undefined,
            state: { isInteractedWith: false },
            sendText: () => {},
            show: () => {},
            hide: () => {},
            dispose: () => {}
        } as vscode.Terminal;

        // Test logic that handles terminal objects
        const result = extractSessionName(mockTerminal);
        assert.strictEqual(result, 'test-session');
    });
});
```

### Pattern 4: Command String Verification (No CLI Invocation)

**What:** Test command building by asserting on the returned string, don't execute the command
**When to use:** Testing buildStartCommand(), buildResumeCommand() in agents
**Example:**
```typescript
suite('CodexAgent Command Building', () => {
    test('buildStartCommand includes permission flags', () => {
        const agent = new CodexAgent();

        const cmd = agent.buildStartCommand({
            permissionMode: 'acceptEdits',
            prompt: 'Fix the bug'
        });

        // Verify string construction without executing
        assert.ok(cmd.includes('codex'), 'Should start with codex command');
        assert.ok(cmd.includes('--sandbox workspace-write'), 'Should include sandbox flag');
        assert.ok(cmd.includes('--ask-for-approval on-failure'), 'Should include approval flag');
        assert.ok(cmd.includes("'Fix the bug'"), 'Should include escaped prompt');
    });

    test('buildResumeCommand validates UUID format', () => {
        const agent = new CodexAgent();

        // Valid UUID should not throw
        const validCmd = agent.buildResumeCommand(
            '12345678-1234-1234-1234-123456789abc',
            {}
        );
        assert.ok(validCmd.includes('codex resume'));

        // Invalid UUID should throw
        assert.throws(
            () => agent.buildResumeCommand('not-a-uuid', {}),
            /Invalid session ID format/
        );
    });
});
```

### Pattern 5: Security Test Cases (Command Injection Prevention)

**What:** Test with malicious inputs to verify security fixes work correctly
**When to use:** Testing isCliAvailable() after exec→execFile fix
**Example:**
```typescript
// Based on Node.js security research
import * as sinon from 'sinon';
import { execFile } from 'child_process';

suite('Agent Factory Security', () => {
    let execFileStub: sinon.SinonStub;

    setup(() => {
        execFileStub = sinon.stub(require('child_process'), 'execFile');
    });

    teardown(() => {
        execFileStub.restore();
    });

    test('isCliAvailable rejects command injection attempts', async () => {
        // Malicious input with command injection attempt
        const maliciousCmd = 'codex; rm -rf /';

        execFileStub.callsArgWith(2, new Error('ENOENT')); // Simulate "not found"

        const result = await isCliAvailable(maliciousCmd);

        // Verify execFile was called (not exec), preventing shell interpretation
        assert.ok(execFileStub.calledOnce, 'Should call execFile');

        // execFile won't interpret semicolon as command separator
        const callArgs = execFileStub.firstCall.args;
        assert.strictEqual(callArgs[0], 'command', 'Should use command builtin');
        assert.deepStrictEqual(callArgs[1], ['-v', maliciousCmd], 'Args should be array');

        assert.strictEqual(result, false, 'Should return false for missing CLI');
    });

    test('isCliAvailable uses shell:true for automatic shell resolution', async () => {
        execFileStub.callsArgWith(2, null, '/usr/local/bin/codex', '');

        await isCliAvailable('codex');

        // Verify shell:true option is set (no hardcoded /bin/sh)
        const options = execFileStub.firstCall.args[2];
        assert.strictEqual(options.shell, true, 'Should use shell:true for portability');
    });
});
```

### Anti-Patterns to Avoid

- **Testing implementation details:** Don't test private methods directly — test through public interface
- **Brittle string matching:** Use `.includes()` for command verification, not exact string equality (allows flexibility in flag ordering)
- **Shared state between tests:** Always clean up in `teardown()`, never rely on test execution order
- **Real filesystem/CLI operations in unit tests:** Use stubs/mocks for fast, deterministic tests
- **Testing VS Code extension activation:** Extension activation is tested via integration tests, not unit tests

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Filesystem mocking | Custom fake fs implementation | Sinon stubs on fs.promises | Sinon provides withArgs, onCall, callsFake for complex scenarios. Full stub lifecycle management. |
| VS Code API mocking | Custom mock framework | Plain JS objects + sinon stubs | VS Code API is well-typed. Simple objects work for most cases. Sinon for event emitters. |
| Test runner setup | Custom Mocha configuration | @vscode/test-cli with .vscode-test.mjs | Official VS Code test runner handles Electron environment, extension loading, user data isolation. |
| Command injection testing | Manual shell escaping validation | execFile + argument arrays | execFile with args array prevents shell interpretation entirely. No escaping needed. |
| UUID validation | Custom regex testing | Static pattern constant + test cases | UUID regex is well-defined. Test with valid/invalid examples, not regex internals. |

**Key insight:** VS Code extension testing has well-established patterns. The official test-cli handles the complex parts (Electron environment, extension host). Sinon handles mocking. Focus tests on business logic, not framework plumbing.

## Common Pitfalls

### Pitfall 1: Not Restoring Stubs Between Tests

**What goes wrong:** First test stubs fs.readFile, second test expects real fs behavior → both tests use stub
**Why it happens:** Forgetting to call `.restore()` in teardown leaves stubs active globally
**How to avoid:** Always pair stub creation with restoration in setup/teardown lifecycle
**Warning signs:** Tests pass in isolation but fail when run together. Strange "function called with unexpected args" errors.

**Prevention pattern:**
```typescript
suite('My Tests', () => {
    let myStub: sinon.SinonStub;

    setup(() => {
        myStub = sinon.stub(module, 'function');
    });

    teardown(() => {
        myStub.restore();  // CRITICAL: Always restore
    });
});
```

### Pitfall 2: Using exec() Instead of execFile() for CLI Checks

**What goes wrong:** Command injection vulnerability when testing with untrusted input
**Why it happens:** exec() spawns a shell and interprets special characters (`;`, `$()`, backticks)
**How to avoid:** Use execFile() with argument array — no shell interpretation
**Warning signs:** Security scanners flag exec() usage. Test with `'; rm -rf /'` succeeds when it should fail.

**Correct pattern (from security research):**
```typescript
// BAD: Shell injection risk
exec(`command -v ${cliCommand}`, (err) => { ... });

// GOOD: No shell interpretation
execFile('command', ['-v', cliCommand], { shell: true }, (err) => { ... });
```

Note: `shell: true` enables shell builtin access (for `command -v`) but args are still array, preventing injection.

### Pitfall 3: Testing Async Code Without Proper Awaits

**What goes wrong:** Test finishes before async operation completes, leading to false positives
**Why it happens:** Forgetting `await` on promises, or not returning promises from test functions
**How to avoid:** Mark test as `async`, use `await` on all promises
**Warning signs:** Tests pass but code is broken. Intermittent failures. "UnhandledPromiseRejection" warnings.

**Correct pattern:**
```typescript
// BAD: Test completes before promise resolves
test('captures session ID', () => {
    CodexAgent.captureSessionId(new Date()).then(id => {
        assert.strictEqual(id, 'expected-id');  // Never runs!
    });
});

// GOOD: Test waits for promise
test('captures session ID', async () => {
    const id = await CodexAgent.captureSessionId(new Date());
    assert.strictEqual(id, 'expected-id');
});
```

### Pitfall 4: Hardcoding Platform-Specific Paths

**What goes wrong:** Tests pass on macOS/Linux, fail on Windows (or vice versa)
**Why it happens:** Using `/tmp` instead of `os.tmpdir()`, `/bin/sh` instead of `shell: true`
**How to avoid:** Use Node.js path APIs (`path.join`, `os.tmpdir()`) and shell resolution
**Warning signs:** Tests fail on CI with different OS. Path separator errors (`/` vs `\`).

**Prevention pattern:**
```typescript
// BAD: Hardcoded Unix path
const tempDir = '/tmp/test';

// GOOD: Platform-agnostic
const tempDir = path.join(os.tmpdir(), 'test');

// BAD: Hardcoded shell path
exec(cmd, { shell: '/bin/sh' });

// GOOD: Let Node.js resolve shell
execFile('command', args, { shell: true });
```

### Pitfall 5: Over-Mocking VS Code API

**What goes wrong:** Tests become fragile, break when VS Code API changes internally
**Why it happens:** Mocking entire API surface instead of just consumed methods
**How to avoid:** Create minimal mock objects with only properties/methods your code uses
**Warning signs:** Tests require extensive mock setup. Mock code is longer than test code.

**Lean pattern:**
```typescript
// Don't need full Terminal mock, just what code uses
const mockTerminal = {
    name: 'Codex: session',
    processId: Promise.resolve(123)
} as vscode.Terminal;

// Code only reads name and processId → minimal mock sufficient
```

## Code Examples

Verified patterns from codebase and research:

### Security Fix: Command Injection Prevention

```typescript
// Source: Researched from Node.js security best practices (2026)
// Location: src/codeAgents/factory.ts

// BEFORE (vulnerable):
import { exec } from 'child_process';

export async function isCliAvailable(cliCommand: string): Promise<boolean> {
    return new Promise((resolve) => {
        exec(`command -v ${cliCommand}`, { shell: '/bin/sh', timeout: 5000 }, (error) => {
            resolve(!error);
        });
    });
}

// AFTER (secure):
import { execFile } from 'child_process';

export async function isCliAvailable(cliCommand: string): Promise<boolean> {
    return new Promise((resolve) => {
        // execFile + args array prevents shell injection
        // shell:true enables 'command' builtin without injection risk
        execFile('command', ['-v', cliCommand], { shell: true, timeout: 5000 }, (error) => {
            resolve(!error);
        });
    });
}
```

### Test Pattern: Mock fs for Session Capture

```typescript
// Based on: Sinon documentation + codebase patterns
// Location: src/test/codeAgents/codex-agent.test.ts (to be created)

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fs from 'fs/promises';
import { CodexAgent } from '../../codeAgents/CodexAgent';

suite('CodexAgent Session Capture', () => {
    let readdirStub: sinon.SinonStub;
    let statStub: sinon.SinonStub;
    let readFileStub: sinon.SinonStub;

    setup(() => {
        readdirStub = sinon.stub(fs, 'readdir');
        statStub = sinon.stub(fs, 'stat');
        readFileStub = sinon.stub(fs, 'readFile');
    });

    teardown(() => {
        readdirStub.restore();
        statStub.restore();
        readFileStub.restore();
    });

    test('polls until session file appears', async () => {
        const beforeTime = new Date('2026-01-01T10:00:00Z');

        // First poll: no files
        readdirStub.onCall(0).resolves([]);

        // Second poll: file appears
        readdirStub.onCall(1).resolves(['session-123.jsonl']);
        statStub.resolves({ mtime: new Date('2026-01-01T10:00:01Z') });
        readFileStub.resolves('{"session_id":"12345678-1234-1234-1234-123456789abc"}\n');

        const sessionId = await CodexAgent.captureSessionId(beforeTime, 5000, 100);

        assert.strictEqual(sessionId, '12345678-1234-1234-1234-123456789abc');
        assert.ok(readdirStub.callCount >= 2, 'Should poll multiple times');
    });

    test('returns null on timeout', async () => {
        // Always return empty directory
        readdirStub.resolves([]);

        const sessionId = await CodexAgent.captureSessionId(new Date(), 500, 100);

        assert.strictEqual(sessionId, null, 'Should return null when timeout reached');
    });
});
```

### Test Pattern: Command String Verification

```typescript
// Based on: Existing test patterns in src/test/workflow/code-agent.test.ts
// Location: src/test/codeAgents/codex-agent.test.ts

suite('CodexAgent Command Building', () => {
    test('buildStartCommand with permission flags', () => {
        const agent = new CodexAgent();

        const cmd = agent.buildStartCommand({
            permissionMode: 'bypassPermissions',
            prompt: "Fix bug in user's code"
        });

        assert.ok(cmd.startsWith('codex '), 'Should start with CLI command');
        assert.ok(cmd.includes('--sandbox danger-full-access'), 'Should include sandbox flag');
        assert.ok(cmd.includes('--ask-for-approval never'), 'Should include approval flag');
        assert.ok(cmd.includes("'Fix bug in user'\\''s code'"), 'Should escape single quotes');
    });

    test('buildResumeCommand validates UUID', () => {
        const agent = new CodexAgent();

        // Valid UUID
        const cmd = agent.buildResumeCommand('a1b2c3d4-e5f6-7890-abcd-ef1234567890', {});
        assert.strictEqual(cmd, 'codex resume a1b2c3d4-e5f6-7890-abcd-ef1234567890');

        // Invalid UUID throws
        assert.throws(
            () => agent.buildResumeCommand('not-a-uuid', {}),
            /Invalid session ID format/
        );
    });
});
```

### Test Pattern: Backward Compatibility

```typescript
// Based on: Extension testing patterns
// Location: src/test/integration/backward-compat.test.ts (to be created)

import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Backward Compatibility', () => {
    test('old command aliases map to new commands', async () => {
        // Get all commands
        const commands = await vscode.commands.getCommands(true);

        // Old command IDs that should still work
        const legacyCommands = [
            'claudeWorktrees.createSession',
            'claudeWorktrees.deleteSession',
            'claudeWorktrees.openSession',
            // ... other legacy commands
        ];

        for (const legacyCmd of legacyCommands) {
            assert.ok(
                commands.includes(legacyCmd),
                `Legacy command ${legacyCmd} should be registered`
            );
        }
    });

    test('session data without agentName defaults to claude', () => {
        const agent = new ClaudeCodeAgent();

        // Legacy session file content (no agentName field)
        const legacyContent = JSON.stringify({
            sessionId: 'abc123',
            timestamp: '2026-01-01T00:00:00Z'
        });

        const sessionData = agent.parseSessionData(legacyContent);

        assert.ok(sessionData !== null, 'Should parse legacy session data');
        assert.strictEqual(sessionData.agentName, 'claude', 'Should default to claude');
        assert.strictEqual(sessionData.sessionId, 'abc123');
    });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @vscode/test-electron only | @vscode/test-cli + test-electron | 2023-2024 | Simpler test configuration with .vscode-test.mjs declarative config |
| Custom Mocha setup in index.ts | VS Code test-cli handles setup | 2024 | No need for test runner boilerplate, focus on writing tests |
| exec() for CLI checks | execFile() with args array | Ongoing (2025-2026 security guidance) | Eliminates command injection vulnerabilities entirely |
| Hardcoded /bin/sh | shell: true option | Node.js best practice | Cross-platform compatibility (Windows, macOS, Linux) |
| Complex VS Code API mocks | Minimal mock objects | Current | Simpler tests, less fragile to VS Code updates |

**Deprecated/outdated:**
- Manual Mocha test runner setup: VS Code test-cli handles it now
- proxyquire for mocking: Sinon stubs are simpler and more powerful
- exec() with sanitization: execFile() is the secure default, no sanitization needed

## Open Questions

1. **Path traversal fix implementation**
   - What we know: captureSessionId reads from ~/.codex/sessions/ without path validation
   - What's unclear: Exact validation approach (resolve paths and check prefix, or filter filename characters)
   - Recommendation: Use `path.resolve()` + prefix check to ensure file is within sessions directory. Simpler than filename filtering and catches symlink attacks.

2. **Utility function extraction**
   - What we know: escapeForSingleQuotes and validateSessionId are CodexAgent-specific currently
   - What's unclear: Whether to extract to base class or keep in CodexAgent
   - Recommendation: Keep in CodexAgent for now. Only extract if ClaudeCodeAgent needs them (YAGNI principle). Testing in place is sufficient.

3. **Test file organization preference**
   - What we know: Could create new test files or extend existing ones
   - What's unclear: User preference for organization
   - Recommendation: Create new files in src/test/codeAgents/ — mirrors source structure, keeps tests focused. Matches existing pattern (test/workflow/ mirrors src/workflow/).

## Sources

### Primary (HIGH confidence)

- Codebase test files: src/test/session/session-provider.test.ts, src/test/workflow/code-agent.test.ts, src/test/errorHandling.test.ts
- Implementation files: src/codeAgents/CodexAgent.ts, src/codeAgents/factory.ts, src/SessionFormProvider.ts
- package.json: devDependencies, test scripts, VS Code test-cli configuration
- .vscode-test.mjs: Test runner configuration

### Secondary (MEDIUM confidence)

- [Testing Extensions | Visual Studio Code Extension API](https://code.visualstudio.com/api/working-with-extensions/testing-extension) - Official VS Code testing docs
- [Preventing Command Injection Attacks in Node.js Apps](https://auth0.com/blog/preventing-command-injection-attacks-in-node-js-apps/) - execFile security guidance
- [How to mock fs.readdir and fs.readFile for unit testing](https://www.technicalfeeder.com/2022/03/how-to-mock-fs-readdir-and-fs-readfile-for-unit-testing/) - Sinon stub patterns
- [Unit test & mock VS Code extension API with Jest](https://www.richardkotze.com/coding/unit-test-mock-vs-code-extension-api-jest) - VS Code API mocking patterns (applicable to Mocha)
- [Sinon.JS - Official Documentation](https://sinonjs.org/) - Stub/spy/mock API reference

### Tertiary (LOW confidence)

- Web search results on VS Code terminal event mocking (2026) - general patterns, needs verification against actual VS Code API
- Web search results on Mocha in VS Code (2026) - extension marketplace tools, not directly applicable to our use case

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package.json confirmed versions, existing tests verify tooling works
- Architecture: HIGH - 45+ existing test files demonstrate patterns, consistent approach across codebase
- Pitfalls: HIGH - Based on documented security vulnerabilities (execFile vs exec) and observed test patterns
- Security fixes: HIGH - Official Node.js security guidance for execFile, straightforward implementation changes

**Research date:** 2026-02-10
**Valid until:** 60 days (Mocha/Sinon are stable, VS Code test-cli is established, security guidance is current)
