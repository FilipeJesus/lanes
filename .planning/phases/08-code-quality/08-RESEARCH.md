# Phase 8: Code Quality - Research

**Researched:** 2026-02-08
**Domain:** Node.js file I/O, TypeScript async patterns, MCP SDK abstraction, ESLint configuration
**Confidence:** HIGH

## Summary

Phase 8 focuses on three code quality improvements: (1) standardizing all file I/O to async/await, (2) isolating MCP integration behind an abstraction layer, and (3) verifying code follows established conventions via linting.

**Primary recommendation:** Create a `FileService` for centralized async file operations, extract MCP file-based IPC into a `McpAdapter` with interface-based abstraction, and enhance ESLint rules to enforce async file I/O patterns.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `fs/promises` | Built-in (Node 18+) | Async file operations | Standard async API in Node.js, no additional dependencies |
| TypeScript | 5.9.3 | Type safety | Already in use, provides excellent async/await support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | 1.25.2 | MCP server/tools | Already in use - workflow integration |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fs-extra` | Native `fs/promises` | `fs-extra` adds convenience methods but increases bundle size; native API sufficient for this use case |
| Custom promise wrappers | `fs.promises` | Custom wrappers add maintenance burden; native promises are well-optimized |

**Installation:**
No additional packages required - use built-in Node.js APIs.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── services/
│   ├── FileService.ts      # NEW: Centralized async file I/O
│   ├── McpAdapter.ts       # NEW: MCP abstraction layer
│   └── [existing services]
├── mcp/
│   ├── index.ts            # Existing: Tool exports
│   ├── server.ts           # Existing: MCP server entry point
│   └── tools.ts            # Existing: Tool handlers (refactor to use FileService)
└── types/
    ├── mcp.d.ts            # NEW: MCP abstraction interfaces
    └── [existing types]
```

### Pattern 1: Async File Service
**What:** Centralized service for all file I/O operations using async/await
**When to use:** All file read/write operations throughout the codebase
**Example:**
```typescript
// src/services/FileService.ts
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Atomic write pattern: write to temp file, then rename
 * Prevents corruption if process crashes during write
 */
export async function atomicWrite(filePath: string, content: string): Promise<void> {
    const tempPath = `${filePath}.tmp.${process.pid}`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, filePath);
}

/**
 * Read JSON file with schema validation
 */
export async function readJson<T>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(content) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

/**
 * Ensure directory exists (recursive)
 */
export async function ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}
```

### Pattern 2: MCP Abstraction Layer
**What:** Interface-based abstraction for MCP integration
**When to use:** All MCP tool handlers and server operations
**Example:**
```typescript
// src/types/mcp.d.ts
export interface IMcpAdapter {
    // State persistence
    saveState(worktreePath: string, state: unknown): Promise<void>;
    loadState(worktreePath: string): Promise<unknown | null>;

    // Session requests
    createPendingSession(config: PendingSessionConfig): Promise<void>;
    createClearRequest(worktreePath: string): Promise<void>;
}

// src/services/McpAdapter.ts
export class McpAdapter implements IMcpAdapter {
    constructor(private readonly fileService: FileService) {}

    async saveState(worktreePath: string, state: unknown): Promise<void> {
        const statePath = this.getStatePath(worktreePath);
        await this.fileService.atomicWrite(statePath, JSON.stringify(state, null, 2));
    }

    private getStatePath(worktreePath: string): string {
        return path.join(worktreePath, 'workflow-state.json');
    }
}
```

### Anti-Patterns to Avoid
- **Mixed sync/async file I/O:** Do not use `fs.readFileSync` alongside `fs.promises.readFile`. Choose async consistently.
- **Callback-based file operations:** Avoid `fs.readFile` with callbacks - use promises instead.
- **Direct MCP SDK usage in handlers:** Don't import MCP SDK types directly in tool handlers - use the adapter interface.
- **Unhandled promise rejections:** Always await promises or handle rejections in file operations.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File existence checks | Custom `exists` wrappers | `fs.access()` or try/catch with `fs.readFile()` | Race conditions possible with exists-then-read pattern |
| Atomic writes | Custom temp file logic | Centralized `atomicWrite()` in FileService | Consistent pattern, easier to test, prevents corruption |
| JSON parsing | Custom JSON parse with error handling | `readJson<T>()` with proper error typing | Type-safe, consistent error handling |
| Path operations | String manipulation | `path.join()`, `path.resolve()` | Cross-platform compatibility |

**Key insight:** File I/O is error-prone (permissions, race conditions, corrupted data). Centralizing operations in a well-tested service reduces bugs and provides consistent error handling.

## Common Pitfalls

### Pitfall 1: ENOENT handling inconsistency
**What goes wrong:** Some functions return null on file not found, others throw
**Why it happens:** Inconsistent error handling patterns across modules
**How to avoid:** Use consistent `readJson<T>()` pattern that returns null on ENOENT
**Warning signs:** Mix of try/catch checking `error.code === 'ENOENT'` and `fs.existsSync()` calls

### Pitfall 2: Mixed sync/async patterns in same module
**What goes wrong:** Some functions use `fs.readFileSync()`, others use `await fs.promises.readFile()`
**Why it happens:** Gradual migration, developer preference
**How to avoid:** ESLint rule to ban synchronous fs methods
**Warning signs:** Imports of both `fs` and `fs/promises` in same file

### Pitfall 3: MCP SDK leakage into business logic
**What goes wrong:** Tool handlers import from `@modelcontextprotocol/sdk` directly
**Why it happens:** Direct SDK usage is convenient initially
**How to avoid:** Create adapter interfaces and forbid direct SDK imports outside mcp/ directory
**Warning signs:** MCP SDK imports in services/ or commands/ directories

### Pitfall 4: File write corruption
**What goes wrong:** Process crashes mid-write, leaving partial/corrupted files
**Why it happens:** Direct `fs.writeFile()` is not atomic
**How to avoid:** Always use atomic write pattern (write temp + rename)
**Warning signs:** No `.tmp` intermediate files in file operations

## Code Examples

### Converting sync file I/O to async

**BEFORE (sync):**
```typescript
// src/ClaudeSessionProvider.ts (current)
export function getSessionWorkflow(worktreePath: string): string | null {
    const sessionPath = getClaudeSessionPath(worktreePath);
    try {
        if (!fs.existsSync(sessionPath)) {
            return null;
        }
        const content = fs.readFileSync(sessionPath, 'utf-8');
        const data = JSON.parse(content);
        return typeof data.workflow === 'string' ? data.workflow : null;
    } catch {
        return null;
    }
}
```

**AFTER (async):**
```typescript
// src/services/FileService.ts
export async function readSessionWorkflow(worktreePath: string): Promise<string | null> {
    const sessionPath = getClaudeSessionPath(worktreePath);
    try {
        const content = await fs.readFile(sessionPath, 'utf-8');
        const data = JSON.parse(content);
        return typeof data.workflow === 'string' ? data.workflow : null;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
```

### MCP Adapter Pattern

**BEFORE (direct file I/O in tools):**
```typescript
// src/mcp/tools.ts (current)
export async function saveState(worktreePath: string, state: WorkflowState): Promise<void> {
    const statePath = getStatePath(worktreePath);
    const tempPath = `${statePath}.tmp.${process.pid}`;
    await fs.promises.writeFile(tempPath, JSON.stringify(state, null, 2));
    await fs.promises.rename(tempPath, statePath);
}
```

**AFTER (via adapter):**
```typescript
// src/mcp/tools.ts (refactored)
import { mcpAdapter } from '../services/McpAdapter';

export async function saveState(worktreePath: string, state: WorkflowState): Promise<void> {
    await mcpAdapter.saveState(worktreePath, state);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Callback-based `fs.readFile` | Promise-based `fs/promises` | Node 10+ (2020) | async/await support, cleaner code |
| Direct fs methods in handlers | Service layer abstraction | Ongoing (this phase) | Better testability, separation of concerns |
| Mixed sync/async file I/O | Consistent async patterns | Target: Phase 8 | Prevents blocking, better performance |

**Deprecated/outdated:**
- `fs.exists()` - Use `fs.access()` or try/catch with file operations
- `fs.readFile()` with callbacks - Use `fs/promises` instead
- Synchronous methods in async contexts - Blocks event loop unnecessarily

## Current Codebase Analysis

### File I/O Patterns Identified

**Files with mixed sync/async patterns (54 files found):**

1. **Pure async (good pattern):**
   - `src/mcp/tools.ts` - Uses `fs.promises` consistently
   - `src/workflow/loader.ts` - Uses `await fs.promises.readFile()`
   - `src/workflow/discovery.ts` - Uses `await fs.promises.readdir()`
   - `src/localSettings.ts` - Uses `await fsPromises.access()`, `await fsPromises.mkdir()`
   - `src/services/BrokenWorktreeService.ts` - Uses `await fsPromises.*`

2. **Sync-heavy (needs migration):**
   - `src/ClaudeSessionProvider.ts` - Multiple `fs.readFileSync()`, `fs.existsSync()`, `fs.mkdirSync()`, `fs.writeFileSync()`
   - `src/workflow/state.ts` - Uses `fs.existsSync()`
   - `src/mcp/server.ts` - Uses `fs.existsSync()`
   - `src/commands/sessionCommands.ts` - Uses `fs.existsSync()`
   - `src/gitService.ts` - Uses `spawn` (good), but check sync usage elsewhere

3. **Atomic write pattern already in use:**
   - `src/mcp/tools.ts` has correct pattern:
     ```typescript
     await fs.promises.writeFile(tempPath, JSON.stringify(state, null, 2));
     await fs.promises.rename(tempPath, statePath);
     ```
   - `src/services/SettingsService.ts` has correct pattern:
     ```typescript
     await fsPromises.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
     await fsPromises.rename(tempPath, settingsFilePath);
     ```

### MCP Integration Analysis

**Current state:**
- `src/mcp/server.ts` - MCP server entry point using `@modelcontextprotocol/sdk`
- `src/mcp/tools.ts` - Tool handlers with direct file I/O
- `src/mcp/index.ts` - Re-exports tool handlers

**No abstraction layer exists** - file I/O is mixed directly into tool handlers.

### Linting Configuration

**Current ESLint setup** (`eslint.config.mjs`):
```javascript
import typescriptEslint from "typescript-eslint";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint.plugin,
    },
    languageOptions: {
        parser: typescriptEslint.parser,
        ecmaVersion: 2022,
        sourceType: "module",
    },
    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],
        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",
    },
}];
```

**Missing rules for Phase 8:**
- No rule banning synchronous fs methods
- No rule enforcing async file I/O patterns
- No rule preventing MCP SDK imports outside mcp/ directory

## Open Questions

1. **Should FileService handle all path operations or just file I/O?**
   - What we know: Path operations are currently scattered (path.join calls everywhere)
   - Recommendation: Keep FileService focused on I/O operations; path operations can stay inline but should use `path.join()` consistently
   - What's unclear: Whether to add path validation helpers to FileService

2. **MCP Adapter scope - should it abstract the entire SDK or just file I/O?**
   - What we know: Current usage is file-based IPC for workflow state
   - Recommendation: Start with abstracting only file I/O aspects (state persistence, pending sessions)
   - What's unclear: Future MCP requirements (stdio transport, custom tools)

3. **Breaking changes vs. backward compatibility**
   - What we know: Phase 7 retained backward compatibility via re-exports
   - Recommendation: For public APIs, maintain compatibility; internal refactoring can break
   - What's unclear: Whether ClaudeSessionProvider exports are considered public API

## Sources

### Primary (HIGH confidence)
- Node.js `fs/promises` API documentation - Verified async file operation patterns
- `@modelcontextprotocol/sdk` v1.25.2 - Current MCP integration in codebase
- TypeScript 5.9 documentation - async/await type safety

### Secondary (MEDIUM confidence)
- ESLint TypeScript plugin documentation - Rule configuration for banning sync methods
- Codebase analysis of 54 files with file I/O operations - Current patterns identified

### Tertiary (LOW confidence)
- None - all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Node.js built-ins are well-documented and stable
- Architecture: HIGH - Patterns identified from existing good code (mcp/tools.ts, SettingsService.ts)
- Pitfalls: HIGH - All patterns observed in current codebase
- Migration strategy: MEDIUM - Breaking changes need careful consideration

**Research date:** 2026-02-08
**Valid until:** 2026-03-10 (30 days - stable APIs, but codebase evolves)
