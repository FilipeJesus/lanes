# Phase 1: Critical Bug Fixes - Research

**Researched:** 2026-02-08
**Status:** Research Complete

---

## Executive Summary

This phase fixes three critical bugs affecting user reliability:
1. **Race conditions** in session creation when rapidly creating multiple sessions
2. **Git instability** with non-standard branch names (`feature/.`, `feature/*`, etc.)
3. **Merge-base failures** when viewing changes for remote branches

The implementation requires adding an async queue, pre-flight Git branch validation, and improved error handling with auto-fetch for remote branches.

---

## 1. Race Condition in Session Creation

### 1.1 Problem Analysis

**Current State (`/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/extension.ts:1693-1800+`)**

The `createSession` function:
- Executes multiple async operations sequentially (git worktree add, file I/O, terminal creation)
- No concurrency control when called rapidly
- Multiple invocations can race to create worktrees for the same branch
- Results in "fatal: worktree already exists" errors

**Race Condition Scenario:**
```typescript
// User rapidly creates session "fix-login" twice:
// Call 1: git worktree add .worktrees/fix-login fix-login (in progress...)
// Call 2: git worktree add .worktrees/fix-login fix-login (starts immediately!)
// Result: Call 2 fails with "worktree already exists"
```

### 1.2 Solution Options

#### Option A: Use `async-mutex` Package
```typescript
import { Mutex } from 'async-mutex';

const sessionCreationMutex = new Mutex();

async function createSession(...) {
    return sessionCreationMutex.runExclusive(async () => {
        // Session creation logic here
    });
}
```

**Pros:**
- Well-tested library (1M+ weekly downloads)
- Simple API
- TypeScript-first

**Cons:**
- New dependency (~8KB minzipped)
- Overkill for simple queue

#### Option B: Use `p-queue` Package
```typescript
import PQueue from 'p-queue';

const sessionQueue = new PQueue({ concurrency: 1 });

async function createSession(...) {
    return sessionQueue.add(() => {
        // Session creation logic here
    });
}
```

**Pros:**
- Popular (20M+ weekly downloads)
- Built-in timeout support
- Active maintenance

**Cons:**
- Larger package (~12KB minzipped)
- More features than needed

#### Option C: Simple Promise Queue (Zero Dependencies)
```typescript
class AsyncQueue {
    private queue: Array<() => Promise<any>> = [];
    private processing = false;

    async add<T>(task: () => Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    resolve(await task());
                } catch (err) {
                    reject(err);
                }
            });
            this.process();
        });
    }

    private async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            await task();
        }
        this.processing = false;
    }
}
```

**Pros:**
- Zero dependencies
- Full control over behavior
- Small code footprint

**Cons:**
- Must implement timeout manually
- Must test thoroughly

### 1.3 Recommendation: Option C (Simple Queue)

**Rationale:**
- Phase 1 is about critical bug fixes - minimizing new dependencies reduces risk
- The queue behavior is simple (concurrency: 1, timeout: 30s)
- Full control allows exact UX requirements (silent queue, fail-fast on duplicates)
- Can always extract to a package later if needed

**Implementation Requirements:**
1. Create `src/AsyncQueue.ts` with a simple queue class
2. Add timeout support using `Promise.race`
3. Wrap `createSession` body in queue operation
4. Check for existing worktree **before** queueing (fail-fast)
5. Only show "Creating session..." progress for current operation

---

## 2. Git Branch Name Validation

### 2.1 Problem Analysis

**Git Branch Name Rules** (from `git check-ref-format` documentation):

| Rule | Invalid Characters | Example |
|------|-------------------|---------|
| ASCII control chars | Bytes < 0x20, DEL (0x7F) | `\x00`, `\x1F` |
| Spaces | ` ` (0x20) | `my branch` |
| Special chars | `~`, `^`, `:`, `?`, `*`, `[` | `feature~test`, `bug:123` |
| Path separators | `\`, leading/trailing `.` | `.\test`, `test.`, `..` |
| Sequences | `..`, `@{`, `//` | `feature/./test`, `HEAD@{1}` |
| Lock suffix | Ending with `.lock` | `branch.lock` |

**Current State (`src/utils.ts:19-68`)**

The existing `sanitizeSessionName` function:
- Replaces invalid chars with hyphens
- Creates a "safe" version of the name
- **Problem:** Does not validate the **source branch** name
- **Problem:** Silently transforms names instead of rejecting invalid input

**The Bug:**
When viewing Git changes for branch `feature/.`, the extension:
1. Tries to compute `git merge-base feature/. HEAD`
2. Git fails because `feature/.` is not a valid ref
3. Falls back silently or shows cryptic error

### 2.2 Solution: Pre-flight Branch Validation

**Validation Function Requirements:**

```typescript
/**
 * Validates that a branch name is safe for Git operations.
 * Returns { valid: boolean, error?: string }
 */
export function validateBranchName(branch: string): ValidationResult {
    // 1. Check for ASCII control characters (including null)
    // 2. Check for spaces, ~, ^, :, ?, *, [, \
    // 3. Check for leading/trailing dots
    // 4. Check for .. or //
    // 5. Check for @{ sequences
    // 6. Check for .lock suffix
    // 7. Check for empty after validation
}
```

**Regex Approach:**

```typescript
// Characters disallowed by git-check-ref-format
const INVALID_CHARS_REGEX = /[\x00-\x1F\x7F ~^:?*\[\\]/;
const DOT_SEQUENCE_REGEX = /\.\.|\/\//;
const BRACE_SEQUENCE_REGEX = /@\{/;
const LEADING_TRAILING_DOT_REGEX = /^\.|\.$/;
const LOCK_SUFFIX_REGEX = /\.lock$/;

// All checks in one function for clarity and performance
```

### 2.3 Integration Points

**Where to Validate:**

1. **`showGitChanges` command** (extension.ts:1315)
   - Validate `item.label` (session/branch name) before calling `generateDiffContent`
   - Show error: "Branch 'feature/.' contains invalid characters..."

2. **`createSession` command** (extension.ts:1693)
   - Validate both `name` (new session) and `sourceBranch` parameters
   - Show error before any Git operations

3. **`getBaseBranch` fallback** (extension.ts:~1850)
   - When auto-detecting base branch, validate candidates

---

## 3. Merge-base Error Handling for Remote Branches

### 3.1 Problem Analysis

**Current Behavior (`extension.ts:1153-1173`)**

```typescript
async function generateDiffContent(worktreePath: string, baseBranch: string) {
    if (includeUncommitted) {
        try {
            const mergeBase = await execGit(['merge-base', baseBranch, 'HEAD'], worktreePath);
            diffArgs = ['diff', mergeBase.trim()];
        } catch (mergeBaseErr) {
            console.warn(`Lanes: Could not get merge-base for ${baseBranch}, using base branch directly:`);
            diffArgs = ['diff', baseBranch];  // Fallback
        }
    }
}
```

**Failure Scenarios:**

| Scenario | Current Behavior | User Impact |
|----------|-----------------|-------------|
| Remote branch not fetched | Falls back to `diff origin/main` | Diff against wrong commit |
| Branch doesn't exist | Falls back silently | Shows wrong changes |
| Detached HEAD | merge-base fails | Inconsistent diff |

### 3.2 Solution: Auto-fetch + Warning

**User Decision (from CONTEXT.md):**
- **Fallback:** You decide (Claude's discretion)
- **Warning:** "Using fallback diff method - merge-base unavailable"
- **Auto-fetch:** For remote branches before merge-base

**Implementation Strategy:**

```typescript
async function generateDiffContent(worktreePath: string, baseBranch: string) {
    let diffArgs: string[];

    if (includeUncommitted) {
        // Auto-fetch for remote branches
        if (baseBranch.startsWith('origin/')) {
            try {
                const remote = baseBranch.split('/')[0];  // e.g., "origin"
                const branch = baseBranch.substring(baseBranch.indexOf('/') + 1);
                await execGit(['fetch', remote, branch], worktreePath);
            } catch (fetchErr) {
                console.warn(`Lanes: Failed to fetch ${baseBranch}:`, getErrorMessage(fetchErr));
            }
        }

        try {
            const mergeBase = await execGit(['merge-base', baseBranch, 'HEAD'], worktreePath);
            diffArgs = ['diff', mergeBase.trim()];
        } catch (mergeBaseErr) {
            // Show warning notification (per user decision)
            vscode.window.showWarningMessage(
                `Using fallback diff method - merge-base unavailable for '${baseBranch}'`
            );
            // Use three-dot syntax for committed changes comparison
            diffArgs = ['diff', `${baseBranch}...HEAD`];
        }
    }

    return execGit(diffArgs, worktreePath);
}
```

**Why `baseBranch...HEAD` instead of `baseBranch`:**

| Syntax | Meaning |
|--------|---------|
| `git diff main HEAD` | Changes from main tip to current working directory |
| `git diff main...HEAD` | Committed changes since common ancestor (merge-base) |
| `git diff <merge-base>` | Changes from merge-base to current working directory |

The three-dot syntax is the best fallback because:
1. It doesn't require merge-base computation
2. It shows committed changes (same intent as merge-base approach)
3. It's a well-defined Git operation

---

## 4. Testing Strategy

### 4.1 Property-Based Testing with `fast-check`

**Library:** [fast-check](https://fast-check.dev/) (MIT license, 4.8k stars)

**Installation:**
```bash
npm install --save-dev fast-check
```

**Usage for Branch Validation:**

```typescript
import fc from 'fast-check';

suite('Branch Name Validation', () => {
    test('should reject all invalid branch names', () => {
        fc.assert(
            fc.property(
                // Generate strings that contain at least one invalid character
                fc.stringOf(fc.constantFrom(...INVALID_CHARS.concat([' ', '\x00']))),
                (invalidName) => {
                    const result = validateBranchName(invalidName);
                    return !result.valid;
                }
            )
        );
    });

    test('should accept all valid branch names', () => {
        const validCharSet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./';
        fc.assert(
            fc.property(
                fc.stringOf(fc.constantFrom(...validCharSet.split(''))),
                // Filter out edge cases like leading/trailing dots
                fc.filter(s => !s.startsWith('.') && !s.endsWith('.') && !s.includes('..')),
                (validName) => {
                    const result = validateBranchName(validName);
                    return result.valid;
                }
            )
        );
    });
});
```

### 4.2 Mocked Git Operations for Queue Testing

**Approach:** Use Sinon to mock `execGit` function

```typescript
import sinon from 'sinon';

suite('Race Condition Fixes', () => {
    test('should queue concurrent session creations', async () => {
        const execGitStub = sinon.stub(gitService, 'execGit');

        // Simulate slow worktree creation
        execGitStub
            .withArgs(sinon.match.array.includes('worktree').includes('add'))
            .callsFake(async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return '/path/to/worktree';
            });

        // Queue multiple requests
        const promises = [
            createSession('session-1', ...),
            createSession('session-2', ...),
            createSession('session-3', ...),
        ];

        await Promise.all(promises);

        // Verify sequential execution
        assert.strictEqual(execGitStub.callCount, 3);
    });
});
```

### 4.3 Regression Tests for Reported Bugs

```typescript
suite('Regression Tests', () => {
    test('bug: feature/. branch should be rejected with clear error', async () => {
        const result = validateBranchName('feature/.');
        assert.strictEqual(result.valid, false);
        assert.ok(result.error?.includes('feature/.'));
        assert.ok(result.error?.includes('invalid'));
    });

    test('bug: remote merge-base should auto-fetch', async () => {
        const fetchStub = sinon.stub(gitService, 'execGit')
            .onCall(0).resolves('abc123')  // fetch succeeds
            .onCall(1).resolves('abc123');  // merge-base succeeds

        await generateDiffContent('/path/to/worktree', 'origin/main');

        assert.ok(fetchStub.calledWith(['fetch', 'origin', 'main']));
    });

    test('bug: rapid creation should not fail', async () => {
        // Simulate rapid clicks
        const promises = Array.from({ length: 5 }, (_, i) =>
            createSession(`session-${i}`, ...)
        );

        await Promise.all(promises);

        // Should create all 5 sessions without errors
        const sessions = sessionProvider.getChildren();
        assert.strictEqual(sessions.length, 5);
    });
});
```

---

## 5. Implementation Checklist

### 5.1 Race Condition Queue

- [ ] Create `src/AsyncQueue.ts` with timeout support
- [ ] Add queue instance to `extension.ts`
- [ ] Wrap `createSession` body in `queue.add()`
- [ ] Add duplicate worktree check before queueing
- [ ] Add 30-second timeout to individual worktree creation
- [ ] Update progress indicator to show only current operation

### 5.2 Branch Name Validation

- [ ] Create `validateBranchName()` in `src/utils.ts`
- [ ] Add validation in `showGitChanges` command
- [ ] Add validation in `createSession` for `name` and `sourceBranch`
- [ ] Add clear error messages showing problematic branch name
- [ ] Write property-based tests with fast-check

### 5.3 Merge-base Error Handling

- [ ] Add auto-fetch for `origin/*` branches before merge-base
- [ ] Add warning notification on merge-base failure
- [ ] Change fallback from `diff baseBranch` to `diff baseBranch...HEAD`
- [ ] Add tests for remote branch scenarios
- [ ] Add regression test for `feature/.` branch

---

## 6. Open Questions for Planning

1. **Queue scope:** Should the queue be global (one queue for all repos) or per-repo?
   - **Recommendation:** Per-repo to allow concurrent work in different projects

2. **Timeout behavior:** When timeout occurs, should the operation continue in background?
   - **Recommendation:** No, cancel and show error to user

3. **Warning debounce:** Should merge-base warning show once per session or every time?
   - **Recommendation:** Once per VS Code session (use flag in context)

4. **Test infrastructure:** Do we add fast-check as dependency or devDependency?
   - **Recommendation:** `--save-dev` only

---

## 7. References

- [fast-check documentation](https://fast-check.dev/)
- [git-check-ref-format(1)](https://git-scm.com/docs/git-check-ref-format)
- [async-mutex npm](https://www.npmjs.com/package/async-mutex)
- [p-queue npm](https://github.com/sindresorhus/p-queue)
- [Property-based testing guide](https://medium.com/@joaovitorcoelho10/fast-check-a-comprehensive-guide-to-property-based-testing-2c166a979818)

---

*Research completed: 2026-02-08*
*Next step: Create PLAN.md with detailed task breakdown*
