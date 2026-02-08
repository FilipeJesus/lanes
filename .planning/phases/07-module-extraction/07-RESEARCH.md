# Phase 7: Module Extraction - Research

**Researched:** 2026-02-08
**Domain:** VS Code extension architecture, TypeScript module organization, refactoring patterns
**Confidence:** HIGH

## Summary

Phase 7 focuses on restructuring the extension's main file (`extension.ts`, ~3000 lines) into focused, maintainable modules by single responsibility. The current file violates multiple software engineering principles: it handles session lifecycle, git operations, workflow management, terminal creation, file system operations, command registration, and UI providers all in one place.

**Primary recommendation:** Apply vertical slicing to extract modules by functional domain (session management, worktree operations, workflow orchestration, terminal management, command registration). Each module should have a clear public interface and be independently testable. Use dependency injection patterns where modules need VS Code API or shared services. No new build tools or frameworks required—the existing esbuild bundler handles module resolution.

---

## Standard Stack

### Core (No Changes - Existing Stack)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| TypeScript | ^5.9.3 | Module system, type safety | Existing language, no migration needed |
| esbuild | ^0.27.2 | Bundling with module resolution | Already configured, handles ES modules and CommonJS |
| VS Code Extension API | ^1.75.0 | Extension integration | Core platform API |

### Module Organization (New Structure)

| Module | Purpose | Dependencies |
|--------|---------|--------------|
| `src/services/WorktreeService.ts` | Git worktree operations | `gitService`, `validation` |
| `src/services/SessionService.ts` | Session lifecycle management | `WorktreeService`, `ClaudeSessionProvider` |
| `src/services/TerminalService.ts` | Terminal creation and management | `codeAgents`, `mcp` |
| `src/services/WorkflowService.ts` | Workflow template management | `workflow/`, `mcp/tools` |
| `src/commands/` | Command registration and handlers | All services |
| `src/providers/` | Tree data providers | Existing providers (move from root) |

**No installation required** - Using existing TypeScript and esbuild capabilities.

---

## Architecture Patterns

### Recommended Module Organization

**Current State:**
```
src/
├── extension.ts              # 3000 lines - GOD OBJECT
├── ClaudeSessionProvider.ts  # Session tree provider
├── SessionFormProvider.ts    # Session form webview
├── PreviousSessionProvider.ts
├── WorkflowsProvider.ts
├── GitChangesPanel.ts
├── gitService.ts             # Git wrapper
├── ProjectManagerService.ts  # Already extracted
├── workflow/                 # Workflow state machine (extracted)
├── codeAgents/               # Code agents (extracted)
├── mcp/                      # MCP tools (extracted)
├── validation/               # Validation (extracted)
└── errors/                   # Error types (extracted)
```

**Target State:**
```
src/
├── extension.ts              # Entry point, activation, command registration (thin)
├── services/
│   ├── WorktreeService.ts    # Worktree CRUD operations
│   ├── SessionService.ts     # Session creation, deletion, management
│   ├── TerminalService.ts    # Terminal lifecycle
│   ├── WorkflowService.ts    # Workflow template operations
│   └── BrokenWorktreeService.ts # Worktree repair operations
├── commands/
│   ├── index.ts              # Command registry
│   ├── sessionCommands.ts    # Create, delete, open sessions
│   ├── workflowCommands.ts   # Create, validate workflows
│   └── repairCommands.ts     # Worktree repair commands
├── providers/
│   ├── ClaudeSessionProvider.ts   # Move from root
│   ├── SessionFormProvider.ts     # Move from root
│   ├── PreviousSessionProvider.ts # Move from root
│   ├── WorkflowsProvider.ts       # Move from root
│   └── GitChangesPanel.ts         # Move from root
├── types/
│   └── extension.d.ts         # Extension-specific types
├── utils/                     # Shared utilities (already partially exists)
└── [existing extracted modules]
```

### Pattern 1: Service Layer Pattern

**What:** Create service classes that encapsulate business logic and provide a clear public interface.

**When to use:** For complex operations that involve multiple steps or external dependencies (git, file system, VS Code API).

**Example:**
```typescript
// Source: Service layer best practices
// src/services/WorktreeService.ts

import * as vscode from 'vscode';
import { execGit } from '../gitService';
import { validateBranchName } from '../validation';

export interface WorktreeService {
    create(name: string, sourceBranch: string, basePath: string): Promise<WorktreeResult>;
    remove(path: string, basePath: string): Promise<void>;
    list(basePath: string): Promise<WorktreeInfo[]>;
    detectBroken(basePath: string): Promise<BrokenWorktree[]>;
    repair(broken: BrokenWorktree, basePath: string): Promise<RepairResult>;
}

export interface WorktreeResult {
    success: boolean;
    path: string;
    error?: string;
}

export class GitWorktreeService implements WorktreeService {
    constructor(
        private readonly outputChannel: vscode.OutputChannel
    ) {}

    async create(
        name: string,
        sourceBranch: string,
        basePath: string
    ): Promise<WorktreeResult> {
        // 1. Validate
        const validation = validateBranchName(name);
        if (!validation.valid) {
            return { success: false, path: '', error: validation.error };
        }

        // 2. Check if exists
        const exists = await this.branchExists(basePath, name);
        if (exists) {
            // Handle existing branch logic
        }

        // 3. Create worktree
        try {
            await execGit(['worktree', 'add', ...], basePath);
            return { success: true, path: this.getWorktreePath(basePath, name) };
        } catch (err) {
            return { success: false, path: '', error: this.formatError(err) };
        }
    }

    // ... other methods
}
```

### Pattern 2: Command Registration Module

**What:** Separate command registration from command implementation. Use a centralized registry pattern.

**When to use:** When you have 15+ commands (current state) that need organized management.

**Example:**
```typescript
// src/commands/index.ts

import * as vscode from 'vscode';
import { registerSessionCommands } from './sessionCommands';
import { registerWorkflowCommands } from './workflowCommands';
import { registerRepairCommands } from './repairCommands';

export function registerAllCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer
): void {
    registerSessionCommands(context, services);
    registerWorkflowCommands(context, services);
    registerRepairCommands(context, services);
}

// src/commands/sessionCommands.ts

export function registerSessionCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer
): void {
    const disposables = [
        vscode.commands.registerCommand(
            'claudeWorktrees.createSession',
            () => services.sessionService.create()
        ),
        vscode.commands.registerCommand(
            'claudeWorktrees.deleteSession',
            (item) => services.sessionService.delete(item)
        ),
        vscode.commands.registerCommand(
            'claudeWorktrees.openSession',
            (item) => services.terminalService.openSession(item)
        ),
        // ... more session commands
    ];

    disposables.forEach(d => context.subscriptions.push(d));
}
```

### Pattern 3: Dependency Injection Container

**What:** Create a lightweight service container to manage dependencies and enable testability.

**When to use:** When multiple services depend on each other and you need to inject mocks for testing.

**Example:**
```typescript
// src/types/ServiceContainer.ts

import * as vscode from 'vscode';
import type { WorktreeService } from '../services/WorktreeService';
import type { SessionService } from '../services/SessionService';
import type { TerminalService } from '../services/TerminalService';

export interface ServiceContainer {
    worktree: WorktreeService;
    session: SessionService;
    terminal: TerminalService;
    output: vscode.OutputChannel;
}

// src/extension.ts (thinned down)

import { ServiceContainer, createServiceContainer } from './types/ServiceContainer';
import { registerAllCommands } from './commands';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Create services
    const services = createServiceContainer(context);

    // Register commands
    registerAllCommands(context, services);

    // Register providers
    registerProviders(context, services);
}
```

### Anti-Patterns to Avoid

- **Circular dependencies:** Service A imports Service B, Service B imports Service A. Break by creating a shared types/interface module or using dependency injection.
- **Leaky abstractions:** Services that expose VS Code API directly to callers. Wrap VS Code APIs in service methods.
- **God modules:** Just creating folders but keeping all logic in one file. Each service should be independently testable.
- **Over-abstraction:** Creating interfaces for everything. Use concrete types until you need multiple implementations.
- **Tight coupling:** Services that instantiate their own dependencies. Use constructor injection for better testability.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dependency injection | Custom DI container | Constructor functions / manual wiring | VS Code extensions are simple enough for manual DI |
| Module resolution | Custom import system | TypeScript/ES6 modules | Native to the language |
| Service location | Global singletons | Service container passed to commands | Easier to test, explicit dependencies |
| Event bus | Custom pub/sub | VS Code API events, EventEmitter | Already built into VS Code API |

**Key insight:** VS Code extensions don't need complex dependency management. Manual wiring in `activate()` is sufficient and more explicit.

---

## Common Pitfalls

### Pitfall 1: Breaking Tests During Extraction

**What goes wrong:** After moving code to new modules, imports break and tests fail because they can't find the moved functions.

**Why it happens:** Test files import from `../extension` and those exports are no longer available.

**How to avoid:**
1. Keep `extension.ts` exporting moved functions temporarily (marked `@deprecated`)
2. Update test imports incrementally
3. Use a barrel export pattern: `src/services/index.ts` re-exports all services

**Warning signs:** Lots of "Module not found" errors after extraction, tests failing with "Cannot read property of undefined".

### Pitfall 2: Circular Dependencies

**What goes wrong:** Module A imports Module B, which imports Module A, causing "ReferenceError" or empty objects.

**Why it happens:** When splitting a large file, related functions often call each other.

**How to avoid:**
1. Extract related functions together into the same module
2. Create a shared types/interfaces module that both depend on
3. Use dependency injection to break the cycle

**Warning signs:** "Cannot access 'X' before initialization", getting `{}` when importing a module.

### Pitfall 3: VS Code API Scattered Across Modules

**What goes wrong:** Multiple modules directly access `vscode.window`, `vscode.workspace`, making testing difficult.

**Why it happens:** Convenience—direct API calls are easier than wrapping.

**How to avoid:**
1. Create VS Code wrapper services for UI operations
2. Pass `vscode.ExtensionContext` to services that need it
3. Use dependency injection for mocks in tests

**Warning signs:** Tests require full VS Code test environment even for simple logic tests.

### Pitfall 4: Breaking Activation

**What goes wrong:** After refactoring, extension fails to activate with no clear error message.

**Why it happens:** `extension.ts` no longer exports `activate`, or exports don't match `package.json`.

**How to avoid:**
1. Keep `extension.ts` as the entry point—it should only call other modules
2. Ensure `activate` and `deactivate` remain exported
3. Test extension loading after each module extraction

**Warning signs:** Extension doesn't appear in Extensions list, commands don't register.

### Pitfall 5: Over-Engineering

**What goes wrong:** Creating interfaces, abstract classes, and factories for simple functionality.

**Why it happens:** Following "best practices" without considering actual complexity.

**How to avoid:**
1. Start with concrete classes
2. Only add interfaces when you have multiple implementations
3. Keep services focused—don't create "Manager" classes that just delegate

**Warning signs:** Files with just interfaces, empty implementations, or single-function classes.

---

## Code Examples

### Before: Monolithic extension.ts (simplified)

```typescript
// Current: 3000 lines with mixed concerns

export async function activate(context: vscode.ExtensionContext) {
    // Initialization (50 lines)
    await initializeGitPath();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    const baseRepoPath = workspaceRoot ? await getBaseRepoPath(workspaceRoot) : undefined;

    // Provider registration (100 lines)
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot, baseRepoPath);
    const sessionTreeView = vscode.window.createTreeView('claudeSessionsView', {...});
    // ... more providers

    // Command registration (500 lines)
    let createDisposable = vscode.commands.registerCommand('claudeWorktrees.createSession', async () => {
        // 50 lines of session creation logic
    });
    let deleteDisposable = vscode.commands.registerCommand('claudeWorktrees.deleteSession', async (item) => {
        // 30 lines of deletion logic
    });
    // ... 15 more commands

    // File system watchers (100 lines)
    const statusWatcher = vscode.workspace.createFileSystemWatcher(...);
    const sessionWatcher = vscode.workspace.createFileSystemWatcher(...);
    // ... more watchers

    // Helper functions inline (2000 lines!)
    async function createSession(...) { /* 100 lines */ }
    async function openClaudeTerminal(...) { /* 150 lines */ }
    function detectBrokenWorktrees(...) { /* 80 lines */ }
    // ... many more
}
```

### After: Organized Modules

```typescript
// New extension.ts: Thin entry point

import { createServiceContainer } from './services/serviceContainer';
import { registerAllCommands } from './commands';
import { registerProviders } from './providers';
import { registerWatchers } from './watchers';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize services
    const services = await createServiceContainer(context);

    // Register UI components
    registerProviders(context, services);

    // Register commands
    registerAllCommands(context, services);

    // Register file system watchers
    registerWatchers(context, services);
}

export function deactivate(): void {
    // Cleanup handled by disposables registered to context
}

// src/services/WorktreeService.ts

export class WorktreeService {
    constructor(
        private readonly gitService: GitService,
        private readonly output: vscode.OutputChannel
    ) {}

    async create(options: CreateWorktreeOptions): Promise<Worktree> {
        // Focused on worktree operations only
    }

    async remove(path: string): Promise<void> {
        // Focused on removal logic
    }

    // ... worktree-specific methods
}

// src/commands/sessionCommands.ts

export function registerSessionCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer
): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'claudeWorktrees.createSession',
            () => services.session.create()
        ),
        vscode.commands.registerCommand(
            'claudeWorktrees.deleteSession',
            (item) => services.session.delete(item)
        )
        // ... more session commands
    );
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Monolithic extension.ts | Service-oriented modules | Phase 7 | Improved testability, clearer responsibilities |
| Inline command handlers | Command modules | Phase 7 | Easier to find and modify commands |
| Mixed concerns in one file | Separated by domain | Phase 7 | Better code navigation, reduced merge conflicts |

**Already Extracted (Best Practices to Follow):**
- `workflow/` - Workflow state machine (good example of focused module)
- `codeAgents/` - Code agent abstractions (good interface design)
- `mcp/` - MCP tool integration (clear separation of concerns)
- `validation/` - Centralized validation (single responsibility)
- `errors/` - Custom error types (focused domain types)

**Target for Extraction (from extension.ts):**

| Functionality | Current Lines | Target Module | Complexity |
|---------------|---------------|---------------|------------|
| Broken worktree detection/repair | ~350 | `services/BrokenWorktreeService.ts` | Medium |
| Session creation logic | ~300 | `services/SessionService.ts` | High |
| Terminal management | ~200 | `services/TerminalService.ts` | Medium |
| Workflow template operations | ~250 | `services/WorkflowService.ts` | Low |
| Git diff generation | ~200 | `services/DiffService.ts` | Medium |
| Command handlers | ~500 | `commands/*.ts` | Low (mostly delegation) |
| Extension settings/hooks | ~300 | `services/SettingsService.ts` | Medium |
| File system watchers | ~150 | `watchers.ts` | Low |
| Helper functions (git, path) | ~400 | `utils/*.ts` or existing | Varies |

---

## Current Codebase Analysis

### extension.ts Function Inventory

Based on analysis of the current `extension.ts` file:

| Section | Lines | Functions | Extraction Target |
|---------|-------|-----------|-------------------|
| Broken worktree functions | 350 | `detectBrokenWorktrees`, `repairWorktree`, `checkAndRepairBrokenWorktrees`, `copyDirectory`, `copyDirectoryContents` | `services/BrokenWorktreeService.ts` |
| Session creation | 300 | `createSession`, `branchExists`, `getBranchesInWorktrees`, `ensureWorktreeDirExists` | `services/SessionService.ts` |
| Terminal management | 200 | `openClaudeTerminal`, `countTerminalsForSession`, `createTerminalForSession` | `services/TerminalService.ts` |
| Extension settings | 300 | `getOrCreateExtensionSettingsFile`, `getBaseRepoPath`, `getRepoName` | `services/SettingsService.ts` |
| Git diff operations | 200 | `generateDiffContent`, `parseUntrackedFiles`, `isBinaryContent`, `synthesizeUntrackedFileDiff`, `getBaseBranch` | `services/DiffService.ts` |
| Workflow management | 250 | `createWorkflow`, `validateWorkflow`, `getWorkflowOrchestratorInstructions`, `combinePromptAndCriteria` | `services/WorkflowService.ts` |
| MCP/session processing | 150 | `processPendingSession`, `processClearRequest`, `checkPendingSessions`, `checkClearRequests` | `services/SessionProcessService.ts` |
| Pending session interfaces | 30 | `PendingSessionConfig`, `ClearSessionConfig`, `getPendingSessionsDir` | `types/extension.d.ts` |
| File watcher setup | 150 | (all in activate) | `watchers.ts` |
| Command registration | 500 | (all in activate) | `commands/*.ts` |

### Existing Good Extraction Patterns

The codebase already has some good examples of module extraction that should be followed:

1. **`gitService.ts`**: Clean interface, single responsibility
2. **`workflow/` module**: Clear domain boundary, state machine pattern
3. **`validation/` module**: Reusable validation functions
4. **`errors/` module**: Custom error types with user-friendly messages

---

## Open Questions

1. **Extraction order:** Should we extract services first or commands first?
   - **Recommendation:** Extract services first (bottom-up), then refactor commands to use services. This minimizes the time where code is in a broken state.

2. **Testing during extraction:** How do we ensure nothing breaks during the move?
   - **Recommendation:** Keep old exports with `@deprecated` tags, run tests after each extraction, use feature flags if needed.

3. **Module granularity:** How small should modules be?
   - **Recommendation:** Aim for 200-400 lines per module. If a service grows larger, consider splitting it further.

4. **Shared state handling:** How do we handle the many module-level variables (queues, sets, etc.)?
   - **Recommendation:** Encapsulate state in service classes. Use class instances instead of module-level variables.

---

## Sources

### Primary (HIGH confidence)

- [VS Code Extension API - Extension Host](https://vscode-docs1.readthedocs.io/en/latest/extensionAPI/patterns-and-principles/) - Official architecture patterns
- [Bundling Extensions - VS Code API](https://code.visualstudio.com/api/working-with-extensions/bundling-extension) - esbuild and module handling
- [TypeScript Handbook - Modules](https://www.typescriptlang.org/docs/handbook/modules.html) - TypeScript module system
- [Refactoring Guru - Extract Class](https://refactoring.guru/extract-class) - When and how to extract classes

### Secondary (MEDIUM confidence)

- [Service Layer Pattern](https://martinfowler.com/eaaCatalog/serviceLayer.html) - Service layer architecture
- [Dependency Injection in TypeScript](https://dev.to/diomarkss/service-layer-with-dependency-injection-in-typescript-1a5k) - DI patterns for TypeScript
- [VS Code Extension Authoring - Best Practices](https://code.visualstudio.com/api/advanced-topics/extension-host) - Extension host considerations

### Tertiary (LOW confidence - internal codebase analysis)

- `src/extension.ts` - Direct analysis of current structure
- `src/workflow/` - Example of good module extraction
- `src/gitService.ts` - Example of focused service interface
- `.planning/phases/05-test-foundation/05-RESEARCH.md` - Test organization patterns

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Existing TypeScript/esbuild, no changes needed
- Architecture: HIGH - Standard service layer and command patterns, well-documented
- Pitfalls: HIGH - Direct analysis of existing codebase, common refactoring issues
- Module boundaries: HIGH - Clear functional domains identified in current code

**Research date:** 2026-02-08
**Valid until:** 2026-05-08 (90 days - VS Code API and TypeScript patterns are stable)

---

*Next step: Create PLAN.md files with detailed task breakdown based on this research.*
