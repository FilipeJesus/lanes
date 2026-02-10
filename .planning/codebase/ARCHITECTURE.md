# Architecture

**Analysis Date:** 2026-02-10

## Pattern Overview

**Overall:** Layered VS Code extension with service-driven architecture

Lanes is a VS Code extension that manages isolated Claude Code sessions using Git worktrees. The architecture separates concerns into distinct layers: VS Code integration (commands, tree providers, webviews), domain services (session/terminal/workflow management), and infrastructure services (git, file I/O, MCP). Each layer has well-defined dependencies flowing downward.

**Key Characteristics:**
- **Layered service architecture** - UI layer depends on service layer, service layer depends on infrastructure
- **Provider pattern** - TreeDataProviders for sidebar views, WebviewViewProvider for session form
- **Dependency injection** - ServiceContainer passed through to commands and event handlers
- **File-based state management** - Persists session metadata via `.claude-session` and `.claude-status` files
- **Asynchronous queue** - AsyncQueue prevents race conditions during concurrent session creation
- **Code agent abstraction** - CodeAgent interface allows support for different CLI agents (Claude, OpenCode, etc.)
- **Global storage isolation** - Session files can be stored in VS Code global storage or worktree directories
- **MCP server integration** - Standalone MCP server for workflow control and artifact tracking

## Layers

**UI Layer (Commands & Providers):**
- Purpose: Manages VS Code UI interactions, command handling, and sidebar views
- Location: `src/extension.ts`, `src/commands/`, `src/ClaudeSessionProvider.ts`, `src/SessionFormProvider.ts`, `src/PreviousSessionProvider.ts`, `src/WorkflowsProvider.ts`
- Contains: Command registration, tree view providers, webview form, event subscriptions
- Depends on: Service layer for all business logic
- Used by: VS Code extension runtime

**Service Layer (Domain Logic):**
- Purpose: Encapsulates core business logic for sessions, workflows, terminals, and git operations
- Location: `src/services/SessionService.ts`, `src/services/TerminalService.ts`, `src/services/WorkflowService.ts`, `src/services/SettingsService.ts`, `src/services/DiffService.ts`, `src/services/BrokenWorktreeService.ts`, `src/ProjectManagerService.ts`
- Contains: Session creation, workflow management, terminal lifecycle, settings propagation, diff generation, broken worktree repair
- Depends on: Infrastructure layer (FileService, git operations)
- Used by: UI layer commands and providers

**Infrastructure Layer (Utilities & I/O):**
- Purpose: Low-level operations for file I/O, git commands, validation, and error handling
- Location: `src/services/FileService.ts`, `src/gitService.ts`, `src/utils.ts`, `src/validation/`, `src/errors/`, `src/AsyncQueue.ts`, `src/localSettings.ts`
- Contains: File operations, git execution, name sanitization, input validation, error classes
- Depends on: Node.js APIs and external libraries
- Used by: Service layer

**Workflow Engine (MCP Integration):**
- Purpose: Manages workflow template loading, validation, and MCP server lifecycle
- Location: `src/workflow/`, `src/mcp/`
- Contains: Workflow types, state management, MCP server, workflow discovery, MCP tools
- Depends on: Service layer for file operations and git access
- Used by: Session creation and workflow commands

**Code Agent Abstraction:**
- Purpose: Provides abstraction layer for supporting multiple code agents (Claude, OpenCode, Codex, etc.)
- Location: `src/codeAgents/CodeAgent.ts`, `src/codeAgents/ClaudeCodeAgent.ts`
- Contains: Agent configuration, session/status file naming, permission modes
- Depends on: Nothing (pure configuration)
- Used by: All layers for agent-specific file naming and commands

## Data Flow

**Session Creation Flow:**

1. User submits session form (webview in `SessionFormProvider`)
2. `createSession()` in `SessionService` is invoked
3. Session name is sanitized via `sanitizeSessionName()` in `utils.ts`
4. Session name is validated against git branch naming rules
5. New git worktree is created via `execGit(['worktree', 'add', ...])`
6. Extension settings file is created in worktree via `SettingsService.getOrCreateExtensionSettingsFile()`
7. Local settings are propagated via `propagateLocalSettings()` if configured
8. Session metadata is saved to `.claude-session` file in worktree or global storage
9. Terminal is opened in worktree via `openClaudeTerminal()`
10. `sessionProvider.refresh()` triggers tree view update to show new session

**Status Update Flow:**

1. File watcher detects `.claude-status` file change in worktree
2. Watcher invokes `sessionProvider.refresh()`
3. `getChildren()` method reads all worktree directories
4. For each worktree, status is read from `.claude-status` file
5. ClaudeSessionItem icon is updated based on status value
6. Tree view is refreshed to show new icon
7. If chime is enabled, audio notification plays

**Workflow Execution Flow:**

1. Workflow YAML template is loaded from `.lanes/workflows/` or built-in workflows
2. `WorkflowService.loadWorkflow()` parses YAML and validates against schema
3. Session is created with `workflow` parameter set to template name
4. MCP server is started with `workflow-state.json` in session directory
5. Claude Code invokes MCP tools to advance through workflow steps
6. Tool outputs are persisted to `workflow-state.json`
7. Session status updates trigger workflow status icon display
8. On session completion, workflow state persists for later reference

**State Management:**

- **Per-session state**: Stored in `.claude-session` file (JSON) containing sessionId, timestamp, workflow name, permission mode, chime status
- **Session status**: Stored in `.claude-status` file (JSON) with status field ('working', 'waiting_for_user', 'idle', 'error')
- **Workflow state**: Stored in `workflow-state.json` (JSON) with current step, task progress, and step outputs
- **Extension settings**: Stored in `.lanes/session_management/{sessionName}/settings.json` (when not using global storage)
- **Global storage**: When enabled, files are stored in `~/.vscode/extensions/.../global-storage/{repoIdentifier}/{sessionName}/`
- **Prompts**: Stored in configured folder (default: VS Code global storage under `{repoIdentifier}/prompts/`)

## Key Abstractions

**ClaudeSessionProvider (Tree Data Provider):**
- Purpose: Provides tree view structure for active sessions sidebar
- Examples: `src/ClaudeSessionProvider.ts`
- Pattern: Implements `vscode.TreeDataProvider<SessionItem>`, uses `_onDidChangeTreeData` event emitter for updates

**SessionFormProvider (Webview Provider):**
- Purpose: Renders form for creating new sessions in sidebar
- Examples: `src/SessionFormProvider.ts`
- Pattern: Implements `vscode.WebviewViewProvider`, maintains callback handlers for form submission

**CodeAgent (Interface):**
- Purpose: Abstracts agent-specific configuration (file naming, CLI commands, permission modes)
- Examples: `src/codeAgents/CodeAgent.ts`, `src/codeAgents/ClaudeCodeAgent.ts`
- Pattern: Interface with concrete implementations per agent type

**ServiceContainer (Dependency Injection):**
- Purpose: Passes all dependencies to commands and services
- Examples: `src/types/serviceContainer.d.ts`
- Pattern: Contains references to extension context, providers, paths, and code agent

**AsyncQueue (Serial Execution):**
- Purpose: Prevents race conditions by serializing async operations
- Examples: `src/AsyncQueue.ts`
- Pattern: Queue-based execution model where tasks await previous completion

## Entry Points

**`src/extension.ts` - activate():**
- Location: `src/extension.ts` lines 59-275
- Triggers: When extension is activated on VS Code startup
- Responsibilities: Initialize all services, providers, watchers, and command handlers; set up global storage context

**Session Form Submission:**
- Location: `src/extension.ts` line 156
- Triggers: When user submits the session creation form
- Responsibilities: Validate form data, create session, refresh UI

**File System Watcher Events:**
- Location: `src/watchers.ts` lines 44-100+
- Triggers: When `.claude-status`, `.claude-session`, or workflow files change
- Responsibilities: Refresh tree views, update icons, trigger MCP request processing

**Command Handlers:**
- Location: `src/commands/sessionCommands.ts`, `src/commands/workflowCommands.ts`
- Triggers: When user invokes command from palette, context menu, or keybinding
- Responsibilities: Execute session/workflow operations, show UI dialogs, call services

**MCP Server Tools:**
- Location: `src/mcp/tools.ts`
- Triggers: When Claude Code invokes MCP tools during workflow execution
- Responsibilities: Track artifacts, advance workflow steps, return context

## Error Handling

**Strategy:** Hierarchical error classes with context preservation

**Patterns:**
- `LanesError` - Base error class with message and context
- `GitError` - Wraps git command failures with command and stderr
- `ValidationError` - Input validation failures with field and reason
- Error messages are surfaced to user via `vscode.window.showErrorMessage()` when appropriate
- Git errors are caught and analyzed to determine if worktree is broken (missing directory, detached HEAD)
- Validation errors are caught early and prevent operations rather than failing mid-operation

## Cross-Cutting Concerns

**Logging:** Uses `console.log()`, `console.warn()`, and `console.error()` throughout. Key milestones logged:
- Extension activation (`console.log('Congratulations, "Lanes" is now active!')`)
- Service initialization
- Session creation steps
- Worktree repairs
- Configuration changes

**Validation:** Multi-stage approach:
- Session names: Sanitized via `sanitizeSessionName()`, validated against schema in `validation/validators.ts`
- Branch names: Validated via `validateBranchName()` before git operations
- Workflows: YAML schemas defined in `validation/schemas.ts`, validated before loading
- Permission modes: Validated via `isValidPermissionMode()` to prevent injection
- Paths: Sanitized to prevent directory traversal via `pathSanitizer.ts`

**Authentication:** Handled by VS Code Git extension integration:
- `initializeGitPath()` retrieves git executable path from VS Code Git extension
- All git operations use this resolved git path
- SSH/credential authentication delegated to git and SSH agent

---

*Architecture analysis: 2026-02-10*
