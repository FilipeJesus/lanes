# Phase 4: Security Auditing - Research

**Researched:** 2026-02-08
**Domain:** Node.js Security Auditing / VS Code Extension Security
**Confidence:** HIGH

## Summary

Phase 4 focuses on security auditing of two critical attack surfaces: file system operations (SEC-04) and external command execution (SEC-05). The codebase has already implemented comprehensive input validation in Phase 3, including path traversal protection through `safeResolve()`, session name validation, and configuration schema validators. This phase involves systematic auditing to ensure all existing code uses these security mechanisms consistently, with particular attention to git command execution via `child_process.spawn()` and file system operations involving user-provided paths.

**Primary recommendation:** Conduct a systematic security audit creating a comprehensive audit report document that catalogs all file system operations and command execution points, validates their security properties, and documents any gaps found. Use the existing validation infrastructure from Phase 3 as the security baseline.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `path` module | Built-in | Path manipulation and normalization | Standard for cross-platform path handling |
| `child_process.spawn` | Built-in | Git command execution | Already in use, secure when used correctly (array args, no shell) |
| Phase 3 validation module | Existing | Input validation and path security | Provides `safeResolve()`, validators for all user inputs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `fs.promises` | Built-in | Async file system operations | Preferred for all file I/O (MAINT-04) |
| VS Code URI API | Built-in | Webview URI handling | For webview content (asWebviewUri) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual audit checklist | Static analysis tools (ESLint security plugins, CodeQL) | External tools add complexity and setup. Manual audit is more thorough for a focused codebase. |
| Reviewing each file | Automated security scanning | Automated scans miss contextual security issues. Manual review with checklist is more comprehensive. |
| Custom audit documentation | Security audit frameworks | Frameworks are overkill for small audit. Simple markdown report is sufficient. |

**Installation:**
No new dependencies required. Audit is a review and documentation process using existing tooling.

## Architecture Patterns

### Security Audit Structure

The audit should examine the codebase in two dimensions:

1. **File System Operations Audit (SEC-04)**
   - All uses of `fs`, `fs/promises`, `path.join()`, `path.resolve()`
   - Path operations with user-provided input
   - File read/write operations
   - Directory traversal/creation operations

2. **Command Execution Audit (SEC-05)**
   - All uses of `child_process.spawn()`, `exec()`, `execSync()`
   - Git command invocation points
   - Argument construction and passing
   - Shell usage (should be `shell: false` or absent)

### Recommended Audit Report Structure

```
.planning/phases/04-security-auditing/
├── 04-RESEARCH.md          # This file
├── 04-01-PLAN.md           # Execution plan
├── SECURITY-AUDIT-REPORT.md # The actual audit report (output)
└── 04-VERIFICATION.md      # Verification of audit findings
```

### Audit Checklist Pattern

**What:** A systematic checklist applied to each file system or command operation.

**When to use:** For auditing every operation in the codebase.

**Example (File System Operation):**
```typescript
// Audit Question: Does this fs operation use validated user input?

// GOOD: Input validated before use
const validation = validateSessionName(userInput);
if (!validation.valid) {
  throw new ValidationError('sessionName', userInput, validation.error);
}
const safePath = safeResolve(baseRepoPath, userInput);
if (!safePath) {
  throw new ValidationError('sessionName', userInput, 'Path traversal detected');
}
await fs.promises.mkdir(safePath);

// BAD: Unvalidated input used in path construction
const dangerousPath = path.join(baseRepoPath, userInput); // What if userInput = '../../../etc'?
await fs.promises.mkdir(dangerousPath); // SECURITY ISSUE
```

**Example (Command Execution):**
```typescript
// Audit Question: Does this spawn call use proper argument passing?

// GOOD: Array arguments, no shell, validated inputs
const validatedBranch = validateBranchName(userBranch);
if (!validatedBranch.valid) {
  throw new ValidationError('branch', userBranch, validatedBranch.error);
}
await execGit(['worktree', 'add', worktreePath, sanitizedBranch], repoRoot);

// BAD: String concatenation in command (potential injection)
await execGit(`worktree add ${worktreePath} ${userBranch}`, repoRoot); // SECURITY ISSUE

// BAD: Using exec with user input (shell interpretation)
const { exec } = require('child_process');
exec(`git ${userCommand}`, (err, stdout, stderr) => { ... }); // SECURITY ISSUE
```

### Audit Scoring System

Each audited operation receives one of these classifications:

| Classification | Meaning | Action Required |
|----------------|---------|-----------------|
| **SECURE** | Uses proper validation, no issues found | None |
| **ACCEPTABLE** | Minor issues, low risk, existing mitigations | Document, consider improvement |
| **NEEDS_REVIEW** | Potential issue, needs investigation | Create task for investigation |
| **VULNERABLE** | Clear security vulnerability | Create task for remediation |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path validation | Custom security checks | Phase 3 `safeResolve()` and validators | Already tested, handles edge cases |
| Command escaping | Manual escaping logic | Array arguments to `spawn()` | No shell = no escaping needed |
| Audit documentation | Custom audit format | Simple markdown checklist | Easy to review, no toolchain required |
| Static analysis | Custom grep scripts | Existing Grep tool usage patterns | Already familiar workflow |

**Key insight:** The security infrastructure exists from Phase 3. The audit is about verification and consistency, not building new security mechanisms.

## Common Pitfalls

### Pitfall 1: Assuming Validation is Complete

**What goes wrong:** Phase 3 added validation to new code paths, but existing code may still use unvalidated input.

**Why it happens:** Validation was added to specific functions, but not systematically to all input points.

**How to avoid:**
1. Audit EVERY file system operation, not just obvious ones
2. Trace data flow from user input to file operation
3. Check if validation exists anywhere in the call chain

**Warning signs:**
- `path.join(base, userInput)` without checking validation status
- Using `sanitizeSessionName()` return value without checking for empty string
- Session/branch names used directly without validation

### Pitfall 2: Shell Execution with User Input

**What goes wrong:** Using `exec()` or `shell: true` with user-provided arguments enables command injection.

**Why it happens:** Convenience of string-based commands, not understanding the risk.

**How to avoid:**
1. Always use `spawn()` with array arguments
2. Never set `shell: true` unless absolutely necessary
3. Validate all arguments before passing to spawn

**Warning signs:**
- String concatenation in command construction
- Using `exec()` with user input
- `shell: true` option in spawn calls

### Pitfall 3: Incomplete Path Traversal Protection

**What goes wrong:** `path.resolve()` or `path.normalize()` alone doesn't prevent all traversal attacks.

**Why it happens:** Developer assumes normalization is sufficient validation.

**How to avoid:**
1. Use `safeResolve()` from Phase 3 which checks if result is within base
2. Validate input strings for `..` sequences before path operations
3. Check the normalized result starts with the expected base path

**Warning signs:**
- Using `path.resolve()` without boundary checking
- Assuming normalized paths are "safe"
- No check for `..` in user input before path operations

### Pitfall 4: Git Command Argument Injection

**What goes wrong:** Git arguments can include options that change behavior (e.g., `--git-dir=/etc/passwd`).

**Why it happens:** Treating git as a simple command without understanding its argument structure.

**How to avoid:**
1. Validate branch names against Git ref format rules
2. Never pass arbitrary user input as git options
3. Use array arguments to prevent option injection

**Warning signs:**
- User input directly in git argument arrays
- No validation of git ref format
- Allowing user to specify git options

## Code Examples

### Current Secure Pattern (from gitService.ts) - HIGH confidence

**Source:** `/src/gitService.ts:70-103`

```typescript
export function execGit(args: string[], cwd: string, options?: ExecGitOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        const spawnOptions: { cwd: string; env?: NodeJS.ProcessEnv } = { cwd };

        // Merge custom env vars with existing process env
        if (options?.env) {
            spawnOptions.env = { ...process.env, ...options.env };
        }

        const childProcess = spawn(gitPath, args, spawnOptions);
        // ... error handling
    });
}
```

**Security properties:**
- Uses `spawn()` (not `exec()`)
- No `shell` option (defaults to `false`)
- Arguments passed as array (no shell interpretation)
- This is the correct pattern for secure command execution

### Current Secure Pattern (from validation/pathSanitizer.ts) - HIGH confidence

**Source:** `/src/validation/pathSanitizer.ts:49-66`

```typescript
export function safeResolve(basePath: string, relativePath: string): string | null {
    const resolved = path.resolve(basePath, relativePath);
    const normalizedResolved = path.normalize(resolved);
    const normalizedBase = path.normalize(basePath);

    // Check if the resolved path starts with the base path
    if (!normalizedResolved.startsWith(normalizedBase)) {
        return null; // Path traversal detected
    }

    return normalizedResolved;
}
```

**Security properties:**
- Normalizes both paths before comparison
- Returns null for traversal attempts (fail-safe)
- This is the correct pattern for secure path operations

### Pattern to Avoid - Unvalidated File Operations

```typescript
// BAD: User input used directly in file operation
async function createSession(sessionName: string, repoPath: string) {
    const worktreePath = path.join(repoPath, '.worktrees', sessionName);
    // What if sessionName = '../../../etc/passwd'?
    await fs.promises.mkdir(worktreePath, { recursive: true });
}
```

**Correct approach:**
```typescript
// GOOD: Validate before use
async function createSession(sessionName: string, repoPath: string) {
    const validation = validateSessionName(sessionName);
    if (!validation.valid) {
        throw new ValidationError('sessionName', sessionName, validation.error);
    }
    const worktreePath = path.join(repoPath, '.worktrees', sessionName);
    // Additional protection: safeResolve
    const safePath = safeResolve(path.join(repoPath, '.worktrees'), sessionName);
    if (!safePath) {
        throw new ValidationError('sessionName', sessionName, 'Path traversal detected');
    }
    await fs.promises.mkdir(safePath, { recursive: true });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Silent sanitization | Validate and reject | Phase 3 (2026-02-08) | Security issues are explicit, not hidden |
| Manual path checks | Centralized `safeResolve()` | Phase 3 (2026-02-08) | Consistent path traversal protection |
| No config validation | Runtime config validation | Phase 3 (2026-02-08) | Malicious settings rejected at runtime |

**Current best practices (2026):**
- **Array arguments to spawn():** No shell = no injection risk
- **Validate then use:** Validate all input before using in operations
- **Fail-safe returns:** `safeResolve()` returns `null` for suspicious input
- **Defense in depth:** Validate at input boundary AND verify before use

**Recent security vulnerabilities to consider:**
- **CVE-2024-27980:** `child_process` command injection on Windows (Windows-specific batch file handling)
- **CVE-2025-27210:** Node.js path traversal on Windows (reserved device names)
- **CVE-2025-27209:** Related HashDoS vulnerability via path traversal

**Deprecated/outdated:**
- Using `exec()` with user input (never safe)
- `shell: true` option (unnecessary for git commands)
- Assuming normalized paths are safe (must verify boundary)

## Open Questions

1. **Audit scope boundaries:**
   - What we know: Audit should cover file system operations and command execution
   - What's unclear: Should we audit VS Code API usage? (e.g., `executeCommand()`)
   - Recommendation: Focus on SEC-04 and SEC-05 as defined. VS Code API calls are generally safe as they run in the extension host, not a shell. Document but don't treat as high-risk.

2. **Third-party dependencies:**
   - What we know: The codebase uses minimal dependencies (@modelcontextprotocol/sdk, yaml)
   - What's unclear: Should Phase 4 include dependency vulnerability scanning?
   - Recommendation: Out of scope for this phase. Dependency security is ongoing (npm audit), not a one-time audit task. Focus on application-level code.

3. **Remediation priority:**
   - What we know: Audit will find issues of varying severity
   - What's unclear: Should all findings be fixed in Phase 4?
   - Recommendation: Classify findings by severity. Critical/vulnerable must be fixed in Phase 4. Acceptable issues can be documented for future phases.

4. **Test coverage for audit findings:**
   - What we know: Phase 3 added 69 security tests
   - What's unclear: Should Phase 4 add tests for all audited operations?
   - Recommendation: Add tests for any operations that currently lack security test coverage. Focus on high-risk operations.

## Sources

### Primary (HIGH confidence)

**Internal codebase analysis:**
- `/src/gitService.ts` - Git command execution via spawn()
- `/src/validation/pathSanitizer.ts` - Path security utilities (safeResolve)
- `/src/validation/validators.ts` - Session name, branch name validators
- `/src/validation/schemas.ts` - Configuration validators
- `/src/extension.ts` - File system operations, session creation
- `/src/ClaudeSessionProvider.ts` - Path operations for session management
- `/src/mcp/tools.ts` - MCP server file operations
- `/src/mcp/server.ts` - MCP server command-line argument handling
- `/src/localSettings.ts` - File copy and symlink operations
- `/src/utils.ts` - sanitizeSessionName, validateBranchName

**Official documentation:**
- [Node.js Security Best Practices](https://nodejs.org/en/learn/getting-started/security-best-practices)
- [Node.js child_process documentation](https://node.org/api/child_process.html)
- [OWASP Node.js Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html)

### Secondary (MEDIUM confidence)

**Community security resources:**
- [Node.js Security Checklist - RisingStack](https://blog.risingstack.com/node-js-security-checklist/)
- [Node.js Path Traversal Guide - StackHawk](https://www.stackhawk.com/blog/node-js-path-traversal-guide-examples-and-prevention/)
- [Secure JavaScript coding practices - nodejs-security.com](https://www.nodejs-security.com/blog/secure-javascript-coding-practices-against-command-injection-vulnerabilities)
- [Argument injection when using Git - Snyk](https://snyk.io/blog/argument-injection-when-using-git-and-mercurial/)

**Security advisories:**
- [CVE-2024-27980: child_process RCE vulnerability](https://www.sentinelone.com/vulnerability-database/cve-2024-27980/)
- [CVE-2025-27210: Node.js path traversal on Windows](https://zeropath.com/blog/cve-2025-27210-nodejs-path-traversal-windows)

### Tertiary (LOW confidence)

- General web search results for VS Code extension security (mostly focused on malicious extension detection, not development security)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies, patterns well-established
- Architecture: HIGH - Existing validation infrastructure provides clear security baseline
- Pitfalls: HIGH - Well-documented common issues, CVE examples available
- Code examples: HIGH - All examples verified against actual codebase

**Research date:** 2026-02-08
**Valid until:** 2026-05-08 (security domain - best practices evolve, but fundamentals are stable)

**Files analyzed for this research:**
- Source files: 15 TypeScript modules
- Test files: Reviewed existing security tests
- Configuration: package.json, REQUIREMENTS.md
- Previous phase research: 03-input-validation/03-RESEARCH.md
