# Lanes V2 Follow-ups Harness

Tracking source: `PLAN.md` Phase 3/4/5 follow-ups.

## Status Legend
- `pending`: not started
- `in_progress`: currently being implemented
- `done`: implemented and tests passing
- `blocked`: needs clarification or external dependency

## Tasks

| ID | Follow-up | Scope | Tests to add/update | State |
|---|---|---|---|---|
| F1 | Discovery response hardening (`apiVersion`, sanitized git URL) | `src/daemon/router.ts`, daemon discovery tests, web UI/daemon discovery types | `src/test/daemon/router.test.ts` | `done` |
| F2 | `DaemonHttpError.kind` should not be `'config'` | `src/core/errors/LanesError.ts`, `src/daemon/client.ts`, daemon client tests | `src/test/daemon/client.test.ts`, `src/test/errorHandling.test.ts` | `done` |
| F3 | Top-level `/workflows` route context-aware (no noisy connection error without port) | `web-ui/src/hooks/useDaemonConnection.ts`, `web-ui/src/pages/WorkflowBrowser.tsx` | `web-ui/src/test/pages/WorkflowBrowser.test.tsx`, `web-ui/src/test/hooks/useDaemonConnection.test.ts` | `done` |
| F4 | Breadcrumb should show project name (not only port) | `web-ui/src/hooks/useDaemonConnection.ts`, `web-ui/src/pages/SessionDetail.tsx` | `web-ui/src/test/pages/SessionDetail.test.tsx` | `done` |
| F5 | Cache daemon lookup in `useDaemonConnection` | `web-ui/src/hooks/useDaemonConnection.ts` | `web-ui/src/test/hooks/useDaemonConnection.test.ts` | `done` |
| F6 | Additive SSE subscriptions (don’t clobber callbacks) | `web-ui/src/api/sse.ts`, consumers (`useSessions`, `SessionDetail`) | `web-ui/src/test/hooks/useSessions.test.ts`, add `web-ui/src/test/api/sse.test.ts` | `done` |
| F7 | Reduced-motion support for pulse animations | `web-ui/src/styles/StatusBadge.module.css`, `web-ui/src/styles/StepProgressTracker.module.css` | CSS assertion tests not required; validated via snapshot/manual styles check | `done` |
| F8 | Deduplicate `getTypeBadgeClass` helper | `web-ui/src/utils/*`, `StepProgressTracker`, `WorkflowDetail` | add `web-ui/src/test/utils/workflowTypeBadge.test.ts` | `done` |

## Execution Log
- Created harness with selected follow-up batch and test targets.
- Implemented F1-F8.
- Verification run:
  - `npm run compile`
  - `npx mocha "out/test/daemon/router.test.js" "out/test/daemon/client.test.js" "out/test/errorHandling.test.js" --ui tdd --reporter dot` → `121 passing`
  - `cd web-ui && npx vitest run src/test/hooks/useDaemonConnection.test.ts src/test/pages/WorkflowBrowser.test.tsx src/test/pages/SessionDetail.test.tsx src/test/api/sse.test.ts src/test/utils/workflowTypeBadge.test.ts src/test/hooks/useSessions.test.ts` → `42 passing`
