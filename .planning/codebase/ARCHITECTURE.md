# Architecture

**Analysis Date:** 2026-02-09

## Pattern Overview

**Overall:** Layered VS Code extension architecture with MCP (Model Context Protocol) integration for workflow orchestration.

**Key Characteristics:**
- **Modular service layer** separating concerns (sessions, git, terminals, workflows)
- **Tree data provider pattern** for sidebar UI using VS Code's TreeDataProvider API
- **Dependency injection via ServiceContainer** for centralized service management
- **Event-driven watchers** for file system and configuration changes
- **MCP server subprocess** for Claude workflow execution in isolated sessions
- **Discriminated union error handling** with type-safe error narrowing

## Layers

**Extension Entry Point:**
- Purpose: Initialize services, activate providers, register commands and watchers
- Location: `src/extension.ts`
- Contains: Global setup, dependency injection, event subscriptions
- Depends on: All services, providers, commands
- Used by: VS Code runtime

**UI/Provider Layer:**
- Purpose: Manage sidebar views and webview interfaces
- Location: `src/ClaudeSessionProvider.ts`, `src/SessionFormProvider.ts`, `src/PreviousSessionProvider.ts`, `src/WorkflowsProvider.ts`
- Contains: TreeDataProvider implementations, webview HTML, VS Code UI state management
- Depends on: Services (SessionService, FileService, SettingsService)
- Used by: Extension (registers providers)

**Service Layer:**
- Purpose: Implement business logic and core operations
- Location: `src/services/`
- Contains:
  - `SessionService.ts` - Session creation, worktree management, lifecycle
  - `TerminalService.ts` - Terminal creation, Claude process management
  - `WorkflowService.ts` - Workflow validation, loading, execution
  - `SettingsService.ts` - User settings, base repo detection
  - `DiffService.ts` - Git diff generation, branch comparison
  - `FileService.ts` - File I/O abstractions
  - `BrokenWorktreeService.ts` - Worktree repair and recovery
  - `SessionProcessService.ts` - Claude CLI process execution
  - `McpAdapter.ts` - MCP server spawning
- Depends on: Git service, validation, errors, utilities
- Used by: Extension, commands, providers

**Command Layer:**
- Purpose: Route UI actions to services
- Location: `src/commands/`
- Contains:
  - `sessionCommands.ts` - Session lifecycle commands (create, delete, open, clear)
  - `workflowCommands.ts` - Workflow operations (validate, create templates)
  - `repairCommands.ts` - Worktree repair commands
  - `index.ts` - Command registration hub
- Depends on: Services, providers, error handling
- Used by: Extension

**Git Abstraction:**
- Purpose: Centralize git operations with VS Code Git extension integration
- Location: `src/gitService.ts`
- Contains: `execGit()` function, git path initialization
- Depends on: VS Code Git extension API
- Used by: Services (SessionService, DiffService, SettingsService)

**MCP/Workflow Layer:**
- Purpose: Execute workflows in isolated Claude sessions
- Location: `src/mcp/`, `src/workflow/`
- Contains:
  - `mcp/server.ts` - MCP server subprocess entry point
  - `mcp/tools.ts` - MCP tool implementations (workflow_status, workflow_advance, etc.)
  - `workflow/types.ts` - Workflow template and state type definitions
  - `workflow/state.ts` - WorkflowStateMachine state machine
  - `workflow/loader.ts` - YAML workflow template loading
  - `workflow/discovery.ts` - Workflow file discovery
- Depends on: @modelcontextprotocol/sdk
- Used by: SessionService (spawns subprocess), Tools access state

**Validation & Errors:**
- Purpose: Input validation and structured error handling
- Location: `src/validation/`, `src/errors/`
- Contains:
  - `errors/LanesError.ts` - Base error with discriminated union pattern
  - `errors/GitError.ts` - Git operation failures
  - `errors/ValidationError.ts` - User input validation failures
  - `validation/validators.ts` - Core validators (session names, branch names, paths)
  - `validation/pathSanitizer.ts` - Path security checks
  - `validation/schemas.ts` - YAML schema validation
- Depends on: None (utilities only)
- Used by: Services, commands, extension

**Utilities & Helpers:**
- Purpose: Reusable functions and shared constants
- Location: `src/utils.ts`, `src/localSettings.ts`, `src/AsyncQueue.ts`, `src/codeAgents/`
- Contains:
  - `AsyncQueue.ts` - Zero-dependency async task queue for race condition prevention
  - `utils.ts` - Error messages, validation result type, sanitization
  - `localSettings.ts` - `.claude/settings.local.json` propagation
  - `codeAgents/CodeAgent.ts` - Abstract base for agent-specific behavior
  - `codeAgents/ClaudeCodeAgent.ts` - Claude Code specific implementation
- Depends on: None or minimal
- Used by: All layers

## Data Flow

**Session Creation Flow:**

1. **User Input** → SessionFormProvider (webview) collects name, prompt, branch, permissions, workflow
2. **Form Submission** → Callback to `createSession()` in SessionService
3. **Validation** → validateSessionName, validateBranchName in validation layer
4. **Git Operations** → SessionService calls `execGit()` to create worktree
5. **File Setup** → SessionService creates prompt file, chime setting, session ID
6. **Terminal Launch** → SessionService calls TerminalService to spawn Claude process
7. **Workflow Setup** (optional) → SessionService spawns MCP server subprocess if workflow provided
8. **UI Update** → ClaudeSessionProvider refreshes tree, displays new session

**Workflow Execution Flow:**

1. **Session Open with Workflow** → Terminal launches Claude with MCP server stdio transport
2. **Claude Calls MCP Tool** → e.g., `workflow_status` to get current step
3. **MCP Server** (src/mcp/server.ts) handles tool call
4. **State Machine** (WorkflowStateMachine) computes response based on WorkflowState
5. **Response to Claude** → Instructions, agent info, task context
6. **Claude Executes Work** → Returns tool output
7. **Advance Step** → Claude calls `workflow_advance` with output
8. **State Persistence** → Updated WorkflowState written to `workflow-state.json`
9. **Workflow Complete/Failed** → Terminal closes or Claude handles error

**Configuration Change Flow:**

1. **User Changes Setting** → VS Code fires `onDidChangeConfiguration`
2. **Extension Listens** → extension.ts catches configuration change
3. **Service Refresh** → Settings reload, hooks regenerated if storage location changes
4. **UI Update** → Providers refresh if affected

**State Management:**

- **Session State**: Distributed across files (`.claude-session`, `.claude-status`, `.chime-enabled`)
- **Workflow State**: Persisted to `workflow-state.json` in worktree root
- **Global Storage**: Optional VS Code global storage (defaults to enabled) or repo-local `.lanes/session_management/`
- **Settings**: VS Code workspace configuration (`lanes.*` settings)
- **Context Keys**: VS Code command context for UI visibility (e.g., `lanes.chimeEnabled`, `lanes.hasWorkflow`)

## Key Abstractions

**ClaudeSessionProvider:**
- Purpose: Tree data provider for session list, tracks running sessions, status icons
- Examples: `src/ClaudeSessionProvider.ts`
- Pattern: TreeDataProvider with event-driven refresh via FileWatcher
- Key methods: `getChildren()`, `getTreeItem()`, refresh events

**ServiceContainer:**
- Purpose: Dependency injection container passed to command registration
- Examples: `src/types/serviceContainer.d.ts`
- Pattern: Interface-based DI, passed as parameter
- Contains: All services, providers, paths, context

**WorkflowStateMachine:**
- Purpose: Tracks position in workflow, advances through steps/loops/tasks
- Examples: `src/workflow/state.ts`
- Pattern: State machine with immutable state snapshots
- Key methods: `getCurrentStatus()`, `advance()`, `getState()`

**CodeAgent:**
- Purpose: Abstract interface for agent-specific behavior (Claude Code, other agents)
- Examples: `src/codeAgents/CodeAgent.ts`, `src/codeAgents/ClaudeCodeAgent.ts`
- Pattern: Strategy pattern - inject at extension initialization
- Customizes: Session file names, terminal commands, display names

**LanesError & Subclasses:**
- Purpose: Type-safe error handling with discriminated union pattern
- Examples: `src/errors/LanesError.ts`, `src/errors/GitError.ts`, `src/errors/ValidationError.ts`
- Pattern: Abstract base with `kind` discriminator + `userMessage` field
- Usage: `catch (err) { if (err instanceof GitError) ... }`

**AsyncQueue:**
- Purpose: Serialize async operations to prevent race conditions
- Examples: `src/AsyncQueue.ts`
- Pattern: FIFO task queue with timeout support
- Usage: `await queue.add(async () => { ... }, 30000)`

## Entry Points

**Extension Activation:**
- Location: `src/extension.ts`, exported `activate(context: ExtensionContext)`
- Triggers: VS Code startup (activationEvents: `onStartupFinished`)
- Responsibilities:
  - Initialize git path from VS Code Git extension
  - Create service container and initialize services
  - Register tree data providers (ClaudeSessionProvider, PreviousSessionProvider, WorkflowsProvider)
  - Register webview provider (SessionFormProvider)
  - Register all commands
  - Register file system watchers
  - Check for broken worktrees

**Main Extension Bundle:**
- Location: `package.json` `"main": "./out/extension.bundle.js"`
- Built by: `npm run bundle:extension` (esbuild)
- Entry: `src/extension.ts` → `activate()` export

**MCP Server Entry Point:**
- Location: `src/mcp/server.ts`
- Spawned by: TerminalService (separate Node.js subprocess)
- Entry: Global script execution (CLI args: `--worktree`, `--workflow-path`, `--repo-root`)
- Responsibilities:
  - Load workflow template from YAML
  - Create MCP server with stdio transport
  - Handle tool calls from Claude
  - Maintain workflow state machine
  - Persist state to `workflow-state.json`

**Command Entry Points (Top-level):**
- `claudeWorktrees.createSession` → `registerSessionCommands` → `createSession()`
- `claudeWorktrees.deleteSession` → `registerSessionCommands` → Delete logic
- `claudeWorktrees.openSession` → `registerSessionCommands` → Open logic
- `lanes.createWorkflow` → `registerWorkflowCommands` → Create template
- `lanes.validateWorkflow` → `registerWorkflowCommands` → Validate template
- `lanes.repairBrokenWorktrees` → `registerRepairCommands` → BrokenWorktreeService

## Error Handling

**Strategy:** Discriminated union with `kind` property for type-safe narrowing.

**Patterns:**

```typescript
// Error throwing in service
if (!sessionName || sessionName.trim().length === 0) {
    throw new ValidationError('Session name cannot be empty', 'Please provide a non-empty session name');
}

// Error handling in command
try {
    await createSession(...);
} catch (err) {
    if (err instanceof ValidationError && err.kind === 'validation') {
        vscode.window.showErrorMessage(err.userMessage);
    } else if (err instanceof GitError && err.kind === 'git') {
        vscode.window.showErrorMessage(`Git error: ${err.userMessage}`);
    } else {
        vscode.window.showErrorMessage(`Unexpected error: ${getErrorMessage(err)}`);
    }
}

// Service-level error wrapping
try {
    await execGit(['worktree', 'add', ...], cwd);
} catch (err) {
    throw new GitError(
        `Failed to create worktree: ${getErrorMessage(err)}`,
        `Could not create session worktree. Check that the branch exists and worktree directory is empty.`
    );
}
```

## Cross-Cutting Concerns

**Logging:** Console-based, no external logging framework. Use `console.log()` for info, `console.error()` for errors, `console.warn()` for warnings.

**Validation:** Always validate at input boundary. Use validators from `src/validation/validators.ts`. Never trust user input for paths or commands.

**Authentication:** None required (VS Code API handles auth to local git). MCP server runs in user's worktree context.

**Authorization:** Implicit - user controls session creation/deletion through extension UI.

**Path Handling:** Always use `path.normalize()` before filesystem operations. Reject traversal sequences (`..`) in user-provided paths. Separate file paths into repo-relative and absolute components.

**Git Integration:** Use `execGit()` from gitService instead of shell execution. Always validate branch names before git operations.

**Settings Propagation:** LocalSettings can copy or symlink `.claude/settings.local.json` to worktrees based on `lanes.localSettingsPropagation` config.

---

*Architecture analysis: 2026-02-09*
