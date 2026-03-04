# V2 Phase 1 — Task Breakdown

## Analysis

The PLAN.md defines Phase 1 (Daemon Foundation) with 4 sub-sections. After analyzing the codebase:

- `src/jetbrains-ide-bridge/handlers.ts` (~1000 lines) contains 27 handler methods across 7 categories (session, git, config, workflow, agent, terminal, fileWatcher)
- All handlers depend on `ConfigStore`, `NotificationEmitter`, and `FileWatchManager` — these need protocol-agnostic interfaces
- `src/core/services/` already has shared business logic; handlers.ts orchestrates these services
- CLI uses Commander.js with per-command registration pattern
- Bundling uses esbuild with per-target scripts

## Tasks

### Task 1: Extract Shared Handler Layer
**Plan section**: 1.1
**Dependencies**: None

Create protocol-agnostic handler service from JetBrains bridge:

1. **Create** `src/core/interfaces/IHandlerContext.ts`
   - `ISimpleConfigStore` — `get(key)`, `set(key, value)`, `getAll(prefix?)`
   - `INotificationEmitter` — `sessionStatusChanged()`, `fileChanged()`, `sessionCreated()`, `sessionDeleted()`
   - `IFileWatchManager` — `watch()`, `unwatch()`, `dispose()`
   - `HandlerContext` — combines workspace root + above interfaces

2. **Create** `src/core/services/SessionHandlerService.ts`
   - Extract all 27 handler methods as async methods on a class
   - Constructor takes `HandlerContext`
   - Methods grouped: sessions, git, config, workflow, agents, terminals, fileWatching
   - Keep same validation logic (reuse existing validators)

3. **Modify** `src/jetbrains-ide-bridge/handlers.ts`
   - Delegate to `SessionHandlerService`
   - Preserve backward compatibility (same method names, same error types)

### Task 2: Daemon Infrastructure
**Plan section**: 1.2 (infrastructure files)
**Dependencies**: Task 1

Create `src/daemon/` with supporting modules:

1. **Create** `src/daemon/config.ts` — `DaemonConfigStore` implementing `ISimpleConfigStore`
   - Delegates to `UnifiedSettingsService` (same pattern as JetBrains `ConfigStore`)

2. **Create** `src/daemon/auth.ts`
   - Generate random token → `.lanes/daemon.token`
   - Middleware: validate `Authorization: Bearer <token>` header
   - Return 401 on missing/invalid token

3. **Create** `src/daemon/lifecycle.ts`
   - `startDaemon(options)` — spawn detached process, write `.lanes/daemon.pid` and `.lanes/daemon.port`
   - `stopDaemon(workspaceRoot)` — read PID, send SIGTERM
   - `isDaemonRunning(workspaceRoot)` — check PID file + process alive
   - `getDaemonPort(workspaceRoot)` — read port file

4. **Create** `src/daemon/notifications.ts` — `DaemonNotificationEmitter` implementing `INotificationEmitter`
   - Manage set of SSE client connections
   - Push events as `text/event-stream` data

5. **Create** `src/daemon/fileWatcher.ts`
   - Reuse chokidar pattern from JetBrains `FileWatchManager`
   - Push file change events via `DaemonNotificationEmitter`

### Task 3: HTTP Server & REST API
**Plan section**: 1.2 (server.ts, router.ts) + 1.3 (endpoints)
**Dependencies**: Task 1, Task 2

1. **Create** `src/daemon/router.ts`
   - Map HTTP routes to `SessionHandlerService` methods
   - JSON request parsing, response serialization
   - Error mapping (handler errors → HTTP status codes)
   - Phase 1 endpoints:
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
     GET    /api/v1/events                (SSE)
     GET    /api/v1/agents
     GET    /api/v1/agents/:name
     GET    /api/v1/config
     GET    /api/v1/config/:key
     PUT    /api/v1/config/:key
     ```

2. **Create** `src/daemon/server.ts`
   - Entry point with `--workspace-root` and `--port` args
   - Initialize: git path, config store, SessionDataService, handler service
   - Create HTTP server (Node.js built-in `http` module)
   - Write `.lanes/daemon.pid` and `.lanes/daemon.port`
   - Graceful shutdown on SIGTERM/SIGINT (cleanup PID/port files)
   - Bind to `127.0.0.1`

### Task 4: Build System & CLI Integration
**Plan section**: 1.4
**Dependencies**: Task 3

1. **Create** `scripts/bundle-daemon.mjs`
   - Follow `bundle-cli.mjs` pattern
   - Entry: `src/daemon/server.ts`, output: `out/daemon.js`
   - Shebang banner, CJS format, node18 target

2. **Modify** `package.json`
   - Add `"bundle:daemon": "node scripts/bundle-daemon.mjs"`
   - Add daemon to `compile` script
   - Add `"lanes-daemon": "./out/daemon.js"` to `bin`

3. **Create** `src/cli/commands/daemon.ts`
   - `lanes daemon start [--port <port>]`
   - `lanes daemon stop`
   - `lanes daemon status`
   - `lanes daemon logs`

4. **Modify** `src/cli/cli.ts` — register daemon subcommand

## Execution Order

```
Task 1 (Extract Handler Layer)
    ↓
Task 2 (Daemon Infrastructure)
    ↓
Task 3 (HTTP Server & REST API)
    ↓
Task 4 (Build & CLI)
```

## Key Design Decisions

- **Zero new dependencies**: Use Node.js built-in `http` module, existing chokidar/yaml
- **IHandlerContext interfaces**: Keep minimal — only what handlers actually call
- **SessionHandlerService as class**: Single instance per daemon, holds context
- **DaemonConfigStore delegates to UnifiedSettingsService**: Consistent config across all adapters
- **Token auth**: Random 32-byte hex token, file-based, checked via middleware
- **SSE for events**: Standard `text/event-stream`, auto-reconnect capable
- **Bind 127.0.0.1 only**: Security default for local dev tool
