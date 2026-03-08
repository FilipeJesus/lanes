# Phase 3: Multi-Project Discovery — Implementation Plan

## Goal
Enable a remote UI to discover all running project daemons via:
1. A global registry at `~/.lanes/daemons.json`
2. A `GET /api/v1/discovery` endpoint returning project metadata

## Current State
- All daemon state is repo-scoped (`<workspaceRoot>/.lanes/`)
- No global `~/.lanes/` directory or registry exists
- No `os.homedir()` usage in daemon code
- `server.ts` writes PID/port/token on start, deletes on shutdown
- Router uses custom `matchRoute()` pattern matching — no framework

## Task Breakdown

### Task 1: Create daemon registry module
**Files**: `src/daemon/registry.ts`, `src/daemon/index.ts`, `src/test/daemon/registry.test.ts`

Create `src/daemon/registry.ts`:
- `DaemonRegistryEntry` type: `{ workspaceRoot, port, pid, token, startedAt, projectName }`
- `getRegistryPath()` — returns `~/.lanes/daemons.json` using `os.homedir()`
- `registerDaemon(entry: DaemonRegistryEntry)` — reads registry, upserts by workspaceRoot, writes atomically
- `deregisterDaemon(workspaceRoot: string)` — reads registry, removes entry, writes back
- `listRegisteredDaemons()` — reads registry, returns all entries
- `cleanStaleEntries()` — removes entries whose PID is dead (using `process.kill(pid, 0)`)
- Handle concurrent writes: read-modify-write with temp file + rename for atomicity
- Create `~/.lanes/` directory if it doesn't exist (with `recursive: true`)

Update `src/daemon/index.ts` to export new types and functions.

Write tests in `src/test/daemon/registry.test.ts` covering:
- Register, deregister, list operations
- Stale entry cleanup
- Concurrent daemon handling (upsert by workspaceRoot)
- Missing directory/file creation
- Edge cases (empty registry, non-existent file)

### Task 2: Integrate registry + add discovery endpoint
**Files**: `src/daemon/server.ts`, `src/daemon/router.ts`, `src/test/daemon/router.test.ts`

In `server.ts`:
- After writing PID/port/token, call `registerDaemon()` with entry data
- Get `projectName` from `path.basename(workspaceRoot)`
- Get token from the generated token (already in scope)
- In `shutdown()`, call `deregisterDaemon(workspaceRoot)` before deleting local files

In `router.ts`:
- Add `GET /api/v1/discovery` route (requires auth)
- Returns: `{ projectName, gitRemote, sessionCount, uptime, workspaceRoot, port }`
- `projectName`: from `path.basename(workspaceRoot)` or config
- `gitRemote`: run `git remote get-url origin` (gracefully handle no remote)
- `sessionCount`: call `handlerService.handleSessionList()` and count
- `uptime`: calculate from server start time (store `startedAt` in router context or pass as param)
- `port`: from the server's listening address

Add tests in `src/test/daemon/router.test.ts`:
- Discovery endpoint returns correct shape
- Discovery endpoint requires auth
- Handles missing git remote gracefully

## Dependencies
- Task 2 depends on Task 1 (imports registry types)
- Both tasks should be done in sequence

## Key Decisions
- Registry path: `~/.lanes/daemons.json` (per plan)
- Atomic writes via temp file + `fs.rename` to prevent corruption
- Stale cleanup uses `process.kill(pid, 0)` — same pattern as `isDaemonRunning()`
- Discovery endpoint is per-daemon (returns THIS daemon's info), not an aggregator
- `projectName` defaults to `path.basename(workspaceRoot)` — simple and predictable
- Token is stored in registry entries so the remote UI can authenticate without reading local files
