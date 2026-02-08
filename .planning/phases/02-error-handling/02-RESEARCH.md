# Phase 2: Error Handling - Research

**Researched:** 2026-02-08
**Domain:** TypeScript error handling patterns, VS Code extension error UX
**Confidence:** HIGH

## Summary

Phase 2 focuses on improving error handling across the Lanes codebase. The current state shows mixed error handling patterns: some functions return `{ success: boolean; error?: string }` objects, others throw exceptions, and many silently fail with console.warn. This phase will standardize error handling, add descriptive error messages, and ensure error path test coverage.

**Primary recommendation:** Use a lightweight Result-type pattern without external dependencies. For VS Code extensions, throw custom Error classes with user-friendly messages, and use Result objects only for operations where graceful degradation is required.

---

## Standard Stack

### Core (No New Dependencies)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| TypeScript Error Classes | Native | Custom error types | Built-in, no dependencies |
| Discriminated Unions | Native | Result/ValidationResult types | Type-safe error handling |
| try-catch-finally | Native | Exception control flow | Standard JavaScript |
| vscode.window.showErrorMessage | VS Code API | User-facing errors | Official VS Code pattern |

### Supporting (Existing - No Changes)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `getErrorMessage()` | Custom | Extract string from unknown error | Converting errors for display |
| Existing `ValidationResult` | Custom | Branch name validation | Already defined in utils.ts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Result type | neverthrow library | neverthrow adds ~12KB, functional style is unfamiliar to codebase, overkill for simple VS Code extension |
| Custom Result type | Effect library | Effect is a full framework (100KB+), far too heavy for error handling only |
| Throwing errors | Return null/undefined | Throwing preserves stack traces and forces handling; null returns are easily ignored |

**Installation:** None required - using existing patterns and native TypeScript features.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── errors/
│   ├── LanesError.ts        # Base error class for all Lanes errors
│   ├── GitError.ts          # Git operation failures
│   ├── ValidationError.ts   # User input validation failures
│   └── index.ts             # Re-exports
├── utils/
│   └── result.ts            # Result<T, E> type (optional, if needed)
└── [existing files]
```

### Pattern 1: Custom Error Class Hierarchy

**What:** Extends Error with properties for user-facing messages and optional error codes.

**When to use:** For all error conditions that reach the user.

**Example:**
```typescript
// Source: Custom pattern based on TypeScript best practices
export abstract class LanesError extends Error {
    abstract readonly kind: 'git' | 'validation' | 'filesystem' | 'config';
    readonly userMessage: string;

    constructor(message: string, userMessage?: string) {
        super(message);
        this.name = this.constructor.name;
        this.userMessage = userMessage || message;
    }
}

export class GitError extends LanesError {
    readonly kind = 'git' as const;
    readonly command: string;
    readonly exitCode?: number;

    constructor(command: string, exitCode: number | undefined, cause: unknown) {
        const baseMessage = `Git command failed: ${command}`;
        const userMessage = `Git operation failed. ${exitCode ? `Exit code: ${exitCode}. ` : ''}Please check your git repository.`;
        super(baseMessage, userMessage);
        this.command = command;
        this.exitCode = exitCode;
    }
}

export class ValidationError extends LanesError {
    readonly kind = 'validation' as const;
    readonly field: string;
    readonly value: string;

    constructor(field: string, value: string, reason: string) {
        const userMessage = `Invalid ${field}: "${value}". ${reason}`;
        super(userMessage, userMessage);
        this.field = field;
        this.value = value;
    }
}
```

### Pattern 2: Result Type for Graceful Degradation

**What:** A discriminated union type representing success or failure.

**When to use:** For operations where failure is expected and should be handled gracefully (not errors requiring user intervention).

**Example:**
```typescript
// Source: Based on neverthrow and fp-ts patterns, simplified
export type Result<T, E = Error> =
    | { success: true; value: T }
    | { success: false; error: E };

// Helper functions
export const ok = <T>(value: T): Result<T> => ({ success: true, value });
export const err = <E extends Error>(error: E): Result<never, E> => ({ success: false, error });

// Usage
async function tryGetConfig(path: string): Result<Config, Error> {
    try {
        const content = await fs.promises.readFile(path, 'utf-8');
        return ok(JSON.parse(content));
    } catch (e) {
        return err(e instanceof Error ? e : new Error(String(e)));
    }
}

// Consumption
const result = await tryGetConfig(configPath);
if (!result.success) {
    // Handle error - maybe use defaults
    return getDefaultConfig();
}
// Use result.value
```

### Pattern 3: VS Code Error Display

**What:** Mapping internal errors to user-facing messages via VS Code API.

**When to use:** In command handlers and user-facing operations.

**Example:**
```typescript
// Source: VS Code Extension API patterns
async function handleSessionCreation(...) {
    try {
        await createSession(...);
    } catch (error) {
        let userMessage = 'Failed to create session.';

        if (error instanceof GitError) {
            userMessage = error.userMessage;
        } else if (error instanceof ValidationError) {
            userMessage = error.userMessage;
        } else if (error instanceof LanesError) {
            userMessage = error.userMessage;
        } else {
            console.error('Unexpected error:', error);
        }

        await vscode.window.showErrorMessage(userMessage, 'Retry', 'Cancel');
        throw error; // Re-throw for logging/upstream handlers
    }
}
```

### Anti-Patterns to Avoid

- **Mixed error handling:** Don't mix null returns, throws, and Result types inconsistently. Choose one pattern per module and document it.
- **Generic error messages:** Avoid "Operation failed" without context. Always include what operation and why it failed.
- **Silent failures:** Don't just `console.warn()` and continue. Either handle gracefully or surface to user.
- **Error strings:** Don't return strings for errors. Use proper Error types or Result objects.
- **Catching all errors:** Avoid `catch (e) { /* ignore */ }`. At minimum log the error.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Full Result library | map, chain, flatMap, fold, etc. | Simple discriminated union | Full functional error handling is overkill for this codebase |
| Error recovery middleware | Automatic retry with exponential backoff | Simple try-catch with user prompt | Git operations have specific failure modes that need user intervention |
| Error logging service | Remote error tracking | console.error + VS Code output channel | This is a local dev tool, not a production service |

**Key insight:** VS Code extensions are developer tools where users have direct access to logs. Complex error handling abstractions add cognitive overhead without proportional benefit.

---

## Common Pitfalls

### Pitfall 1: Inconsistent Error Type Checking

**What goes wrong:** Using `instanceof` works for Error objects but fails when errors are thrown across module boundaries or after serialization.

**Why it happens:** Some error handling libraries wrap errors, losing type information.

**How to avoid:** Use custom error classes consistently, and add a `kind` discriminator for type narrowing:

```typescript
// Good: Discriminated union for type narrowing
if (error instanceof LanesError) {
    switch (error.kind) {
        case 'git': /* handle git errors */ break;
        case 'validation': /* handle validation */ break;
    }
}
```

**Warning signs:** Type guards that use `any` or type assertions, `error instanceof Error` checks that are the only type safety.

### Pitfall 2: Swallowing Async Errors

**What goes wrong:** Async function errors are silently ignored because promise rejection is unhandled.

**Why it happens:** Not awaiting promises or missing `.catch()` handlers.

**How to avoid:** Always handle promise rejections. Use `await` in try-catch or add `.catch()` to all promises.

**Warning signs:** Async functions without try-catch, promise chains without `.catch()`, console-only error logging.

### Pitfall 3: Generic Error Messages

**What goes wrong:** User sees "Error: something went wrong" without actionable information.

**Why it happens:** Using generic `new Error()` without context, or catching and re-throwing with less context.

**How to avoid:** Always include operation context in error messages. Use custom error types with structured data.

**Warning signs:** Error messages without operation names (e.g., "failed" vs "git worktree add failed"), missing file paths, missing exit codes.

### Pitfall 4: Testing Only Happy Paths

**What goes wrong:** Tests pass but production fails because error cases weren't tested.

**Why it happens:** Error paths require more setup (mocking failures) and are tedious to write.

**How to avoid:** For each critical function, write at least one error path test. Use Sinon to mock failures.

**Warning signs:** 100% test coverage claims but no error tests, all tests using valid inputs only.

---

## Code Examples

### Current State (Before Phase 2)

```typescript
// Current: Inconsistent patterns
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
    if (!branchNameRegex.test(branchName)) {
        return false;  // Silent failure - no error indication
    }
    try {
        await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], cwd);
        return true;
    } catch {
        return false;  // Swallows all errors - is it invalid branch or git failure?
    }
}

// Current: Generic error
export class CodeAgent {
    constructor(protected readonly config: CodeAgentConfig) {
        if (!config.name) {
            throw new Error('CodeAgentConfig requires a non-empty name');  // No error code
        }
    }
}
```

### Target State (After Phase 2)

```typescript
// Target: Clear error types
export class BranchValidationError extends LanesError {
    readonly kind = 'validation' as const;
    constructor(branchName: string, reason: string) {
        super(
            `Branch validation failed: ${branchName}`,
            `Invalid branch name "${branchName}". ${reason}`
        );
    }
}

export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
    if (!branchNameRegex.test(branchName)) {
        throw new BranchValidationError(branchName, 'Branch names may only contain letters, numbers, hyphens, underscores, dots, and slashes');
    }
    try {
        await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], cwd);
        return true;
    } catch (error) {
        // Distinguish between "branch doesn't exist" and actual git failures
        if (isGitNotFoundError(error)) {
            return false;
        }
        throw new GitError(['show-ref', '--verify', `refs/heads/${branchName}`], getErrorCode(error), error);
    }
}
```

### Error Path Testing Example

```typescript
// Test: Error paths are explicit
suite('branchExists error handling', () => {
    test('should throw ValidationError for invalid branch name', async () => {
        await assert.rejects(
            () => branchExists('/repo', 'feature/..'),
            (error: BranchValidationError) => {
                assert.strictEqual(error.kind, 'validation');
                assert.ok(error.userMessage.includes('feature/..'));
                return true;
            }
        );
    });

    test('should throw GitError for actual git failures', async () => {
        const execGitStub = sinon.stub(gitService, 'execGit');
        execGitStub.rejects(new Error('git not found'));

        await assert.rejects(
            () => branchExists('/repo', 'main'),
            (error: GitError) => {
                assert.strictEqual(error.kind, 'git');
                assert.deepStrictEqual(error.command, ['show-ref', '--verify', 'refs/heads/main']);
                return true;
            }
        );
    });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Return null on error | Throw typed errors | Phase 2 | Forces error handling, preserves stack traces |
| Generic Error class | Custom LanesError hierarchy | Phase 2 | Better error messages, type-safe error handling |
| Silent failures | Explicit error propagation | Phase 2 | Users see actionable error messages |
| try-catch everywhere | Result type for graceful degradation | Phase 2 (selective) | Cleaner code for non-critical operations |

**Deprecated/outdated:**
- Returning null/undefined to signal errors: Makes it easy to ignore failures
- Throwing strings: Not proper Error objects, lose stack traces
- Generic `new Error('failed')`: No context, no type safety

---

## Current Codebase Analysis

### Files Requiring Error Handling Updates

| File | Current Pattern | Needed Changes | Priority |
|------|-----------------|----------------|----------|
| `extension.ts` | Mixed throws + showErrorMessage | Standardize on LanesError types | High |
| `gitService.ts` | Throws generic Error | Add GitError type | High |
| `utils.ts` | Has ValidationResult pattern | Keep for validation, add error types | Medium |
| `ClaudeSessionProvider.ts` | Silent failures (try-catch-log) | Surface errors to user | Medium |
| `AsyncQueue.ts` | Logs errors, continues | Add timeout error type | Low |
| `workflow/loader.ts` | Has WorkflowValidationError | Good pattern, extend to other modules | Reference |

### Existing Patterns to Keep

1. **`ValidationResult` interface** (utils.ts) - Good pattern for validation that doesn't throw
2. **`WorkflowValidationError`** (workflow/loader.ts) - Good example of custom error class
3. **`getErrorMessage()` helper** (utils.ts) - Keep for converting unknown errors to strings

### Functions Requiring Error Path Tests

Based on the grep analysis and code review:

- `execGit()` - All git operations
- `createSession()` - All error paths
- `getBaseRepoPath()` - Git rev-parse failures
- `branchExists()` - Invalid branch names
- `validateBranchName()` - All validation rules
- `generateDiffContent()` - Merge-base failures
- `repairWorktree()` - All failure scenarios

---

## Open Questions

1. **Result type adoption scope:** Should Result<T> be used broadly or only for specific graceful degradation scenarios?
   - **Recommendation:** Use only for operations where graceful fallback is explicitly designed (e.g., config loading). Use exceptions for everything else.

2. **Error message localization:** Should error messages support i18n?
   - **Recommendation:** No. VS Code extension development is English-first. Add if there's explicit user demand.

3. **Error telemetry:** Should errors be reported/telemetry?
   - **Recommendation:** No. This is a local developer tool. No remote reporting.

4. **Breaking changes:** Can changing return types from null to throws be done safely?
   - **Recommendation:** Yes, for internal functions. For public APIs (if any), consider additive changes first.

---

## Sources

### Primary (HIGH confidence)

- [Using Either/Result in TypeScript for Error Handling](https://dev.to/mykhailokrainik/using-eitherresult-in-typescript-for-error-handling-1igf) - October 2025
- [TypeScript Error Handling](https://www.thecandidstartup.org/2025/04/14/typescript-error-handling.html) - April 2025
- [Effective TypeScript Principles in 2025](https://blog.dennisokeeffe.com/blog/2025-03-16-effective-typescript-principles-in-2025) - March 2025
- [neverthrow GitHub Repository](https://github.com/supermacro/neverthrow) - Type-safe errors for JavaScript & TypeScript
- [StackOverflow: Error handling in VS Code extensions](https://stackoverflow.com/questions/67014002/error-handling-in-extensions-to-visual-studio-code)

### Secondary (MEDIUM confidence)

- [Building VS Code Extensions in 2026: The Complete Guide](https://abdulkadersafi.com/blog/building-vs-code-extensions-in-2026-the-complete-modern-guide)
- [Functional Error Handling in TypeScript with the Result Pattern](https://arg-software.medium.com/functional-error-handling-in-typescript-with-the-result-pattern-5b96a5abb6d3)
- [Error Handling in TypeScript: Neverthrow, Try-Catch, and Alternatives](https://devalade.me/blog/error-handling-in-typescript-neverthrow-try-catch-and-alternative-like-effec-ts.mdx) - April 2025

### Tertiary (LOW confidence)

- None - all sources have been verified against official documentation or reputable sources.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Native TypeScript features, no new dependencies needed
- Architecture: HIGH - Based on established patterns from multiple verified sources
- Pitfalls: HIGH - Direct code analysis of the current codebase

**Research date:** 2026-02-08
**Valid until:** 2026-05-08 (90 days - error handling patterns are stable)

---

*Next step: Create PLAN.md with detailed task breakdown based on this research.*
