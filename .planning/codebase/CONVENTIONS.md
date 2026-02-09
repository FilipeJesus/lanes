# Coding Conventions

**Analysis Date:** 2026-02-09

## Naming Patterns

**Files:**
- PascalCase for classes and providers: `ClaudeSessionProvider.ts`, `SessionFormProvider.ts`
- camelCase for utilities and services: `fileService.ts`, `sessionService.ts`
- camelCase for module/barrel files: `index.ts`, `utils.ts`
- TestFiles: `*.test.ts` for test files (co-located with source, suffix convention)

**Functions:**
- camelCase for all function names: `getSessionId()`, `clearSessionId()`, `executeGit()`
- Async functions: camelCase with async prefix when appropriate: `createSession()`, `getWorkflowStatus()`
- Private/internal functions: same camelCase, no underscore prefix; used within module scope

**Variables:**
- camelCase for all variables and constants: `tempDir`, `worktreeePath`, `sessionName`
- UPPER_SNAKE_CASE for module-level constants: `DEFAULT_WORKTREES_FOLDER`
- Use `const` by default, minimize `let` usage, never use `var`

**Types:**
- PascalCase for all type/interface names: `ServiceContainer`, `ValidationResult`, `LanesError`, `CodeAgent`
- Use `type` keyword for unions and type aliases: `type PermissionMode = 'unrestricted' | 'ask' | 'reject'`
- Use `interface` for extensible object shapes

**Imports:**
- Follow order: Standard library → VS Code → Relative imports
- Use `import * as NAME from 'module'` for service modules (e.g., `import * as SettingsService`)
- Use named imports for specific functions: `import { execGit } from '../gitService'`
- Use `type` keyword for type-only imports: `import type { ServiceContainer } from '../types/serviceContainer'`

## Code Style

**Formatting:**
- No Prettier config found; relies on TypeScript compilation and ESLint
- Indentation: Tabs (visible in tsconfig and source files)
- Line length: No explicit limit found, but generally kept concise
- Semicolons: Required (enforced by ESLint rule `semi: "warn"`)

**Linting:**
- Tool: ESLint 9.39.1 with typescript-eslint
- Config: `eslint.config.mjs`
- Naming conventions enforced: PascalCase/camelCase for imports
- Equality checks: `eqeqeq: "warn"` - must use strict equality (===)
- Control flow: `curly: "warn"` - all blocks must have curly braces
- No throw literals: `no-throw-literal: "warn"` - only throw Error objects
- Async file I/O enforced: `no-restricted-syntax` error for synchronous fs methods (readFileSync, writeFileSync, etc.) - must use fs/promises
- Test files excluded from sync fs ban - may legitimately use sync methods for setup

## Import Organization

**Order:**
1. VS Code imports: `import * as vscode from 'vscode'`
2. Node.js stdlib: `import * as path from 'path'`, `import * as fs from 'fs/promises'`
3. Third-party packages: `import { yaml } from 'yaml'`
4. Local services (as namespaces): `import * as SettingsService from './services/SettingsService'`
5. Local utilities (named imports): `import { getErrorMessage } from './utils'`
6. Local types (type-only): `import type { ServiceContainer } from './types/serviceContainer'`

**Path Aliases:**
- None detected; all imports use relative paths (`./`, `../`)
- Relative paths used throughout: `'./services/FileService'`, `'../ClaudeSessionProvider'`

## Error Handling

**Patterns:**
- Custom error hierarchy with discriminated unions: `LanesError` base class with `kind` property
- Error types: `GitError`, `ValidationError`, both extending `LanesError`
- Each error includes both technical and user-friendly messages
- Use `instanceof` checks combined with `kind` property for type narrowing
- Catch handlers use try/catch with specific error types when available
- Unknown errors extracted with `getErrorMessage()` helper function

Example from `FileService.ts`:
```typescript
try {
    await fs.readFile(filePath, 'utf-8');
} catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
    }
    throw err;
}
```

## Logging

**Framework:** Console-based (console.log, console.error, console.warn)

**Patterns:**
- Informational: `console.log()` for general messages
- Warnings: `console.warn()` for non-fatal issues (e.g., merge-base failures with fallback)
- Errors: `console.error()` with error context
- Example: `console.log('Congratulations, "Lanes" is now active!');` in `extension.ts`
- Log level selection based on severity, not wrapped in functions

## Comments

**When to Comment:**
- JSDoc comments on all public functions (required)
- JSDoc comments on types/interfaces
- Inline comments for complex logic or non-obvious decisions
- Comments explain "why", not "what" - the code shows what it does

**JSDoc/TSDoc:**
- All public functions: Full JSDoc with @param, @returns
- All exported types: JSDoc describing the type purpose
- Classes: Module-level JSDoc describing class purpose and use cases
- Example from `FileService.ts`:
```typescript
/**
 * Write content to a file atomically using a temp-file-then-rename pattern.
 * This prevents file corruption if the process crashes mid-write.
 *
 * @param filePath - The target file path
 * @param content - The string content to write
 */
export async function atomicWrite(filePath: string, content: string): Promise<void>
```

## Function Design

**Size:** Functions are typically focused - most under 50 lines, complex ones (like `createSession`) well-commented
- Avoid deeply nested logic - extract helpers when possible
- Single responsibility principle observed

**Parameters:**
- Use specific parameters over option objects for functions with <3 params
- Use option objects or destructuring for functions with multiple related params
- Type all parameters explicitly - no implicit `any`
- Example: `export function setOpenClaudeTerminal(impl: OpenClaudeTerminalFn): void`

**Return Values:**
- Use Promise for async operations: `async function execute(): Promise<void>`
- Use union types for alternatives: `Promise<T | null>` when null is meaningful
- Use specific error types, never return null to indicate errors
- Example: `export async function readJson<T>(filePath: string): Promise<T | null>`

## Module Design

**Exports:**
- Named exports for all public functions and types
- Namespace-style imports for service modules: `import * as SessionService from './services/SessionService'`
- Minimal re-exports in index.ts files

**Barrel Files:**
- Used in `src/errors/index.ts`, `src/codeAgents/index.ts`, `src/commands/index.ts`
- Pattern: Re-export specific functions and type exports
- Example from `errors/index.ts`:
```typescript
export { LanesError } from './LanesError';
export { GitError } from './GitError';
export { ValidationError } from './ValidationError';
```

**Service Modules:**
- Services are modules with multiple related functions (not classes)
- Examples: `FileService.ts`, `SessionService.ts`, `SettingsService.ts`
- Encapsulate internal state (like queues) within the module scope
- Provide getter/setter functions for state management
- Example: `sessionCreationQueue` in `SessionService.ts` with `getSessionCreationQueue()` accessor

---

*Convention analysis: 2026-02-09*
