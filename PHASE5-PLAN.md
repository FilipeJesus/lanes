# Phase 5: Remote Web UI — Implementation Plan

## Overview

Build a standalone web UI at `web-ui/` that provides a dashboard for managing Lanes sessions across multiple projects via the daemon REST API.

## Architecture Decisions

### Technology Stack
- **React 19** + **TypeScript** + **Vite** — modern, fast, zero-config
- **React Router** — client-side routing between dashboard and project views
- **CSS Modules** — scoped styling, no extra dependencies
- **Vite proxy** — forward `/api/gateway/*` to a local gateway during dev

### Communication Pattern
The daemon binds to `127.0.0.1` and has CORS enabled. However, the browser cannot read `~/.lanes/daemons.json` directly. Solution:

1. **`lanes web` CLI command** — starts Vite dev server + a lightweight gateway API
2. **Gateway endpoint** (`/api/gateway/daemons`) — reads `~/.lanes/daemons.json`, cleans stale entries, returns daemon list with connection details (port + token)
3. **Direct browser→daemon requests** — the web UI uses tokens from the gateway to make authenticated requests directly to each daemon's REST API (CORS allows this)

### Key Constraints
- All 28+ daemon endpoints already exist and are tested (Phases 1-4)
- SSE stream at `/api/v1/events` provides real-time updates
- Tokens are in the registry file (`~/.lanes/daemons.json`) — the gateway passes them to the browser
- Daemons are local-only (`127.0.0.1`) — this is a local dev tool

## Task Breakdown

### Task 1: Project Setup, Gateway & API Client
**Scope**: Foundation that everything else builds on

- Scaffold `web-ui/` with Vite + React + TypeScript
- Create typed API client wrapping all daemon REST endpoints (typed wrappers over fetch)
- SSE client with auto-reconnection (EventSource wrapper)
- Gateway server module (`src/daemon/gateway.ts`) that reads registry and serves daemon list
- `lanes web [--port]` CLI command that starts gateway + serves web UI static files
- App shell: routing setup, layout component, navigation
- Build scripts: `bundle:web` in root package.json

### Task 2: Multi-Project Discovery Dashboard
**Scope**: Landing page — the first thing users see

- Dashboard page listing all discovered daemons as project cards
- Each card shows: project name, git remote, session count, uptime, health status
- Health polling: periodic health checks with visual indicators (green/yellow/red)
- Click card → navigate to project detail view
- Empty state when no daemons are running
- Auto-refresh daemon list on interval

### Task 3: Session Management with Real-Time Updates
**Scope**: Core session CRUD + live status

- Session list view for a selected project (table/cards)
- Session status badges (working, waiting_for_user, active, idle, error)
- Create session dialog (name, agent selection, workflow selection)
- Delete session with confirmation
- Pin/unpin sessions
- SSE integration: subscribe to daemon events, auto-update session list and status in real-time
- Session detail panel: status, worktree info, workflow state summary

### Task 4: Diff Viewer and Insights
**Scope**: Code review and analysis features

- File change list per session (from `/sessions/:name/diff/files`)
- Diff viewer with unified diff display and syntax highlighting
- Toggle: include uncommitted changes
- Insights panel: display generated insights with analysis
- Trigger insight generation from UI

### Task 5: Workflow Visualization
**Scope**: Workflow progress tracking

- Workflow state display for active sessions
- Step progress tracker: visual pipeline showing completed/current/pending steps
- Task list with status indicators (pending, in_progress, done, failed)
- Loop/ralph step visualization with iteration counters
- Workflow template browser: list available workflows with descriptions
- Workflow detail view: show step definitions and agent assignments

## Dependencies

```
Task 1 (foundation) → Task 2 (dashboard) → Task 3 (sessions + SSE) → Task 4 (diff/insights)
                                                                    → Task 5 (workflows)
```

Tasks 4 and 5 are independent of each other but both depend on Task 3 (session context).

## File Structure Plan

```
web-ui/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
└── src/
    ├── main.tsx                    # App entry point
    ├── App.tsx                     # Router + layout
    ├── api/
    │   ├── client.ts              # Typed daemon API client
    │   ├── gateway.ts             # Gateway API calls
    │   ├── sse.ts                 # SSE subscription manager
    │   └── types.ts               # API response types
    ├── components/
    │   ├── Layout.tsx             # App shell with nav
    │   ├── StatusBadge.tsx        # Session status indicator
    │   ├── DiffViewer.tsx         # Unified diff display
    │   └── ...
    ├── pages/
    │   ├── Dashboard.tsx          # Multi-project overview
    │   ├── ProjectDetail.tsx      # Sessions for one project
    │   ├── SessionDetail.tsx      # Single session view
    │   └── WorkflowBrowser.tsx    # Workflow templates
    ├── hooks/
    │   ├── useDaemons.ts          # Daemon discovery hook
    │   ├── useSessions.ts         # Session list + SSE hook
    │   └── ...
    └── styles/
        ├── global.css             # Reset + variables
        └── *.module.css           # Component styles

src/daemon/gateway.ts              # Gateway server (in main package)
src/cli/commands/web.ts            # `lanes web` CLI command
```
