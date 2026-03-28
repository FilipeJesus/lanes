# Lanes v2.0 — Daemon & REST API

## Context

Lanes currently has multiple entry points (VS Code, CLI, and the daemon/web stack) all calling `src/core/` directly. The vision for v2 is a **remote web UI** that can manage sessions across multiple projects via REST. This requires a standalone daemon process — something that can't live inside a VS Code extension.

The codebase is well-positioned: `src/core/` has zero VS Code imports, and an earlier JSON-RPC bridge already implemented the full business logic surface (~1000 lines). The plan reuses that handler logic over HTTP instead of rewriting it.

---

## Phase 1: Daemon Foundation — COMPLETE

> Implemented in `feat-v2` branch. Commit `661e014`.
> 30 files changed (14 new source + 11 new test + 4 modified + 1 task doc).
> 1131 tests passing. Zero new dependencies.

### 1.1 Extract shared handler layer — DONE

Extracted all 27 handler methods from the earlier JSON-RPC bridge into a platform-agnostic service.

**Created**:
- `src/core/interfaces/IHandlerContext.ts` — `ISimpleConfigStore`, `INotificationEmitter`, `IFileWatchManager`, `IHandlerContext`
- `src/core/services/SessionHandlerService.ts` — 27 async handler methods grouped into 7 categories (sessions, git, config, workflow, agents, terminals, file watching). Includes `JsonRpcHandlerError`, validation helpers, `VALID_CONFIG_KEYS`.
- Updated `src/core/interfaces/index.ts` with re-exports

**Modified**:
- Legacy JSON-RPC handler adapter — reduced from ~1000 to ~120 lines. Thin adapter that builds `IHandlerContext` from bridge globals and delegates via method dispatch table.

**Security hardening applied during review**:
- Removed non-null assertion on `codeAgent` — now throws descriptive error
- Delegated to canonical `validateSessionName` + added path separator rejection
- Fixed array mutation in `handleSessionPin` (clone before write)
- Extracted `assertPathWithinWorkspace()` to deduplicate path containment checks
- Added relative path traversal check in `handleWorkflowValidate`
- Renamed `HandlerContext` → `IHandlerContext` per project naming convention

### 1.2 Daemon infrastructure — DONE

Created `src/daemon/` with 7 modules:

| File | Purpose |
|------|---------|
| `config.ts` | `DaemonConfigStore` implementing `ISimpleConfigStore`. JSON-backed at `.lanes/daemon-config.json` |
| `auth.ts` | Token auth: 32-byte hex generation, file I/O with `mode: 0o600`, SHA-256 constant-time comparison via `timingSafeEqual` |
| `lifecycle.ts` | `startDaemon()` (with duplicate-start guard), `stopDaemon()` (cleans PID/port/token files), `isDaemonRunning()` (cleans stale PID files), `getDaemonPort()`, `getDaemonPid()` |
| `notifications.ts` | `DaemonNotificationEmitter` implementing `INotificationEmitter` via SSE. Manages client set, auto-removes on close |
| `fileWatcher.ts` | `DaemonFileWatchManager` implementing `IFileWatchManager`. Uses chokidar + picomatch |
| `server.ts` | Daemon entry point. Args: `--workspace`, `--port`. Initializes full stack, writes PID/port/token, graceful shutdown with connection tracking |
| `router.ts` | REST router with 15 endpoints + auth middleware + CORS + 1 MiB body limit |
| `index.ts` | Barrel re-exports |

**Security hardening applied during review**:
- Token file written with `mode: 0o600` (owner-only)
- SHA-256 hashing before `timingSafeEqual` to prevent token length leakage
- Stale PID file cleanup when process is confirmed dead
- Duplicate start guard in `startDaemon()`
- Config init differentiates ENOENT from other errors
- 1 MiB `MAX_BODY_SIZE` on request bodies
- Active SSE connection tracking + `socket.destroy()` on shutdown
- Persistent `server.on('error')` handler to prevent crashes

### 1.3 REST API (Phase 1 endpoints) — DONE

All 15 endpoints implemented with auth middleware (Bearer token, skips health):

```
GET    /api/v1/health
GET    /api/v1/sessions
POST   /api/v1/sessions
DELETE /api/v1/sessions/:name
GET    /api/v1/sessions/:name/status
POST   /api/v1/sessions/:name/open
POST   /api/v1/sessions/:name/clear
POST   /api/v1/sessions/:name/pin
DELETE /api/v1/sessions/:name/pin
GET    /api/v1/events                    (SSE stream)
GET    /api/v1/agents
GET    /api/v1/agents/:name
GET    /api/v1/config
GET    /api/v1/config/:key
PUT    /api/v1/config/:key
```

Error mapping: `JsonRpcHandlerError -32602` → 400, `-32601` → 404, generic → 500. CORS headers with OPTIONS preflight. URL-encoded session names supported.

### 1.4 Build system & CLI integration — DONE

**Created**:
- `scripts/bundle-daemon.mjs` — esbuild bundle (entry: `src/daemon/server.ts`, output: `out/daemon.js`, shebang, CJS, node18)
- `src/cli/commands/daemon.ts` — `lanes daemon start [--port]`, `stop`, `status`, `logs`

**Modified**:
- `package.json` — `bundle:daemon` script, updated `compile`, `lanes-daemon` bin entry
- `src/cli/cli.ts` — registered daemon subcommand

**Fixes applied during review**:
- Server path resolution: `path.resolve(__dirname, 'daemon.js')` (both bundles in `out/`)
- Port validation: range check 0–65535 with user-friendly error

### Phase 1 known follow-ups

Minor items deferred from code review (not blocking):
- `daemon start` uses fixed 500ms wait — polling loop would be more robust for slow machines
- `POST /sessions` returns 200 instead of 201 (REST convention)
- `lanes daemon logs` is a placeholder — consider redirecting daemon stderr to `.lanes/daemon.log`
- `daemon stop` doesn't verify the process actually terminated before printing success
- Legacy bridge classes lack explicit `implements` clauses for core interfaces

---

## Phase 2: Extended API Surface — COMPLETE

> Implemented in `feat-v2-phase-2` branch. Commit `9503d58` (+ merge `7fdd4ed`).
> 8 files changed (1 new test file + 7 modified). 1209 tests passing.

### 2.1 Insights handler — DONE

Added `handleSessionInsights` to `SessionHandlerService`:

- Validates session name, resolves worktree path, calls `generateInsights()` + optionally `analyzeInsights()`
- `serializeInsights()` private helper converts all Map fields to plain objects for JSON serialization
- ENOENT handling returns `{ insights: null, analysis: null }` for sessions without conversation data
- Normalized `analysis` to `null` (not `undefined`) when `includeAnalysis=false` for JSON API consistency

### 2.2 13 new REST endpoints — DONE

All 13 endpoints wired up with query string parsing support:

```
GET    /api/v1/git/branches              ?includeRemote
POST   /api/v1/git/repair
GET    /api/v1/sessions/:name/diff       ?includeUncommitted
GET    /api/v1/sessions/:name/diff/files ?includeUncommitted
GET    /api/v1/sessions/:name/worktree
GET    /api/v1/sessions/:name/workflow
GET    /api/v1/sessions/:name/insights   ?includeAnalysis (default: true)
GET    /api/v1/workflows                 ?includeBuiltin ?includeCustom
POST   /api/v1/workflows/validate
POST   /api/v1/workflows
POST   /api/v1/terminals
POST   /api/v1/terminals/:name/send
GET    /api/v1/terminals                 ?sessionName
```

**Helpers added**: `parseQueryString()` and `parseBooleanParam()` in router.

**Security fixes applied during review**:
- Terminal send: URL param takes precedence over body (`{ ...body, terminalName: match.params.name }`)
- Workflows list & diff endpoints: omit boolean params when absent from query string, preserving handler `?? true` defaults

### 2.3 Built-in file watching — DONE

Added `setupAutoWatching(workspaceRoot, worktreesFolder)` to `DaemonFileWatchManager`:

- Watches `.lanes/current-sessions/**/*` for session/status file changes across all agent types
- Watches `<worktreesFolder>/**/workflow-state.json` for workflow state changes
- Called from `server.ts` after initialization with configurable worktrees folder via `getWorktreesFolder()`
- `fileWatchManager.dispose()` in shutdown handler closes all watchers

### 2.4 Test coverage — DONE

- 9 tests for `handleSessionInsights` (happy path, validation, ENOENT, serialization)
- 24 tests for all 13 new router endpoints (params, auth, query strings)
- 5 tests for `setupAutoWatching` (paths, watch IDs, custom worktrees folder)

---

## Phase 3: Multi-Project Discovery — COMPLETE

> Implemented in `feat-phase-3` branch.
> 7 files changed (2 new source + 1 new test + 4 modified). 1239 tests passing.

### 3.1 Daemon registry module — DONE

Created `src/daemon/registry.ts` — global registry at `~/.lanes/daemons.json`:

| Function | Purpose |
|----------|---------|
| `getRegistryPath()` | Returns `~/.lanes/daemons.json` via `os.homedir()` |
| `registerDaemon(entry)` | Upserts entry by `workspaceRoot`, creates `~/.lanes/` if needed |
| `deregisterDaemon(workspaceRoot)` | Removes entry, skips write if not found |
| `listRegisteredDaemons()` | Returns all entries (no liveness check) |
| `cleanStaleEntries()` | Removes entries with dead PIDs via `process.kill(pid, 0)` |

- `DaemonRegistryEntry` type: `{ workspaceRoot, port, pid, token, startedAt, projectName }`
- Atomic writes via temp file + `fs.rename` to prevent corruption
- Registry file written with `mode: 0o600` (owner-only) to protect tokens
- Malformed JSON and missing files handled gracefully (return empty array)
- Non-ENOENT/non-SyntaxError errors propagated

### 3.2 Server lifecycle integration — DONE

Modified `src/daemon/server.ts`:
- Calls `registerDaemon()` after writing PID/port files with full entry data
- Calls `deregisterDaemon()` in `shutdown()` before local file cleanup (best-effort, wrapped in try/catch)
- Passes mutable `routerContext` to `createRouter` with `workspaceRoot`, `startedAt`, `port` (back-filled after `server.listen()`)

### 3.3 Discovery endpoint — DONE

Added `GET /api/v1/discovery` to `src/daemon/router.ts` (auth-protected):

```
GET /api/v1/discovery → { projectName, gitRemote, sessionCount, uptime, workspaceRoot, port }
```

- `projectName`: `path.basename(workspaceRoot)`
- `gitRemote`: `git remote get-url origin` (returns `null` on failure)
- `sessionCount`: from `handleSessionList()` result
- `uptime`: seconds since `startedAt`

Updated `createRouter` signature with 4th `context` parameter.

### 3.4 Test coverage — DONE

- 21 tests for registry CRUD (register, deregister, list, upsert, stale cleanup, malformed JSON, atomic writes, error propagation)
- 4 tests for discovery endpoint (happy path, auth missing, auth invalid, missing git remote)
- 5 tests for barrel export verification

### Phase 3 known follow-ups

- Git remote URLs could contain embedded credentials — consider a `sanitizeGitUrl()` utility
- Registry `readRegistry()` does not validate entry shapes (trusts its own writes)
- Discovery endpoint could include `apiVersion` field for client compatibility checks

---

## Phase 4: VS Code as Daemon Client — COMPLETE

> Implemented in `feat0v2-phase-4` branch. Commit `e91198d`.
> 11 files changed (4 new source + 2 new test + 5 modified). 1307 tests passing.

### 4.1 DaemonClient — DONE

Created `src/daemon/client.ts` — typed HTTP client using Node.js built-in `http` module:

| Feature | Details |
|---------|---------|
| REST methods | All 28+ endpoints: health, discovery, sessions (list/create/delete/status/open/clear/pin/unpin), insights, git (branches/repair/diff/diffFiles/worktreeInfo), workflows (list/validate/create/state), agents (list/config), config (get/set/getAll), terminals (list/create/send) |
| Error mapping | HTTP 400 → `ValidationError`, 401 → `DaemonHttpError`, 404 → `DaemonHttpError`, 5xx → `DaemonHttpError` |
| SSE subscription | `subscribeEvents(callbacks)` with exponential backoff reconnection (1s→30s max), HTTP status validation before treating as connected, auto-cleanup on `close()` |
| Static factory | `DaemonClient.fromWorkspace(workspaceRoot)` reads port/token from `.lanes/` files |
| Options | Constructor accepts `{ port, token }` or `{ baseUrl, token }` |

- `DaemonHttpError` extends `LanesError` for consistent error handling
- SSE events: `sessionStatusChanged`, `fileChanged`, `sessionCreated`, `sessionDeleted`
- 30s request timeout, proper `Content-Length` headers

### 4.2 DaemonService — DONE

Created `src/vscode/services/DaemonService.ts` — manages daemon lifecycle for VS Code:

- Checks if daemon is running via `isDaemonRunning()`, auto-starts via `startDaemon()` if needed
- Polls for port file up to 10 times (300ms intervals) after starting
- Creates `DaemonClient` via `DaemonClient.fromWorkspace()`
- SSE subscription triggers `onRefresh()` callback on session events
- Implements `vscode.Disposable` — closes SSE on deactivation, leaves daemon running for other windows
- Exposes `getClient()` and `isEnabled()` methods
- All errors handled gracefully — failures logged but don't crash extension

### 4.3 VS Code integration — DONE

**Modified `package.json`**:
- Added `lanes.useDaemon` boolean config (default: `false`) under "Lanes: Advanced"

**Modified `src/types/serviceContainer.d.ts`**:
- Added optional `daemonClient?: DaemonClient` to `ServiceContainer` interface

**Modified `src/vscode/extension.ts`**:
- DaemonService initialization with `Promise.race` 5s timeout (non-blocking activation)
- Wires daemon client into service container and session provider via `setDaemonClient()`
- Config change listener prompts window reload when `lanes.useDaemon` toggles

**Modified `src/vscode/commands/sessionCommands.ts`**:
- `if (daemonClient) { ... } else { ... }` routing pattern for:
  - `lanes.createSession` → `daemonClient.createSession()`
  - `lanes.deleteSession` → `daemonClient.deleteSession()` (local terminal/settings cleanup always runs)
  - `lanes.showGitChanges` → `daemonClient.getSessionDiff()`
  - `lanes.generateInsights` → `daemonClient.getSessionInsights()`
  - `lanes.pinSession` / `lanes.unpinSession` → `daemonClient.pinSession()` / `daemonClient.unpinSession()`

**Modified `src/vscode/providers/AgentSessionProvider.ts`**:
- `setDaemonClient(client)` method to inject daemon client
- `getSessionsFromDaemon()` fetches sessions via daemon API
- Uses daemon-provided `isPinned` field as source of truth for pin state

### 4.4 Test coverage — DONE

- `src/test/daemon/client.test.ts` — DaemonClient tests with real HTTP servers: request methods, error mapping, SSE events, auth headers, connection handling
- `src/test/vscode/services/DaemonService.test.ts` — 10 tests: auto-start logic, SSE event handling, dispose cleanup, error handling, `isEnabled()` state, ServiceContainer interface

### Security & review fixes applied

- **Race condition fixed**: `initialize()` awaited with 5s timeout instead of fire-and-forget, ensuring `getClient()` returns valid client in ServiceContainer
- **SSE status code validation**: Non-200 responses consume body and schedule reconnect without resetting backoff (prevents tight reconnect loops on 401)
- **Pin state consistency**: Tree view uses daemon-provided `isPinned` instead of stale local workspace state
- **Settings cleanup**: Runs in both daemon and direct delete paths (daemon endpoint doesn't handle local settings files)

### Phase 4 known follow-ups

- `DaemonClient` methods (except `health`/`discovery`) return `Promise<unknown>` — typed response interfaces would improve consumer type safety
- Status/workflow/chime still read from filesystem in daemon mode — works locally but blocks remote UI scenario
- `DaemonHttpError.kind` hardcoded to `'config'` — `LanesError` kind union should add `'http'` or `'network'` variant
- No SSE reconnection test coverage (exponential backoff behavior)
- Daemon restart on different port not handled (client keeps old port until window reload)

---

## Phase 5: Remote Web UI — COMPLETE

> Implemented in `feat-v2-phase-5` branch. Commit `5dde411`.
> 86 files changed (84 new + 2 modified). 1316 main tests + 177 web-ui tests passing.
> New dependency: `web-ui/` sub-package (React 19, React Router 7, Vite 6, Vitest).

### 5.1 Project scaffold & gateway — DONE

Created `web-ui/` as a separate Vite + React 19 + TypeScript package:

| File | Purpose |
|------|---------|
| `web-ui/package.json` | React 19, React Router 7, Vite 6, TypeScript, Vitest + Testing Library |
| `web-ui/vite.config.ts` | Dev proxy `/api/gateway/*` → localhost:3847, build output to `../out/web-ui` |
| `web-ui/tsconfig.json` | Strict mode, ESNext target |
| `web-ui/index.html` | SPA entry point |
| `scripts/bundle-web.mjs` | esbuild-free (Vite handles bundling) |

Created `src/daemon/gateway.ts` — lightweight HTTP gateway server:

- Reads `~/.lanes/daemons.json` via existing registry functions
- Serves `GET /api/gateway/daemons` (public, no auth) returning live daemon entries
- Serves static files from web-ui build output with SPA fallback
- Dynamic CORS allowlist based on actual gateway port (supports custom `--port`)
- Path traversal protection via `path.resolve()` + `startsWith()` containment

Created `src/cli/commands/web.ts` — `lanes web [--port] [--no-ui]` CLI command.

### 5.2 Typed API client & SSE — DONE

Created browser-side clients in `web-ui/src/api/`:

| File | Purpose |
|------|---------|
| `client.ts` | `DaemonApiClient` — typed fetch wrappers for all 30+ daemon REST endpoints with Bearer token auth |
| `sse.ts` | `DaemonSseClient` — fetch + ReadableStream (supports Authorization header unlike EventSource), auto-reconnection with exponential backoff |
| `types.ts` | All API types: `SessionInfo`, `DaemonInfo`, `WorkflowInfo`, `WorkflowState`, `AgentSessionStatus`, etc. |
| `gateway.ts` | `fetchDaemons()` calling `GET /api/gateway/daemons` |

### 5.3 App shell & routing — DONE

Created `web-ui/src/App.tsx` with React Router:

```
/                              → Dashboard (multi-project overview)
/project/:port                 → ProjectDetail (sessions for one project)
/project/:port/session/:name   → SessionDetail (single session view)
/project/:port/workflows       → WorkflowBrowser (workflow templates)
```

Layout component with header navigation and sidebar.

### 5.4 Multi-project discovery dashboard — DONE

| File | Purpose |
|------|---------|
| `hooks/useDaemons.ts` | Fetches daemon list, enriches with discovery info + health, polls health every 30s, auto-refreshes list every 60s |
| `components/ProjectCard.tsx` | Card showing project name, git remote, session count, uptime, color-coded health indicator (green/yellow/red) |
| `pages/Dashboard.tsx` | Responsive auto-fill grid of ProjectCards with loading, error, and empty states |
| `utils/formatUptime.ts` | Human-readable duration formatting with NaN/negative guards |

### 5.5 Session management with real-time updates — DONE

| File | Purpose |
|------|---------|
| `hooks/useDaemonConnection.ts` | Resolves token from gateway, constructs `DaemonApiClient` + `DaemonSseClient` per port |
| `hooks/useSessions.ts` | Session list state with initial fetch + SSE real-time updates (`session_status_changed`, `session_created`, `session_deleted`) |
| `components/StatusBadge.tsx` | Colored pill with pulsing dot for each `AgentStatusState` |
| `components/ConfirmDialog.tsx` | Accessible modal with Escape/overlay dismiss, auto-focuses Cancel button |
| `components/CreateSessionDialog.tsx` | Form fetching agents, workflows, branches from daemon API; validates session name |
| `components/SessionCard.tsx` | Session row with status badge, branch, agent, workflow step, pin toggle, delete button |
| `pages/ProjectDetail.tsx` | Full session list (pinned first), real-time SSE updates, create/delete with confirmation, pin/unpin with optimistic UI |

### 5.6 Diff viewer and insights — DONE

| File | Purpose |
|------|---------|
| `hooks/useDiff.ts` | Fetches diff files list + unified diff text with `includeUncommitted` flag |
| `hooks/useInsights.ts` | Fetches insights + optional analysis with depth control |
| `components/DiffViewer.tsx` | Parses unified diff, renders line-by-line table with green/red backgrounds, line number gutter, hunk headers |
| `components/FileList.tsx` | Changed files list with basename/dirname split, path-based scroll-to-diff anchors |
| `components/InsightsPanel.tsx` | Insights text, analysis, generate/refresh buttons, loading/error states |
| `pages/SessionDetail.tsx` | Tabbed interface (Changes / Insights) with uncommitted toggle, three-card grid (Status, Worktree, Workflow) |

### 5.7 Workflow visualization — DONE

| File | Purpose |
|------|---------|
| `hooks/useWorkflow.ts` | Fetches detailed `WorkflowState` for a session |
| `hooks/useWorkflows.ts` | Fetches available workflow templates list with builtin/custom filters |
| `components/StepProgressTracker.tsx` | Vertical pipeline: completed (green checkmark), current (blue pulsing), pending (grey outlined) steps. Loop/ralph type badges with iteration counters |
| `components/WorkflowTaskList.tsx` | Task list with per-task status indicators (pending, in_progress, done, failed) |
| `components/WorkflowDetail.tsx` | Template detail view: name, description, builtin badge, file path, step definitions with type badges |
| `pages/WorkflowBrowser.tsx` | Workflow list with search input, all/builtin/custom filter toggle, two-column layout with detail panel |

SessionDetail workflow card enhanced with `StepProgressTracker` (using template steps or fallback synthetic list) and `WorkflowTaskList`.

### 5.8 Test coverage — DONE

**Main project (Mocha)**: 1316 passing, 3 pending
- `src/test/daemon/gateway.test.ts` — 6 tests (CORS, static serving, daemon listing, preflight)
- `src/test/cli/commands/web.test.ts` — 3 tests (port flags, validation)

**Web UI (Vitest)**: 177 passing across 23 test files
- 12 component test files (StatusBadge, ConfirmDialog, CreateSessionDialog, SessionCard, ProjectCard, DiffViewer, FileList, InsightsPanel, StepProgressTracker, WorkflowTaskList, WorkflowDetail)
- 7 hook test files (useDaemons, useDaemonConnection, useSessions, useDiff, useInsights, useWorkflow, useWorkflows)
- 4 page test files (Dashboard, ProjectDetail, SessionDetail, WorkflowBrowser)
- 1 utility test file (formatUptime)

### Security hardening applied during review

- **Path traversal**: `path.resolve()` + `startsWith()` containment in gateway static file serving
- **CORS restriction**: Dynamic origin allowlist based on actual gateway port (not hardcoded)
- **Error message leak**: 500 responses return generic "Internal server error", details logged to stderr
- **SSE field validation**: Only accept 'event' and 'data' field names, ignore unknown fields
- **Dialog accessibility**: `useId()` for unique aria-labelledby IDs, Cancel button auto-focused

### Phase 5 known follow-ups

- `/workflows` top-level route shows empty state without a daemon connection — consider removing or making context-aware
- Breadcrumbs show "Port 3942" instead of project name — `useDaemonConnection` could expose daemon info
- `useDaemonConnection` re-fetches gateway daemon list on every mount — could be cached via React context
- SSE `setCallbacks` replaces entire callback object — consider additive subscription model for multiple consumers
- No `prefers-reduced-motion` media queries on pulse animations
- `getTypeBadgeClass` helper duplicated in StepProgressTracker and WorkflowDetail

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Extract from legacy bridge | Existing handlers already implement every needed operation — avoids duplicating ~1000 lines of tested logic |
| One daemon per project | Matches Git repo isolation model. Registry provides aggregation |
| SSE over WebSocket | Status updates are unidirectional. SSE is simpler, auto-reconnects, zero new deps. WebSocket can be added later for terminal I/O |
| Node.js `http` over Express/Fastify | ~20 simple JSON endpoints. Zero new dependencies. Can migrate later if needed |
| Token auth over OAuth/JWT | Single-user dev tool. Random token in `.lanes/daemon.token` is sufficient |
| SHA-256 before timingSafeEqual | Prevents token length leakage via timing side channel |
| 127.0.0.1 binding | Security default for local dev tool |
| React 19 + Vite for web UI | Modern, fast, zero-config. CSS Modules for scoped styling without extra deps |
| Gateway reads registry | Browser cannot read `~/.lanes/daemons.json` directly — gateway bridges the gap |
| Direct browser→daemon requests | After gateway provides tokens, browser talks directly to daemons (CORS enabled) |
| Separate `web-ui/` package | Keeps web dependencies out of the extension bundle. Independent build via Vite |

## Verification

After Phase 1:
1. `npm run compile` builds all 4 bundles (extension, mcp, cli, daemon) without errors
2. `lanes daemon start` starts daemon, writes PID/port/token files
3. `curl -H "Authorization: Bearer $(cat .lanes/daemon.token)" localhost:PORT/api/v1/health` returns 200
4. `curl -H "Authorization: Bearer ..." localhost:PORT/api/v1/sessions` returns session list
5. SSE stream at `/api/v1/events` pushes status changes when sessions update
6. `lanes daemon stop` cleanly shuts down, removes PID/port/token files
7. `npm test` — 1131 tests passing, no regressions

After Phase 2:
1. All 13 new endpoints respond correctly with auth
2. `GET /api/v1/sessions/:name/insights` returns serialized insights with Map→Object conversion
3. Query params (`includeRemote`, `includeUncommitted`, `includeAnalysis`, etc.) work as expected
4. SSE events stream receives automatic file change notifications on session/workflow updates
5. `npm test` — 1209 tests passing, no regressions

After Phase 3:
1. `lanes daemon start` registers in `~/.lanes/daemons.json` with workspaceRoot, port, pid, token, startedAt, projectName
2. `lanes daemon stop` deregisters from global registry before removing local files
3. `GET /api/v1/discovery` returns project metadata (projectName, gitRemote, sessionCount, uptime, workspaceRoot, port)
4. Discovery endpoint returns `gitRemote: null` when no origin remote is configured
5. Registry file has `0o600` permissions (owner-only read/write)
6. `npm test` — 1239 tests passing, no regressions

After Phase 4:
1. Set `lanes.useDaemon: true` in VS Code settings — daemon auto-starts on activation
2. `DaemonClient.fromWorkspace()` reads port/token and connects to running daemon
3. Session create/delete/diff/insights/pin/unpin route through daemon REST API
4. SSE subscription triggers tree view refresh on session events
5. Extension works identically with `lanes.useDaemon: false` (default) — no behavior change
6. Changing `lanes.useDaemon` prompts window reload
7. Daemon failures are graceful — extension falls back to direct mode without crashing
8. `npm test` — 1307 tests passing, no regressions

After Phase 5:
1. `lanes web` starts gateway on port 3847, serves web UI at `http://127.0.0.1:3847`
2. `lanes web --port 4000` starts on custom port with correct CORS
3. Dashboard at `/` lists all running daemons as project cards with health indicators
4. Clicking a project shows session list with real-time SSE status updates
5. Create/delete/pin/unpin sessions from the web UI
6. Session detail shows status, worktree info, workflow progress, diff viewer, and insights
7. Workflow browser lists available templates with step definitions and agent assignments
8. `cd web-ui && npx vitest run` — 177 tests passing
9. `npm test` — 1316 tests passing, no regressions
