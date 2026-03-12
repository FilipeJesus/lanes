# Setup Findings

## Bugs

- High: VS Code daemon mode likely fails on auto-start. The extension tries to launch `out/daemon/server.js`, but the bundle output is `out/daemon.js`. Because initialization failure falls back quietly, users may enable `lanes.useDaemon` and not realize it is not actually active. See [DaemonService.ts](/home/filipe/Documents/repos/lanes/src/vscode/services/DaemonService.ts#L49), [bundle-daemon.mjs](/home/filipe/Documents/repos/lanes/scripts/bundle-daemon.mjs#L14), [package.json](/home/filipe/Documents/repos/lanes/package.json#L39).

- Medium: the VS Code extension is effectively single-root. Activation uses `workspaceFolders?.[0]`, so multi-root workspaces are not handled explicitly and behavior will bind to the first folder. See [extension.ts](/home/filipe/Documents/repos/lanes/src/vscode/extension.ts#L74).

## Docs Drift

- High: the daemon/web setup model was documented as per-project, but the current code runs a machine-wide daemon with global files in `~/.lanes`. The README and internal comments have now been updated in this pass, but this was the biggest source of setup confusion. See [lifecycle.ts](/home/filipe/Documents/repos/lanes/src/daemon/lifecycle.ts#L1), [auth.ts](/home/filipe/Documents/repos/lanes/src/daemon/auth.ts#L1), [gateway.ts](/home/filipe/Documents/repos/lanes/src/daemon/gateway.ts#L85).

- High: the REST API was documented as unscoped `/api/v1/sessions` and `/api/v1/events`, while the router actually requires `/api/v1/projects/:projectId/...`. The README has now been corrected in this pass. See [router.ts](/home/filipe/Documents/repos/lanes/src/daemon/router.ts#L225), [router.ts](/home/filipe/Documents/repos/lanes/src/daemon/router.ts#L364).

- Medium: setup docs/scripts had drift around script names and ports. The README referenced `./scripts/install-local.sh`, and the web install script pointed users at `http://localhost:3100` even though `lanes web` defaults to `3847`. Those docs and script messages were updated in this pass. See [install-local-vscode.sh](/home/filipe/Documents/repos/lanes/scripts/install-local-vscode.sh#L1), [install-local-web.sh](/home/filipe/Documents/repos/lanes/scripts/install-local-web.sh#L1).

- Low: “remote web UI” is overstated. The daemon and clients are bound to `127.0.0.1`, so it is only directly usable from the same machine unless the user sets up forwarding or proxying. See [server.ts](/home/filipe/Documents/repos/lanes/src/daemon/server.ts#L59), [useDaemons.ts](/home/filipe/Documents/repos/lanes/web-ui/src/hooks/useDaemons.ts#L53).

## Onboarding UX

- Medium: the web UI is still CLI-first and not forgiving for new users. Empty state tells users to run `lanes daemon register .`, offline cards are not actionable, and project views error if the daemon is not running. There is no guided “register/start/fix” flow in the UI. See [Dashboard.tsx](/home/filipe/Documents/repos/lanes/web-ui/src/pages/Dashboard.tsx#L50), [ProjectCard.tsx](/home/filipe/Documents/repos/lanes/web-ui/src/components/ProjectCard.tsx#L57), [useDaemonConnection.ts](/home/filipe/Documents/repos/lanes/web-ui/src/hooks/useDaemonConnection.ts#L113).

- Medium: prerequisite checks are late. `jq`, agent CLIs, and `tmux` are only surfaced when users are already in the flow, not up front, so first-run setup feels trial-and-error. See [README.md](/home/filipe/Documents/repos/lanes/README.md#L88), [factory.ts](/home/filipe/Documents/repos/lanes/src/core/codeAgents/factory.ts#L99).

- Low: failure diagnosis is weak. Daemon startup is detached with `stdio: 'ignore'`, `lanes daemon start` only waits briefly, and `lanes daemon logs` is not a real log command. See [lifecycle.ts](/home/filipe/Documents/repos/lanes/src/daemon/lifecycle.ts#L48), [daemon.ts](/home/filipe/Documents/repos/lanes/src/cli/commands/daemon.ts#L47), [daemon.ts](/home/filipe/Documents/repos/lanes/src/cli/commands/daemon.ts#L177).

## Testing Gaps

- The daemon CLI tests only verify command registration, not actual startup behavior. See [daemonCommand.test.ts](/home/filipe/Documents/repos/lanes/src/test/daemon/daemonCommand.test.ts#L1).

- The web command tests stub the gateway/Vite path, so they do not cover the true first-run flow. See [web.test.ts](/home/filipe/Documents/repos/lanes/src/test/cli/commands/web.test.ts#L1).

- The web e2e tests use mocked APIs, so they do not validate real daemon/web integration. See [dashboard.spec.ts](/home/filipe/Documents/repos/lanes/web-ui/e2e/dashboard.spec.ts#L1).

## Summary

The biggest setup problem is not one bug, it is the mismatch between the product story and the actual daemon model. If setup needs to feel easy, the first priorities should be:

1. Align the daemon mental model across code, docs, and UI.
2. Add a first-run preflight for missing dependencies.
3. Fix the VS Code daemon startup path and the install/docs drift.
