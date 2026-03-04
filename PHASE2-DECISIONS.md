# Phase 2: Extended API Surface — Implementation Decisions

## Overview

Phase 2 adds 13 new REST endpoints to the daemon router, plus built-in file watching for
automatic SSE status/session/workflow change notifications.

## Current State (Phase 1)

The router (`src/daemon/router.ts`) has 15 endpoints covering sessions, agents, config, and SSE.
`SessionHandlerService` has all 27 handler methods already implemented (including git, workflow,
terminal, and file watcher handlers). The router just needs to wire up the remaining handlers.

## New Endpoints to Add

### Git endpoints
| Endpoint | Handler | Notes |
|----------|---------|-------|
| `GET /api/v1/git/branches` | `handleGitListBranches` | Query param: `includeRemote` |
| `POST /api/v1/git/repair` | `handleGitRepairWorktrees` | Body: `{ detectOnly? }` |

### Session sub-resource endpoints
| Endpoint | Handler | Notes |
|----------|---------|-------|
| `GET /api/v1/sessions/:name/diff` | `handleGitGetDiff` | Query params: `includeUncommitted` |
| `GET /api/v1/sessions/:name/diff/files` | `handleGitGetDiffFiles` | Query params: `includeUncommitted` |
| `GET /api/v1/sessions/:name/worktree` | `handleGitGetWorktreeInfo` | |
| `GET /api/v1/sessions/:name/workflow` | `handleWorkflowGetState` | |
| `GET /api/v1/sessions/:name/insights` | New handler needed | Uses InsightsService |

### Workflow endpoints
| Endpoint | Handler | Notes |
|----------|---------|-------|
| `GET /api/v1/workflows` | `handleWorkflowList` | Query params: `includeBuiltin`, `includeCustom` |
| `POST /api/v1/workflows/validate` | `handleWorkflowValidate` | Body: `{ workflowPath }` |
| `POST /api/v1/workflows` | `handleWorkflowCreate` | Body: `{ name, content }` |

### Terminal endpoints
| Endpoint | Handler | Notes |
|----------|---------|-------|
| `POST /api/v1/terminals` | `handleTerminalCreate` | Body: `{ sessionName, command? }` |
| `POST /api/v1/terminals/:name/send` | `handleTerminalSend` | Body: `{ text }` |
| `GET /api/v1/terminals` | `handleTerminalList` | Query param: `sessionName` |

## New Handler: handleSessionInsights

The `SessionHandlerService` doesn't have an insights handler yet. Need to add one that:
1. Validates session name
2. Resolves worktree path
3. Calls `generateInsights()` from `InsightsService`
4. Optionally calls `analyzeInsights()` from `InsightsAnalyzer`
5. Returns `{ insights, analysis? }`

## Built-in File Watching

The daemon server should automatically set up file watchers on startup to monitor session
status/data changes and push SSE notifications. Watches needed:
- `.lanes/current-sessions/` for session file changes
- Each worktree's agent status file
- Each worktree's `workflow-state.json`

This can be done by the daemon server after initialization, using the `DaemonFileWatchManager`.

## Query String Parsing

GET endpoints with optional params (like `includeRemote`, `includeUncommitted`, etc.) need
query string parsing. The current router strips query strings for routing but doesn't parse them.
Need to add a `parseQueryString()` helper.

## Task Breakdown

1. **Add insights handler to SessionHandlerService** — new `handleSessionInsights` method
2. **Add query string parsing + 13 new routes to router** — extend `createRouter` in router.ts
3. **Add built-in file watching in daemon server** — auto-watch session directories on startup
4. **Add tests for all new endpoints** — extend router.test.ts
