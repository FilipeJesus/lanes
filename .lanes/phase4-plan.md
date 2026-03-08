# Phase 4: VS Code as Daemon Client — Task Plan

## Goal

Enable the VS Code extension to operate as a client of the Lanes daemon, routing operations through the REST API instead of making direct core service calls. This enables remote UI scenarios and unifies the execution path.

## Architecture Analysis

### Current State

The VS Code extension currently calls core services directly:
- `createSessionWorktree()` from `src/core/services/SessionCreationService.ts`
- `DiffService.generateDiffContent()` / `DiffService.generateDiffFiles()`
- `SessionDataService` for reading session data/status
- `BrokenWorktreeService` for worktree repair
- `generateInsights()` / `analyzeInsights()` from `InsightsService`
- `execGit()` for git operations
- `WorkflowService` for workflow listing/validation
- `CodeAgentFactory` for agent config
- Config via `VscodeConfigProvider`

### Target State

When `lanes.useDaemon` is enabled:
1. A `DaemonClient` HTTP client routes operations to the daemon's REST API
2. The daemon handles all core logic (session CRUD, git, diff, workflows, etc.)
3. VS Code-specific operations (terminals, UI dialogs, tree views) remain local
4. SSE subscription provides real-time session status updates
5. Daemon is auto-started if not running

### Boundary: What Routes Through Daemon vs. Stays Local

**Through Daemon (28 REST endpoints):**
- Session list, create, delete, status, open, clear, pin, unpin
- Git branches, diff, diff files, worktree info, repair
- Workflow list, validate, create, get state
- Agent list, agent config
- Config get, set, get all
- Terminal create, send, list (tmux)
- Insights
- Discovery, health

**Stays in VS Code:**
- Terminal creation (`vscode.window.createTerminal`)
- UI interactions (dialogs, quick picks, input boxes)
- File opening in editor
- Tree view rendering
- File system watching (in local mode; SSE in daemon mode)
- Extension context/storage

## Tasks

### Task 1: DaemonClient (`src/daemon/client.ts`)

Create a typed HTTP client class that wraps all REST endpoints + SSE subscription.

**Scope:**
- `DaemonClient` class with constructor taking `{ port, token }` or `{ baseUrl, token }`
- Methods for all 28+ REST endpoints, organized by category:
  - `health()`, `discovery()`
  - `listSessions()`, `createSession(opts)`, `deleteSession(name)`, `getSessionStatus(name)`, `openSession(name, opts)`, `clearSession(name)`, `pinSession(name)`, `unpinSession(name)`
  - `getSessionInsights(name, opts)`
  - `listBranches(opts)`, `getSessionDiff(name, opts)`, `getSessionDiffFiles(name, opts)`, `getWorktreeInfo(name)`, `repairWorktrees(opts)`
  - `listWorkflows(opts)`, `validateWorkflow(path)`, `createWorkflow(name, content)`, `getWorkflowState(name)`
  - `listAgents()`, `getAgentConfig(name)`
  - `getConfig(key)`, `setConfig(key, value)`, `getAllConfig()`
  - `listTerminals(opts)`, `createTerminal(opts)`, `sendToTerminal(name, text)`
  - `subscribeEvents(callbacks)` — SSE subscription with reconnection
- Error handling: map HTTP 400/401/404/500 to typed errors
- Connection management: timeout, retry on transient failures
- Token loading utility: `DaemonClient.fromWorkspace(workspaceRoot)` static factory
- Tests

**Key files to create:**
- `src/daemon/client.ts`
- `src/test/daemon/client.test.ts`

**Key files to reference:**
- `src/daemon/router.ts` (endpoint signatures)
- `src/daemon/auth.ts` (token format)
- `src/daemon/lifecycle.ts` (port/token file paths)

### Task 2: VS Code Daemon Integration

Wire the DaemonClient into the VS Code extension with a config option and auto-start.

**Scope:**
- Add `lanes.useDaemon` (boolean, default: false) to `package.json` contributes.configuration
- Create `src/vscode/services/DaemonService.ts`:
  - Auto-start daemon if not running (using lifecycle.ts functions)
  - Manage DaemonClient instance lifecycle
  - SSE subscription for real-time status/file-change events
  - Reconnection logic on daemon restart
  - Cleanup on extension deactivation
- Modify `src/vscode/extension.ts`:
  - Initialize DaemonService when `lanes.useDaemon` is true
  - Pass DaemonClient to commands that need it
  - Listen for config changes to toggle daemon mode
- Modify commands (in `src/vscode/commands/sessionCommands.ts`) to use DaemonClient when available:
  - Session creation: use `client.createSession()` instead of `createSessionWorktree()`
  - Session deletion: use `client.deleteSession()` instead of direct git/fs calls
  - Session listing/status: via daemon instead of direct file reads
  - Diff generation: use `client.getSessionDiff()` / `client.getSessionDiffFiles()`
  - Insights: use `client.getSessionInsights()`
  - Pin/unpin: use `client.pinSession()` / `client.unpinSession()`
- Modify providers to use DaemonClient for data:
  - `AgentSessionProvider.ts`: fetch sessions via daemon
  - SSE events trigger tree refresh instead of file watchers
- Tests

**Key files to create:**
- `src/vscode/services/DaemonService.ts`
- `src/test/vscode/services/DaemonService.test.ts`

**Key files to modify:**
- `package.json` (config option)
- `src/vscode/extension.ts` (initialization)
- `src/vscode/commands/sessionCommands.ts` (routing)
- `src/vscode/providers/AgentSessionProvider.ts` (data fetching)

## Dependencies

Task 2 depends on Task 1 (DaemonClient must exist before VS Code integration can use it).

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single `DaemonClient` class | Mirrors the single `SessionHandlerService` — one client, one server |
| Static factory `fromWorkspace()` | Encapsulates token/port file reading for convenience |
| SSE with auto-reconnect | Daemon may restart; client should recover transparently |
| Default `useDaemon: false` | Non-breaking change; users opt-in |
| Graceful fallback | If daemon is unreachable, show error but don't crash extension |
| Commands check for client | Simple `if (daemonClient) { ... } else { ... }` pattern in commands |
