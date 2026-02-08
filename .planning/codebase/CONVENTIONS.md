# Coding Conventions

**Analysis Date:** 2026-02-08

## Naming Patterns

**Files:**
- PascalCase for classes and interfaces: `ClaudeSessionProvider.ts`, `GitChangesPanel.ts`
- camelCase for functions and variables: `sanitizeSessionName`, `getSessionId`
- snake_case for test files: `sanitization.test.ts`, `extension-hook-script.test.ts`
- kebab-case for workflow files: `copy-writer.yaml`, `feature-branch.yaml`

**Functions:**
- Exported functions: camelCase (`sanitizeSessionName`, `getGlobalStoragePath`)
- Private functions: underscore prefix (`_sanitizeSessionName`, `createTempDir`)
- Async functions: descriptive names indicating async nature: `loadWorkflowTemplateFromString`

**Variables:**
- camelCase for all variables
- Constants: UPPER_SNAKE_CASE (`DEFAULT_WORKTREES_FOLDER`, `TERMINAL_CLOSE_DELAY_MS`)
- Interface names: PascalCase with descriptive names (`SessionItem`, `PendingSessionConfig`)

**Types:**
- Interface names: PascalCase with descriptive names
- Type aliases: PascalCase when representing complex types
- Union types: descriptive names when exported

## Code Style

**Formatting:**
- Tool: ESLint with TypeScript ESLint plugin
- Indentation: Tabs (configured in VS Code settings)
- Line length: No strict limit, but sensible wrapping
- Semicolons: Required (ESLint rule: semi: "warn")
- Curly braces: Required for all blocks (ESLint rule: curly: "warn")

**Linting:**
- Tool: ESLint with flat config (.eslintrc.mjs)
- TypeScript: Strict parsing with TypeScript ESLint
- Key rules:
  - `@typescript-eslint/naming-convention`: Warn for import naming
  - `eqeqeq`: Warn for use of ==/!= (prefer ===/!==)
  - `no-throw-literal`: Warn for throwing non-Error objects

**TypeScript Configuration:**
- Target: ES2022
- Module: Node16
- Strict mode: enabled
- Source maps: enabled
- OutDir: ./out
- RootDir: ./src

## Import Organization

**Order:**
1. External npm packages (node_modules)
2. Internal relative imports
3. Type imports (grouped with their value imports)

**Pattern:**
```typescript
import * as vscode from 'vscode';  // External packages first
import * as path from 'path';
import {
    ClaudeSessionProvider,
    SessionItem,
    getSessionId
} from './ClaudeSessionProvider';  // Internal imports
import type { WorkflowTemplate } from './workflow/types';  // Type imports
```

**Path Aliases:**
- Not configured in tsconfig.json
- All imports use relative paths

## Error Handling

**Patterns:**
- Use `getErrorMessage()` utility for unknown error types:
  ```typescript
  try {
      const result = await someAsyncOperation();
  } catch (err) {
      console.error('Operation failed:', getErrorMessage(err));
  }
  ```
- Throw Error objects with descriptive messages
- Avoid throwing non-Error objects (enforced by ESLint)
- Use custom error types for specific error scenarios

**Async Error Handling:**
- Use try/catch blocks for async operations
- Properly handle Promise rejections
- Use async/await consistently over .then() chains

## Logging

**Framework:** Console logging only
- Use `console.log()` for informational messages
- Use `console.warn()` for warnings
- Use `console.error()` for errors
- No structured logging framework

**Patterns:**
```typescript
console.log('Lanes: Extension activated');
console.warn('Lanes: Git extension not found, using default');
console.error('Lanes: Failed to create session:', err);
```

**When to Log:**
- Extension activation/deactivation
- Configuration changes
- Important state transitions
- Error conditions with actionable information
- Debug information during development

## Comments

**When to Comment:**
- Complex business logic in core functions
- Public API documentation with JSDoc
- Implementation details that require context
- Edge case handling that isn't obvious

**JSDoc/TSDoc:**
- Used for all public APIs and complex interfaces
- Include @param, @returns, @throws where applicable
- Use TSDoc syntax for better IntelliSense support

**Example:**
```typescript
/**
 * Sanitize a session name to be a valid git branch name.
 * Git branch naming rules:
 * - Allowed: letters, numbers, hyphens, underscores, dots, forward slashes
 * - Cannot start with '-', '.', or '/'
 * - Cannot end with '.', '/', or '.lock'
 *
 * @param name The raw session name from user input
 * @returns Sanitized name safe for git branches, or empty string if nothing valid remains
 */
export function sanitizeSessionName(name: string): string {
```

## Function Design

**Size:**
- Functions should be < 50 lines when possible
- Extract complex logic into smaller helper functions
- Single responsibility principle enforced

**Parameters:**
- Prefer 2-3 parameters max
- Use options objects for multiple parameters
- Avoid optional parameters when possible (use overloads instead)

**Return Values:**
- Prefer concrete types over `any`
- Use void for functions that don't return meaningful values
- Return null/undefined only when semantically appropriate

## Module Design

**Exports:**
- Export only what's needed from each module
- Use named exports for multiple items
- Consider default export only for main entry points

**Barrel Files:**
- Not used - direct imports from specific files
- Each file exports its own related functionality

**Module Organization:**
- Group related functionality together
- Separate concerns between modules (UI vs business logic)
- Clear module boundaries with minimal coupling

---

*Convention analysis: 2026-02-08*