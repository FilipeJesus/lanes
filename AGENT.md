# Lanes - Development Guidelines

## Project Overview

Lanes is a cross-IDE tool for managing isolated AI coding sessions using Git worktrees. It ships as a VS Code extension, a JetBrains IDE plugin, a standalone CLI, an HTTP daemon with REST API, and a browser-based web UI. Each session gets its own worktree, terminal, and code agent process, enabling parallel AI-assisted development.

Supported code agents: Claude Code, Codex (OpenAI), Cortex (Snowflake), Gemini (Google), OpenCode.

## Directory Structure

```
src/
├── core/                     # Platform-agnostic core library
│   ├── codeAgents/           # Agent implementations (Claude, Codex, Cortex, Gemini, OpenCode) + factory
│   ├── errors/               # Typed errors (LanesError, GitError, ValidationError)
│   ├── interfaces/           # Platform abstractions (IConfigProvider, IHandlerContext, etc.)
│   ├── services/             # Business logic (SessionHandlerService, diff, insights, etc.)
│   ├── session/              # Session types + SessionDataService
│   ├── validation/           # Input validation & path sanitization
│   └── workflow/             # Workflow state machine & YAML template loading
├── daemon/                   # HTTP daemon + REST API
│   ├── server.ts             # Daemon entry point (--workspace, --port)
│   ├── router.ts             # REST router (29 endpoints + auth middleware + CORS)
│   ├── auth.ts               # Token generation + SHA-256 constant-time validation
│   ├── lifecycle.ts          # start/stop/isDaemonRunning + PID/port file I/O
│   ├── registry.ts           # Global daemon registry (~/.lanes/daemons.json)
│   ├── gateway.ts            # Web UI gateway (static serving + daemon discovery)
│   ├── client.ts             # DaemonClient (typed HTTP client for all endpoints + SSE)
│   ├── config.ts             # DaemonConfigStore (ISimpleConfigStore)
│   ├── notifications.ts      # SSE notification emitter
│   ├── fileWatcher.ts        # File watcher (chokidar + picomatch)
│   └── index.ts              # Barrel re-exports
├── vscode/                   # VS Code extension
│   ├── adapters/             # Platform adapter implementations
│   ├── commands/             # Command handlers (session, workflow, repair)
│   ├── providers/            # Tree views + webviews (sessions, forms, diffs, workflows)
│   └── services/             # VS Code-specific services (terminal, polling, DaemonService)
├── cli/                      # Standalone CLI (`lanes` command, Commander.js)
│   ├── adapters/             # CLI platform adapters
│   └── commands/             # list, create, delete, open, diff, daemon, web, etc.
├── mcp/                      # MCP server (workflow tools, stdio transport)
├── jetbrains-ide-bridge/     # JetBrains IDE HTTP bridge (thin adapter over SessionHandlerService)
├── test/                     # Test suite (mirrors source structure)
└── types/                    # Global TypeScript type definitions

web-ui/                       # Browser dashboard (React 19 + Vite 6 + TypeScript)
├── src/
│   ├── api/                  # DaemonApiClient, DaemonSseClient, gateway, types
│   ├── components/           # UI components (SessionCard, DiffViewer, StepProgressTracker, etc.)
│   ├── hooks/                # React hooks (useSessions, useDaemons, useDiff, etc.)
│   ├── pages/                # Dashboard, ProjectDetail, SessionDetail, WorkflowBrowser
│   ├── utils/                # Helpers (formatUptime, etc.)
│   └── test/                 # Vitest + Testing Library tests
jetbrains-ide-plugin/         # Kotlin JetBrains plugin (separate Gradle build)
scripts/                      # Build, bundle & install scripts
docs/                         # Documentation site
```

## Architecture

### Platform Abstraction

Core business logic lives in `src/core/` and is platform-agnostic. Platform-specific code (VS Code, CLI, JetBrains, Daemon) implements the interfaces in `src/core/interfaces/`:

| Interface | VS Code Adapter | CLI Adapter | Daemon Adapter |
|-----------|----------------|-------------|----------------|
| `IConfigProvider` | `VscodeConfigProvider` | `CliConfigProvider` | — |
| `IStorageProvider` | `VscodeStorageProvider` | `CliStorageProvider` | — |
| `IGitPathResolver` | `VscodeGitPathResolver` | `CliGitPathResolver` | — |
| `IFileWatcher` | `VscodeFileWatcher` | — | — |
| `ITerminalBackend` | `VscodeTerminalBackend` | — | — |
| `IUIProvider` | `VscodeUIProvider` | — | — |
| `ISimpleConfigStore` | — | — | `DaemonConfigStore` |
| `INotificationEmitter` | — | — | `DaemonNotificationEmitter` |
| `IFileWatchManager` | — | — | `DaemonFileWatchManager` |
| `IHandlerContext` | — | — | Built in `server.ts` |

### Handler Layer

`SessionHandlerService` (`src/core/services/SessionHandlerService.ts`) provides 28 platform-agnostic handler methods grouped into 7 categories (sessions, git, config, workflow, agents, terminals, file watching). It accepts an `IHandlerContext` and is consumed by both the JetBrains bridge (JSON-RPC) and the daemon router (REST). This avoids duplicating ~1000 lines of business logic.

### Storage

Session state is stored locally in the repository at `.lanes/current-sessions/<sessionName>/`. Each session has:
- `.claude-session` (or agent-specific file) — session data
- `.claude-status` (or agent-specific file) — session status
- `workflow-state.json` — workflow state (in the worktree)

Daemon-specific files in `.lanes/`:
- `daemon.pid` — daemon process ID
- `daemon.port` — daemon listening port
- `daemon.token` — auth token (mode `0o600`)
- `daemon-config.json` — daemon-local config store

Global registry at `~/.lanes/daemons.json` tracks all running daemons across projects.

### Code Agent System

The `CodeAgent` abstract base class (`src/core/codeAgents/CodeAgent.ts`) defines the contract. Each agent provides its CLI command, session/status file names, settings file locations, and permission modes. Use `factory.ts` to instantiate agents.

### Daemon System

The daemon (`src/daemon/`) is a standalone HTTP server that exposes the full Lanes API over REST + SSE:

- **`server.ts`** — Entry point. Accepts `--workspace` and `--port` args. Builds `IHandlerContext`, writes PID/port/token files, registers in global registry, sets up file watchers, graceful shutdown.
- **`router.ts`** — 29 REST endpoints with Bearer token auth, CORS, 1 MiB body limit. Routes map to `SessionHandlerService` methods.
- **`auth.ts`** — 32-byte hex token generation. Validates via SHA-256 + `timingSafeEqual` (prevents length leakage).
- **`lifecycle.ts`** — `startDaemon()`, `stopDaemon()`, `isDaemonRunning()`, `getDaemonPort()`, `getDaemonPid()`. Cleans stale PID files.
- **`registry.ts`** — Global registry at `~/.lanes/daemons.json`. Atomic writes via temp file + `fs.rename`. `cleanStaleEntries()` removes dead PIDs.
- **`client.ts`** — `DaemonClient` typed HTTP client with all 29 endpoint methods + SSE subscription with exponential backoff reconnection (1s→30s max).
- **`gateway.ts`** — Lightweight HTTP server for the web UI. Serves static files from `out/web-ui/`, exposes `GET /api/gateway/daemons` for daemon discovery. Path traversal protection.
- **`notifications.ts`** — SSE emitter. Events: `sessionStatusChanged`, `fileChanged`, `sessionCreated`, `sessionDeleted`.
- **`fileWatcher.ts`** — Watches `.lanes/current-sessions/**/*` and `<worktreesFolder>/**/workflow-state.json` via chokidar. Auto-notifies via SSE.

### VS Code Daemon Integration

When `lanes.useDaemon` is enabled in VS Code settings:
- `DaemonService` (`src/vscode/services/DaemonService.ts`) auto-starts the daemon if not running, creates a `DaemonClient`, and subscribes to SSE events.
- Session commands (create, delete, diff, insights, pin/unpin) route through the daemon REST API instead of calling core services directly.
- `AgentSessionProvider` fetches sessions from daemon and uses daemon-provided `isPinned` as source of truth.
- Falls back to direct mode gracefully if daemon is unavailable.

### Web UI

The browser dashboard (`web-ui/`) is a separate React 19 + Vite 6 + TypeScript package:
- **API layer** (`web-ui/src/api/`) — `DaemonApiClient` (typed fetch wrappers), `DaemonSseClient` (ReadableStream-based SSE with auth headers), API types.
- **Pages** — Dashboard (multi-project grid), ProjectDetail (session list + SSE), SessionDetail (diff viewer, insights, workflow tracker), WorkflowBrowser (template browser with search/filter).
- **Hooks** — `useDaemons`, `useSessions`, `useDaemonConnection`, `useDiff`, `useInsights`, `useWorkflow`, `useWorkflows`.
- **Components** — StatusBadge, SessionCard, ProjectCard, DiffViewer, FileList, InsightsPanel, StepProgressTracker, WorkflowTaskList, WorkflowDetail, ConfirmDialog, CreateSessionDialog.

### Bundling

Four esbuild bundles + one Vite build are produced:

| Bundle | Entry | Output | Purpose |
|--------|-------|--------|---------|
| Extension | `src/extension.ts` | `out/extension.bundle.js` | VS Code extension |
| MCP Server | `src/mcp/server.ts` | `out/mcp/server.js` | Workflow MCP server |
| CLI | `src/cli/cli.ts` | `out/cli.js` | `lanes` CLI tool |
| Daemon | `src/daemon/server.ts` | `out/daemon.js` | HTTP daemon server |
| Web UI | `web-ui/src/main.tsx` | `out/web-ui/` | Browser dashboard (Vite) |

## Conventions

### Code Style

- **Async I/O only** — Synchronous `fs` methods (`readFileSync`, `existsSync`, etc.) are banned via ESLint and will error. Use `fs/promises` and `async/await`. See `FileService.ts` for helpers.
- **Test files** are exempt from the sync fs ban.
- **Naming** — `camelCase` for variables/functions, `PascalCase` for classes/interfaces/types. Interfaces are prefixed with `I` (e.g., `IConfigProvider`).
- **Imports** — `camelCase` or `PascalCase` only (enforced by ESLint).
- **Strict TypeScript** — `strict: true` in tsconfig, target ES2022.

### Commit Messages

Enforced via commitlint + husky `commit-msg` hook. Uses [Conventional Commits](https://www.conventionalcommits.org/).

Format: `type(scope): description`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat: add tmux terminal backend`
- `fix(sessions): prevent duplicate worktree creation`
- `chore: release v1.4.0`

### Pre-commit Hooks

The husky `pre-commit` hook runs compile, lint, and test. All must pass before a commit is accepted.

## Commands

```bash
# Build
npm run compile              # TypeScript compile + bundle all four targets (extension, mcp, cli, daemon)
npm run bundle:extension     # Bundle VS Code extension only
npm run bundle:mcp           # Bundle MCP server only
npm run bundle:cli           # Bundle CLI only
npm run bundle:daemon        # Bundle daemon server only
npm run watch                # TypeScript watch mode (no bundling)

# Web UI (separate package)
cd web-ui && npm install && npm run build   # Build web UI to out/web-ui/
cd web-ui && npx vitest run                 # Run web UI tests

# Quality
npm run lint                 # ESLint
npm test                     # Full test suite (compile + lint + vscode-test)

# Release
npm run changelog            # Generate CHANGELOG from commits
npm run release              # Interactive release
npm run release:patch        # Patch release
npm run release:minor        # Minor release

# Local install
./scripts/install-local-vscode.sh  # Install extension locally
./scripts/install-local-cli.sh     # Install CLI locally
./scripts/install-local-idea.sh    # Install JetBrains plugin locally

# Debug
# Press F5 in VS Code to launch Extension Development Host
```

### Testing

- **Main project (Mocha)**: via `@vscode/test-cli` + `@vscode/test-electron`
  - **Mocking**: Sinon for stubs/spies, memfs for virtual file systems
  - **Config**: `.vscode-test.mjs` — runs all `out/test/**/*.test.js` files
  - **Run**: `npm test` (compiles, lints, then runs tests)
  - Test files live in `src/test/` mirroring the source structure
- **Web UI (Vitest)**: via Vitest + `@testing-library/react`
  - **Run**: `cd web-ui && npx vitest run`
  - Test files live in `web-ui/src/test/` mirroring the web-ui source structure

## Workflow System

Lanes uses a structured workflow system managed via MCP tools. Workflow templates are YAML files loaded from `.lanes/workflows/` or a custom folder.

### MCP Tools

| Tool | Purpose |
|------|---------|
| `workflow_start` / `workflow_start_from_path` | Initialize a workflow |
| `workflow_status` | Get current position and instructions |
| `workflow_set_tasks` | Define tasks for loop steps |
| `workflow_advance` | Complete current step, move to next |
| `workflow_context` | Retrieve outputs from previous steps |
| `workflow_track_artefacts` | Track file paths produced by steps |

Workflow state persists to `workflow-state.json` in the worktree and auto-resumes on MCP server restart.

## Local Settings Propagation

When creating a session, Lanes can propagate `.claude/settings.local.json` from the base repo to each worktree:

```json
{ "lanes.localSettingsPropagation": "copy" }  // "copy" | "symlink" | "disabled"
```

## Agent Summary

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `coder` | Plan tests + implement features | Each coding task |
| `vscode-expert` | VS Code API verification | Called by coder |
| `shell-ops` | Git/shell safety checks | Called by coder |
| `test-engineer` | Implement planned tests | After each feature |
| `code-reviewer` | Code quality review | After tests pass |

## Constraints

- Always run tests before committing: `npm test`
- Pre-commit hook enforces: compile, lint, and test
- Commit-msg hook enforces: conventional commit format
- Never commit code that breaks existing tests
- Keep changes focused and minimal
- No synchronous fs methods in production code
