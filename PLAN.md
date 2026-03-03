# Lanes v2.0 — Daemon & REST API

## Context

Lanes currently has three adapter layers (VS Code, CLI, JetBrains) all calling `src/core/` directly. The vision for v2 is a **remote web UI** that can manage sessions across multiple projects via REST. This requires a standalone daemon process — something that can't live inside a VS Code extension.

The codebase is well-positioned: `src/core/` has zero VS Code imports, and the JetBrains bridge (`src/jetbrains-ide-bridge/handlers.ts`) already implements the full business logic surface (~1000 lines) over JSON-RPC. The plan reuses that handler logic over HTTP instead of rewriting it.

## Phase 1: Daemon Foundation

### 1.1 Extract shared handler layer

The JetBrains bridge `handlers.ts` contains all business logic (session CRUD, git ops, workflows, agents, config, terminals, file watching) coupled to its specific `ConfigStore` and `NotificationEmitter`. Extract this into a shared service.

**Create**: `src/core/services/SessionHandlerService.ts`
- Define `HandlerContext` interface: `{ workspaceRoot, configStore: ISimpleConfigStore, notificationEmitter: INotificationEmitter, fileWatchManager: IFileWatchManager }`
- Extract handler functions from `src/jetbrains-ide-bridge/handlers.ts` as protocol-agnostic methods

**Create**: `src/core/interfaces/IHandlerContext.ts`
- `ISimpleConfigStore` — get/set/getAll (JetBrains `ConfigStore` already satisfies this)
- `INotificationEmitter` — sessionStatusChanged, fileChanged, sessionCreated, sessionDeleted

**Modify**: `src/jetbrains-ide-bridge/handlers.ts`
- Delegate to the shared service, preserving backward compatibility

### 1.2 Create daemon server

**Create** `src/daemon/`:

| File | Purpose |
|------|---------|
| `server.ts` | HTTP server entry point. Args: `--workspace-root`, `--port`. Writes `.lanes/daemon.pid` and `.lanes/daemon.port`. Graceful shutdown on SIGTERM/SIGINT |
| `router.ts` | Maps HTTP routes to shared handler functions. JSON request/response |
| `config.ts` | `DaemonConfigStore` — reads/writes `.lanes/daemon-config.json` (same pattern as JetBrains `ConfigStore` at `src/jetbrains-ide-bridge/config.ts`) |
| `notifications.ts` | `DaemonNotificationEmitter` — pushes events to connected SSE clients instead of stdout |
| `auth.ts` | Generate random token to `.lanes/daemon.token` on first start. Middleware checks `Authorization: Bearer <token>` |
| `lifecycle.ts` | `startDaemon()`, `stopDaemon()`, `isDaemonRunning()`, `getDaemonPort()` via PID file |
| `fileWatcher.ts` | Reuse `FileWatchManager` pattern from JetBrains bridge, push changes via SSE |

**HTTP framework**: Node.js built-in `http` module (zero new dependencies). SSE via standard `text/event-stream` responses.

### 1.3 REST API (Phase 1 endpoints)

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

All endpoints require `Authorization: Bearer <token>`. Daemon binds to `127.0.0.1` by default.

### 1.4 Build system & CLI integration

**Create**: `scripts/bundle-daemon.mjs` (follow pattern from `scripts/bundle-cli.mjs`)

**Modify**: `package.json`
- Add `"bundle:daemon"` script
- Add to `compile` script
- Add `"lanes-daemon": "./out/daemon.js"` to `bin`

**Create**: `src/cli/commands/daemon.ts`
```
lanes daemon start [--port <port>]
lanes daemon stop
lanes daemon status
lanes daemon logs
```

**Modify**: `src/cli/cli.ts` — register daemon subcommand

### Phase 1 milestone
`lanes daemon start` → `curl localhost:PORT/api/v1/sessions` returns session list with auth token.

---

## Phase 2: Extended API Surface

Add remaining endpoints to match full JetBrains bridge parity:

```
GET    /api/v1/git/branches
GET    /api/v1/sessions/:name/diff
GET    /api/v1/sessions/:name/diff/files
GET    /api/v1/sessions/:name/worktree
POST   /api/v1/git/repair
GET    /api/v1/workflows
POST   /api/v1/workflows/validate
POST   /api/v1/workflows
GET    /api/v1/sessions/:name/workflow
GET    /api/v1/sessions/:name/insights
POST   /api/v1/terminals
POST   /api/v1/terminals/:name/send
GET    /api/v1/terminals
```

Built-in file watching for status/session/workflow changes pushed via SSE events.

---

## Phase 3: Multi-Project Discovery

**Create**: `src/daemon/registry.ts`
- Registry at `~/.lanes/daemons.json` — each daemon registers on start, deregisters on stop
- Entry: `{ workspaceRoot, port, pid, token, startedAt, projectName }`

**Add endpoint**: `GET /api/v1/discovery` — returns project name, git remote, session count, uptime

This allows a remote UI to discover all running project daemons.

---

## Phase 4: VS Code as Daemon Client

**Create**: `src/daemon/client.ts` — typed HTTP client wrapping all REST endpoints + SSE subscription

**Modify**: `src/vscode/extension.ts`
- Add `lanes.useDaemon` config option (default: `false`)
- When enabled, route operations through `DaemonClient` instead of direct core calls
- Auto-start daemon if not running

---

## Phase 5: Remote Web UI

**Create**: `web-ui/` (separate package)
- Dashboard listing all discovered projects (reads `~/.lanes/daemons.json` or connects to individual daemons)
- Session management, live status via SSE, diff viewer, workflow visualization, insights
- Technology TBD (React + Vite suggested)

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Extract from JetBrains bridge | handlers.ts already implements every needed operation — avoids duplicating ~1000 lines of tested logic |
| One daemon per project | Matches Git repo isolation model. Registry provides aggregation |
| SSE over WebSocket | Status updates are unidirectional. SSE is simpler, auto-reconnects, zero new deps. WebSocket can be added later for terminal I/O |
| Node.js `http` over Express/Fastify | ~20 simple JSON endpoints. Zero new dependencies. Can migrate later if needed |
| Token auth over OAuth/JWT | Single-user dev tool. Random token in `.lanes/daemon.token` is sufficient |

## Verification

After Phase 1:
1. `npm run compile` builds daemon bundle without errors
2. `lanes daemon start` starts daemon, writes PID/port files
3. `curl -H "Authorization: Bearer $(cat .lanes/daemon.token)" localhost:PORT/api/v1/health` returns 200
4. `curl -H "Authorization: Bearer ..." localhost:PORT/api/v1/sessions` returns session list
5. SSE stream at `/api/v1/events` pushes status changes when sessions update
6. `lanes daemon stop` cleanly shuts down
7. Existing tests (`npm test`) still pass — no regressions
