# Coding Conventions

**Analysis Date:** 2026-02-10

## Naming Patterns

**Files:**
- PascalCase for provider/service classes: `ClaudeSessionProvider.ts`, `SessionFormProvider.ts`, `FileService.ts`
- camelCase for utilities: `gitService.ts`, `utils.ts`, `watchers.ts`
- camelCase for test files: `asyncQueue.test.ts`, `brokenWorktree.test.ts`, `validation.test.ts`
- kebab-case with hyphens in domain-specific names: `extension-hook-script.test.ts`, `previous-session-provider.test.ts`

**Functions:**
- camelCase for all functions: `sanitizeSessionName()`, `getErrorMessage()`, `validateBranchName()`
- Exported utility functions use camelCase: `readJson()`, `writeJson()`, `ensureDir()`
- Async functions use camelCase: `getBaseRepoPath()`, `saveSessionWorkflow()`, `validateWorkflow()`

**Variables:**
- camelCase for constants and variables: `globalStorageUri`, `baseRepoPathForStorage`, `previousIconState`
- UPPER_SNAKE_CASE for semantic constants: `DEFAULT_WORKTREES_FOLDER`, `VALID_STATUS_VALUES`, `NON_GLOBAL_SESSION_PATH`
- Map/Set instance names indicate type: `previousIconState = new Map<string, string>()`

**Types:**
- PascalCase for interfaces and types: `ClaudeStatus`, `ClaudeSessionData`, `ValidationResult`, `TempDirResult`
- Suffix descriptive qualifiers: `...Result`, `...Options`, `...Data`, `...Item`, `...State`
- Union types for states: `type ClaudeStatusState = 'working' | 'waiting_for_user' | 'idle' | 'error'`

## Code Style

**Formatting:**
- 4-space indentation (via TypeScript/ESLint configuration)
- No Prettier config enforced; ESLint handles formatting rules
- Consistent semicolon usage (enforced by `semi: "warn"`)
- Curly braces required for control flow (enforced by `curly: "warn"`)

**Linting:**
- ESLint with typescript-eslint plugin (`eslint.config.mjs`)
- Rules configured for production code:
  - `@typescript-eslint/naming-convention`: Enforce camelCase/PascalCase for imports
  - `eqeqeq: "warn"`: Require === and !== (not == or !=)
  - `no-throw-literal: "warn"`: Don't throw strings, throw Error objects
  - **`no-restricted-syntax: "error"`**: Ban synchronous fs methods (fsSync) - promoted to error, mandatory use of `fs/promises` with async/await
- Test files exempt from sync fs ban (allow `fs.mkdtempSync()` for setup, etc.)

## Import Organization

**Order:**
1. Node/built-in modules: `import * as vscode from 'vscode'`, `import * as path from 'path'`, `import * as fs from 'fs/promises'`
2. Local services and providers: `import { ClaudeSessionProvider } from './ClaudeSessionProvider'`, `import * as SettingsService from './services/SettingsService'`
3. Utilities and helpers: `import { getErrorMessage } from './utils'`, `import { fileExists, readJson } from './services/FileService'`
4. Type definitions and enums: `import type { ServiceContainer } from './types/serviceContainer'`
5. Grouped side-effect imports: `import { registerAllCommands } from './commands'`, `import { registerWatchers } from './watchers'`

**Path Aliases:**
- Relative imports used throughout; no path aliases configured
- Service modules grouped under `./services/` directory
- Type definitions in `./types/` directory
- Test utilities in `./test/` directory with subdirectories by category: `./test/core/`, `./test/config/`, `./test/git/`, `./test/session/`, `./test/workflow/`, `./test/integration/`

## Error Handling

**Patterns:**
- Discriminated union error types via `LanesError` base class: `GitError`, `ValidationError`, with `kind` property enabling type narrowing
- Error kinds: `'git'`, `'validation'`, `'filesystem'`, `'config'` (latter two reserved for future phases)
- All custom errors extend `LanesError` and implement `kind` property for type discrimination
- Use `instanceof` checks combined with `kind` property: `if (error instanceof GitError) { ... }`

**Error Handling in Functions:**
```typescript
// FileService pattern: ENOENT-safe reads
export async function readJson<T>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;  // File doesn't exist - return null, not error
        }
        throw err;  // Other errors are re-thrown
    }
}
```

**Error Messages:**
- `userMessage` property on `LanesError` provides user-friendly message for UI display
- Internal `message` property may contain technical details
- Never expose raw error details in user messages
- Example from validation: `ValidationError` truncates values over 100 chars with `...` for security

## Logging

**Framework:** `console` (VS Code's built-in)

**Patterns:**
- `console.log()` for informational messages: `console.log('Congratulations, "Lanes" is now active!')`
- `console.error()` for error conditions: `console.error('Lanes: Error checking for broken worktrees:', getErrorMessage(err))`
- `console.warn()` for warnings: `console.warn('Lanes: Invalid session name for prompts path')`
- Prefix with "Lanes:" for extension-specific messages: `'Lanes: Invalid worktreesFolder configuration'`
- Log at activation and during critical path operations (worktree detection, service initialization)

## Comments

**When to Comment:**
- JSDoc comments on all public functions and exported types (required)
- Inline comments for complex logic, especially security-sensitive code
- Comments explaining WHY, not WHAT: `// Check for path traversal attempts` (not `// Check for .. pattern`)
- Comments on non-obvious patterns: `// Track if we're in a worktree - we'll use this to auto-resume session after setup`

**JSDoc/TSDoc:**
- Function JSDoc includes `@param`, `@returns`, `@example` tags
- Example format:
```typescript
/**
 * Sanitize a session name to be a valid git branch name.
 * Git branch naming rules:
 * - Allowed: letters, numbers, hyphens, underscores, dots, forward slashes
 * - Cannot start with '-', '.', or '/'
 *
 * @param name The raw session name from user input
 * @returns Sanitized name safe for git branches, or empty string if nothing valid remains
 */
export function sanitizeSessionName(name: string): string {
```
- Interface/type JSDoc describes purpose and usage
- Class JSDoc documents class purpose and responsibilities

## Function Design

**Size:**
- Functions kept relatively small and focused; preference for composability
- Complex logic broken into private helper functions or service methods
- Service classes organize related operations: `FileService` for file I/O, `SessionService` for session creation, etc.

**Parameters:**
- Prefer specific parameters over options objects for common cases
- Use options objects for 3+ optional parameters: `interface ValidateRelativePathOptions { ... }`
- Type parameters on generic functions: `readJson<T>(filePath: string): Promise<T | null>`
- Async functions explicitly marked with `async` keyword

**Return Values:**
- Functions return specific types, not generic `any`
- Nullable returns documented: `getPromptsPath(...): { path: string; needsDir: string } | null`
- Async functions return `Promise<T>` or `Promise<void>`
- Null return indicates "value not found" (ENOENT for files); exceptions for errors
- Error functions return discriminated unions via LanesError

## Module Design

**Exports:**
- Services export functions (not classes): `export async function validateWorkflow(...)`
- Providers export both classes and functions: `export class ClaudeSessionProvider implements ...`, `export function getSessionId(...)`
- FileService exports pure, reusable file I/O helpers
- All public functions explicitly exported; no default exports used

**Barrel Files:**
- Validation module uses barrel export in `src/validation/index.ts`:
```typescript
export type { ValidationResult } from '../utils';
export { validateSessionName, validateRelativePath, validateConfigString } from './validators';
export { validateWorktreesFolder, validatePromptsFolder, ... } from './schemas';
export { safeResolve, sanitizeForDisplay, isPathWithinBase, normalizePath } from './pathSanitizer';
```
- Allows `import { validateSessionName } from './validation'` instead of nested paths

**Service Organization:**
- Services in `./services/` directory as separate modules
- Service modules export pure functions and interfaces
- No class-based services; functional composition preferred
- Example structure:
  - `src/services/FileService.ts` - async file I/O
  - `src/services/SettingsService.ts` - extension settings and paths
  - `src/services/SessionService.ts` - session creation and management
  - `src/services/TerminalService.ts` - VS Code terminal management
  - `src/services/WorkflowService.ts` - workflow template management

## Async/Await Pattern

**Consistency:**
- All I/O operations use `async/await` (enforced by ESLint ban on sync fs methods)
- No `.then()` chains; use `await` throughout
- Error handling via `try/catch` blocks
- Example from `FileService`:
```typescript
export async function atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp.${process.pid}`;
    try {
        await fs.writeFile(tempPath, content, 'utf-8');
        await fs.rename(tempPath, filePath);
    } catch (err) {
        await fs.unlink(tempPath).catch(() => {});
        throw err;
    }
}
```

## Type Safety

**Strict Mode:**
- TypeScript `strict: true` in `tsconfig.json`
- All parameters and returns must be explicitly typed
- No implicit `any` types allowed

**Unknown Error Handling:**
- Use `catch (err: unknown)` pattern and type-guard before accessing properties
- Example: `if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')`
- Helper utility `getErrorMessage(err: unknown): string` extracts error message safely

## Testing-Related Conventions

- Test files co-located with source: `src/test/extension-hook-script.test.ts` mirrors `src/extension.ts`
- Test utilities shared in `src/test/testSetup.ts` (temp dir creation, memfs setup, git stubs)
- Test file naming: `[module].test.ts` or `[domain]/[module].test.ts`
- Test suites use mocha `suite()` and `test()` naming convention

---

*Convention analysis: 2026-02-10*
