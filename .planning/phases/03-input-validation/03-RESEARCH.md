# Phase 3: Input Validation - Research

**Researched:** 2026-02-08
**Domain:** TypeScript/VS Code Extension Security
**Confidence:** HIGH

## Summary

Phase 3 focuses on hardening security through comprehensive input validation. The codebase already has partial validation infrastructure (ValidationError from Phase 2, sanitizeSessionName, validateBranchName), but several critical gaps remain. The primary risk areas are session name handling (path traversal attacks), configuration value validation (missing schema enforcement), and inconsistent validation patterns across user input points.

**Primary recommendation:** Create a centralized `src/validation/` module with composable validators, integrate ValidationError into all user input paths, and add comprehensive security test coverage for path traversal scenarios.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 (existing) | Type-safe validation | Already in use, provides strict type checking |
| Node.js `path` module | Built-in | Path sanitization and resolution | Standard for cross-platform path handling |
| Phase 2 ValidationError | Existing | Error reporting | Already established pattern from Phase 2 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| VS Code Configuration API | Built-in | Schema validation for settings | For runtime config validation |
| yaml | 2.8.2 (existing) | Workflow template validation | Already in use, has type guards |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom validators | `zod` or `yup` | External validation libraries add 30-60KB, overkill for simple string validation. Built-in TypeScript + custom validators are lighter and sufficient. |
| Regex validation | `validator.js` | Too generic (email, URL focused). Git branch rules are domain-specific, require custom regex anyway. |
| Runtime type checking | `io-ts` | Overkill. VS Code configuration schema + TypeScript compilation provides sufficient type safety. |

**Installation:**
No new dependencies required. All validation can be built with:
- TypeScript 5.9.3 (existing)
- Node.js built-ins (path, URL parsing)
- Phase 2 error infrastructure (ValidationError, LanesError)

## Architecture Patterns

### Recommended Project Structure
```
src/
├── validation/
│   ├── index.ts           # Barrel file, public API
│   ├── validators.ts      # Core validator functions
│   ├── schemas.ts         # VS Code config schema definitions
│   └── pathSanitizer.ts   # Path security utilities
├── errors/
│   └── ValidationError.ts # Existing from Phase 2
└── utils.ts               # Existing: sanitizeSessionName, validateBranchName
```

### Pattern 1: Centralized Validator Module

**What:** Create `src/validation/` with pure validation functions that return `ValidationResult` or throw `ValidationError`.

**When to use:** All user-facing input that could be malicious or malformed.

**Example:**
```typescript
// src/validation/validators.ts

import { ValidationError } from '../errors';
import type { ValidationResult } from '../utils';

/**
 * Validates a session name for security and Git compatibility.
 * - Checks for path traversal (..)
 * - Checks for null bytes
 * - Checks for excessive length
 * - Returns ValidationResult for compatibility with existing code
 */
export function validateSessionName(name: string): ValidationResult {
    if (!name || name.trim().length === 0) {
        return { valid: false, error: 'Session name cannot be empty' };
    }

    const trimmed = name.trim();

    // Security: Path traversal detection
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: `Session name '${escapedSubstring(trimmed)}' contains path traversal sequences (..)`
        };
    }

    // Security: Null byte detection
    if (trimmed.includes('\x00')) {
        return {
            valid: false,
            error: 'Session name contains invalid characters'
        };
    }

    // Length limit (Git branch refs have practical limits)
    if (trimmed.length > 200) {
        return {
            valid: false,
            error: 'Session name is too long (max 200 characters)'
        };
    }

    return { valid: true };
}

/**
 * Validates a file path to ensure it stays within expected bounds.
 * Used for workflow paths, prompts folder, etc.
 */
export function validateRelativePath(
    path: string,
    options: { allowTraversal?: boolean; allowAbsolute?: boolean } = {}
): ValidationResult {
    const { allowTraversal = false, allowAbsolute = false } = options;

    if (!path || path.trim().length === 0) {
        return { valid: false, error: 'Path cannot be empty' };
    }

    const trimmed = path.trim();

    // Check for path traversal unless explicitly allowed
    if (!allowTraversal && trimmed.includes('..')) {
        return {
            valid: false,
            error: 'Path cannot contain parent directory references (..)'
        };
    }

    // Check for absolute paths unless explicitly allowed
    if (!allowAbsolute && path.isAbsolute(trimmed)) {
        return {
            valid: false,
            error: 'Absolute paths are not allowed for this setting'
        };
    }

    return { valid: true };
}
```

### Pattern 2: VS Code Configuration Schema Validation

**What:** Use VS Code's configuration schema for runtime validation of settings.

**When to use:** All configuration values from `package.json` contributes.configuration.

**Example:**
```typescript
// src/validation/schemas.ts

/**
 * Validates the lanes.worktreesFolder configuration value.
 * Ensures the folder name doesn't contain path traversal or invalid characters.
 */
export function validateWorktreesFolder(value: unknown): ValidationResult {
    if (typeof value !== 'string') {
        return { valid: false, error: 'worktreesFolder must be a string' };
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return { valid: false, error: 'worktreesFolder cannot be empty' };
    }

    if (trimmed !== value) {
        return { valid: false, error: 'worktreesFolder cannot have leading/trailing whitespace' };
    }

    // Security: Reject path traversal
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: 'worktreesFolder cannot contain .. (path traversal not allowed)'
        };
    }

    // Reject characters invalid for directory names
    const INVALID_CHARS = /[<>:"|?*\x00-\x1F]/;
    if (INVALID_CHARS.test(trimmed)) {
        return {
            valid: false,
            error: 'worktreesFolder contains invalid characters'
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.localSettingsPropagation configuration value.
 * Only allows the three documented enum values.
 */
export function validateLocalSettingsPropagation(value: unknown): ValidationResult {
    const VALID_VALUES = ['copy', 'symlink', 'disabled'] as const;

    if (typeof value !== 'string') {
        return { valid: false, error: 'localSettingsPropagation must be a string' };
    }

    if (!VALID_VALUES.includes(value as typeof VALID_VALUES[number])) {
        return {
            valid: false,
            error: `localSettingsPropagation must be one of: ${VALID_VALUES.join(', ')}`
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.promptsFolder configuration value.
 * Allows empty string (global storage) or relative paths without traversal.
 */
export function validatePromptsFolder(value: unknown): ValidationResult {
    if (typeof value !== 'string') {
        return { valid: false, error: 'promptsFolder must be a string' };
    }

    const trimmed = value.trim();

    // Empty string is valid (means use global storage)
    if (trimmed.length === 0) {
        return { valid: true };
    }

    // Reject path traversal even in custom paths
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: 'promptsFolder cannot contain .. (path traversal not allowed)'
        };
    }

    return { valid: true };
}
```

### Pattern 3: Input Sanitization (Not Just Validation)

**What:** Distinguish between validation (reject bad input) vs sanitization (transform to safe).

**When to use:** Sanitization for display names, validation for identifiers/paths.

**Example:**
```typescript
// src/validation/pathSanitizer.ts

import * as path from 'path';

/**
 * Sanitizes a user-provided session name for display.
 * Unlike validateSessionName, this transforms input rather than rejecting.
 *
 * Use case: User types "Fix Login Bug" -> display shows "Fix-Login-Bug"
 * BUT the actual branch is validated and must already be valid.
 */
export function sanitizeForDisplay(input: string): string {
    return input
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-./]/g, '')
        .substring(0, 50);
}

/**
 * Resolves a relative path against a base path, ensuring no traversal.
 * Returns null if path would escape base directory.
 */
export function safeResolve(basePath: string, relativePath: string): string | null {
    const resolved = path.resolve(basePath, relativePath);
    const normalizedResolved = path.normalize(resolved);
    const normalizedBase = path.normalize(basePath);

    // Check if resolved path is within base path
    if (!normalizedResolved.startsWith(normalizedBase)) {
        return null; // Path traversal detected
    }

    return normalizedResolved;
}
```

### Anti-Patterns to Avoid

- **Silent sanitization without validation:** Don't transform malicious input and continue. Validate first, sanitize only for display.
- **Inconsistent error types:** Don't mix `return {valid: false}` with `throw new Error()`. Use ValidationResult or ValidationError consistently.
- **Trusting VS Code configuration blindly:** VS Code settings can be edited directly in settings.json. Always validate enum strings and paths.
- **Regex-only validation:** Git branch rules are complex. Combine regex with semantic checks (length, special cases).
- **Client-side only validation:** Webview inputs can be bypassed. Validate on the extension side (server-side equivalent).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema validation | Custom JSON schema validator | VS Code Configuration API | VS Code already validates against package.json schema at runtime |
| Path sanitization | Manual string manipulation | Node.js `path` module | Handles Windows/Unix differences, edge cases like `//`, `..` resolution |
| HTML escaping | Custom escape function | VS Code webview `asWebviewUri()` | Built-in CSP-compliant URI handling |
| YAML parsing | Custom YAML validator | Existing `yaml` library + type guards | Already in use for workflows, proven pattern |

**Key insight:** The codebase already uses the right patterns (yaml library, path module). The issue is inconsistent application, not missing libraries.

## Common Pitfalls

### Pitfall 1: Path Traversal in Session Names

**What goes wrong:** User creates session named `../../etc/passwd`. The extension constructs paths using `path.join(base, sessionName)` which resolves outside the workspace.

**Why it happens:** Existing `sanitizeSessionName()` returns empty string for `..` sequences, but the calling code doesn't always check for empty return value.

**How to avoid:**
1. Always validate before using session name in paths
2. Use `safeResolve()` helper that checks for escape
3. Throw ValidationError when validation fails, don't silently sanitize

**Warning signs:**
- `path.join(base, userInput)` without validation
- Returning empty string from sanitization without error check
- Assuming "sanitize = safe" (malicious input shouldn't be transformed, it should be rejected)

### Pitfall 2: Configuration Value Trust

**What goes wrong:** VS Code settings are defined in package.json with enum values, but users can edit settings.json directly with arbitrary strings.

**Why it happens:** VS Code validates against schema only in the UI editor. Direct file edits bypass validation.

**How to avoid:**
1. Add runtime validation for all config reads using `getConfiguration()`
2. Validate enum strings against allowlist
3. Provide safe fallbacks for invalid values

**Warning signs:**
- `config.get<T>('key')` without type checking the result
- Assuming enum setting can only be one of the documented values
- No fallback for corrupted/malicious settings

### Pitfall 3: Webview Message Injection

**What goes wrong:** Webview (SessionFormProvider) sends user input via `postMessage()`. Malicious input could include HTML/JS if not properly handled.

**Why it happens:** The webview uses `innerText` for display (safe), but message values are used directly in file paths.

**How to avoid:**
1. Validate all message fields on extension side
2. Never trust client-side validation only
3. Use Content Security Policy (already present)

**Warning signs:**
- Using webview input directly in `path.join()`
- Assuming webview context isolation is sufficient
- Missing CSP headers

### Pitfall 4: Git Branch Name Edge Cases

**What goes wrong:** Branch names like `feature/.`, `feature/*`, `@{unhooked}` pass sanitization but fail Git operations.

**Why it happens:** Git branch rules are complex (see `git check-ref-format`). Simple regex misses cases.

**How to avoid:**
1. Use existing `validateBranchName()` from utils.ts (already comprehensive)
2. Test against actual Git ref format rules
3. Pre-validate before Git operations

**Warning signs:**
- Custom branch validation instead of using existing comprehensive function
- Not testing against Git's actual error messages
- Assuming "looks like a branch name" = "valid branch name"

## Code Examples

Verified patterns from existing codebase:

### Example 1: Existing ValidationResult Pattern (HIGH confidence)

**Source:** `/src/utils.ts:9-14`

```typescript
export interface ValidationResult {
    valid: boolean;
    error?: string;
}
```

**Usage:** This is the established pattern from Phase 2. All new validators should return this type or throw `ValidationError` for consistency.

### Example 2: Existing Branch Validation (HIGH confidence)

**Source:** `/src/utils.ts:95-164`

```typescript
export function validateBranchName(branch: string): ValidationResult {
    if (!branch) {
        return { valid: false, error: 'Branch name cannot be empty' };
    }

    // Check for ASCII control characters (including DEL 0x7F)
    const INVALID_CHARS_REGEX = /[\x00-\x1F\x7F ~^:?*[\]\\]/;
    if (INVALID_CHARS_REGEX.test(branch)) {
        return {
            valid: false,
            error: `Branch '${branch}' contains invalid characters. Worktrees cannot be created from this branch.`
        };
    }

    // ... additional checks for leading/trailing dots, .. sequences, @{, .lock

    return { valid: true };
}
```

**Usage:** This is comprehensive Git branch validation. Reuse for all branch/session name validation.

### Example 3: Existing Permission Mode Validation (HIGH confidence)

**Source:** `/src/SessionFormProvider.ts:20-22`

```typescript
export function isValidPermissionMode(mode: unknown): mode is PermissionMode {
    return typeof mode === 'string' && PERMISSION_MODES.includes(mode as PermissionMode);
}
```

**Usage:** Type guard pattern for enum validation. Use similar pattern for other enum config values.

### Example 4: Existing Path Security Check (HIGH confidence)

**Source:** `/src/test/configuration.test.ts:1072-1085` (test documenting security behavior)

```typescript
test('should return null for sessionName containing path traversal (..)', async () => {
    // Act: Try to use a malicious session name
    const result = getPromptsPath('../../../etc/passwd', tempDir);

    // Assert: Should return null (security)
    assert.strictEqual(result, null, 'Should return null for session name with path traversal');
});
```

**Usage:** The codebase already has security tests. Continue this pattern for all user input paths.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sanitize silently | Validate and reject | Phase 2 (2026-02-08) | Users get clear errors instead of transformed invalid input |
| Return null on error | Throw ValidationError | Phase 2 (2026-02-08) | Consistent error handling, no more lost error context |
| No config validation | Runtime config validation | Phase 3 (proposed) | Prevents malicious/corrupted settings from breaking extension |

**Current best practices (2026):**
- **Fail-fast validation:** Reject invalid input immediately with clear error
- **Security-first defaults:** Reject rather than transform for security-relevant inputs
- **Type guards for enums:** Use TypeScript type guards for enum validation
- **Centralized validators:** Don't duplicate validation logic across files

**Deprecated/outdated:**
- **Silent sanitization:** Transforming `../../etc` to `etc` without warning (hides security issues)
- **Trusting VS Code schema:** Assuming settings.json can only contain valid values (users can edit directly)
- **Client-side only validation:** Webview validation without extension-side verification

## Open Questions

1. **Session name character set:**
   - What we know: Existing `sanitizeSessionName()` allows letters, numbers, hyphens, underscores, dots, forward slashes
   - What's unclear: Should we be more restrictive? Slashes in session names create nested directories which might be unexpected
   - Recommendation: Keep current character set but validate path traversal more strictly. Slashes are useful for `feature/sub-feature` naming patterns.

2. **Configuration migration strategy:**
   - What we know: Invalid config values currently cause crashes or silent failures
   - What's unclear: Should we auto-fix invalid values or show error and require user action?
   - Recommendation: For Phase 3, validate and show error. Auto-migration could be Phase 4 (Security Auditing) or a separate enhancement.

3. **Workflow path validation scope:**
   - What we know: Workflows can be built-in (extension path) or custom (workspace path)
   - What's unclear: Should we restrict custom workflow locations to `.lanes/workflows/` only?
   - Recommendation: Allow workspace-relative paths but validate no path traversal. Built-in workflows are extension-protected (read-only).

## Sources

### Primary (HIGH confidence)
- `/src/utils.ts` - Existing sanitizeSessionName, validateBranchName, ValidationResult pattern
- `/src/errors/ValidationError.ts` - Phase 2 error pattern
- `/src/SessionFormProvider.ts` - Permission mode validation pattern, webview message handling
- `/src/test/configuration.test.ts` - Path security tests (lines 1070-1233)
- `/src/test/branchValidation.test.ts` - Comprehensive Git branch validation tests
- `/src/test/sanitization.test.ts` - Session name sanitization test coverage
- `/package.json` - Configuration schema definitions

### Secondary (MEDIUM confidence)
- Git `check-ref-format` documentation (via existing validateBranchName implementation)
- VS Code Configuration API documentation (existing usage patterns)

### Tertiary (LOW confidence)
- None - all findings verified against existing codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - No new dependencies needed, all patterns exist in codebase
- Architecture: HIGH - Existing validation infrastructure (Phase 2) provides solid foundation
- Pitfalls: HIGH - Security tests already document path traversal concerns

**Research date:** 2026-02-08
**Valid until:** 2026-04-08 (stable domain - input validation patterns are well-established)
