# CLI Daemon-First Refactor Plan

## Goal

Refactor the CLI so daemon targeting is resolved once and commands stop branching on `options.host` inline. The intended end state is a daemon-first CLI where local is just the default daemon target, not a separate execution model inside each command.

## Progress Update

### Completed so far

- audited the CLI command surface and classified daemon-backed vs local-only vs interactive commands
- introduced a shared CLI targeting module in `src/cli/targeting.ts`
- moved daemon host option registration to the CLI composition layer via `applyCliDaemonTargeting(...)`
- removed the old per-command `addDaemonHostOption(...)` helper
- introduced shared target resolution helpers:
  - `createCliDaemonClient(...)`
  - `resolveCliDaemonTarget(...)`
  - `withCliDaemonTarget(...)`
- migrated daemon-capable commands to the shared target flow:
  - `list`
  - `status`
  - `create`
  - `open`
  - `delete`
  - `clear`
  - `diff`
  - `insights`
  - `repair`
  - `config`
  - `workflow list`
- kept local as the default target model while treating remote as an alternate target resolved centrally
- updated CLI tests to validate composition-time host option registration and shared target resolution
- ran compile, lint, and the VS Code test harness; fixed the failing harness tests encountered during this refactor slice

### Not completed yet

- daemon-backed commands still contain their local behavior inline; the shared operation layer described below is not extracted yet
- interactive commands still rely on command-local launcher behavior instead of a single dedicated launcher abstraction
- docs have not been updated yet

## Why

The current shape has two architectural problems:

1. `addDaemonHostOption(...)` is a command-registration smell.
   It pushes daemon-targeting concerns into each command instead of making target resolution part of the CLI framework.

2. Repeated `if (options.host)` branches mean commands know too much about transport.
   If the CLI is meant to be a wrapper over the daemon API, command files should not contain separate local-vs-remote execution paths.

## Refactor Plan

### 1. Audit the CLI command surface

Status: completed

Classify commands into:

- daemon-capable and should always go through a daemon-backed path
- truly local-only commands
- interactive commands that need terminal/session launch handling (`create`, `open`, `clear`)

Expected outcome:

- a clear list of which commands should migrate to a daemon-first path
- any exceptions documented explicitly

Current classification:

- daemon-backed, non-interactive:
  - `list`
  - `status`
  - `delete`
  - `diff`
  - `insights`
  - `repair`
  - `config`
  - `workflow list`
- interactive / terminal-launch:
  - `create`
  - `open`
  - `clear`
- local-only:
  - `hooks`
  - `workflow create`
  - `workflow validate`
  - `uninstall`
- control-plane / exception commands:
  - `daemon *`
  - `web`

### 2. Introduce a single daemon target resolver

Status: mostly completed for CLI target selection

Create one CLI abstraction that resolves:

- local default target
- registered remote host target
- project-scoped `DaemonClient`

This should replace the current mix of:

- `DaemonClient.fromWorkspace(...)`
- ad hoc host lookup
- inline project resolution logic

Likely location:

- `src/cli/` transport or targeting module

Implemented:

- `src/cli/targeting.ts`
- composition-time command targeting via `applyCliDaemonTargeting(...)`
- shared target helpers for local-default vs remote-registered daemon resolution

Remaining gap:

- the target resolver exists, but command behavior is not yet pushed behind a separate shared operation layer

### 3. Replace per-command host option wiring

Status: completed

Remove the `addDaemonHostOption(...)` pattern.

Instead, use a shared command-registration pattern so daemon-backed commands receive daemon targeting consistently, without each command opting in manually.

Possible approaches:

- a command factory for daemon-backed commands
- a shared option-registration wrapper at the CLI composition layer

Constraint:

- command files should not need to know how daemon targeting is attached

Completed implementation:

- `addDaemonHostOption(...)` removed
- daemon-targeted commands receive `--host` from CLI composition in `src/cli/cli.ts`

### 4. Move command behavior behind daemon-backed handlers

Status: partially completed

Each daemon-backed command should call a shared operation layer rather than directly implementing:

- local direct execution
- remote daemon execution

Examples:

- list sessions
- get session status
- delete session
- diff session
- get/set config
- repair worktrees
- list workflows

Target shape:

- command parses args/options
- command resolves target
- command invokes operation handler
- operation handler talks to daemon client

Completed in this slice:

- commands now parse args/options and resolve target through `withCliDaemonTarget(...)`

Still remaining:

- there is not yet a dedicated shared operation layer for the daemon-backed commands
- most commands still keep local and daemon execution logic in the command file, even though target selection is centralized

### 5. Isolate interactive command behavior

Status: partially completed

Interactive commands (`create`, `open`, `clear`) still need special treatment because they involve:

- launch metadata
- tmux/vscode terminal modes
- terminal attachment/streaming

That logic should live in one launcher/terminal adapter abstraction, not repeated across command files.

Target shape:

- command resolves daemon target
- command calls a shared session launcher
- launcher handles local/remote terminal attachment differences internally

Completed in this slice:

- interactive commands now use the shared target resolver
- remote attachment is centralized through `attachCliToRemoteSession(...)`

Still remaining:

- local launch behavior is still split between `create`, `open`, and `clear`
- a single launcher abstraction for both local and remote interactive behavior still needs to be extracted

### 6. Add focused tests around the new architecture

Status: completed for the current slice

Add or update tests for:

- daemon target resolution
- command registration / option shape
- representative daemon-backed command execution
- interactive launcher behavior
- local default vs remote host parity

Avoid relying only on command-structure tests; cover the shared abstraction directly.

Completed:

- updated CLI host option tests to validate composition-time registration
- added shared target-resolution coverage
- ran the full VS Code test harness and fixed failing tests encountered during this slice

### 7. Update documentation after code stabilizes

Status: not started

Once the CLI shape is settled, update docs to describe:

- local daemon as the default CLI target
- remote daemon as an alternate target
- `--host` as target selection, not a separate command behavior path

## Suggested Implementation Order

1. audit and write down command classification
   Status: completed
2. introduce target resolver abstraction
   Status: completed
3. introduce shared daemon-backed operation layer
   Status: not started
4. migrate non-interactive commands first
   Status: completed for target resolution, not completed for shared operation handlers
5. migrate interactive commands onto a shared launcher
   Status: partially completed
6. remove leftover `if (options.host)` branches
   Status: completed for the migrated daemon-backed commands
7. remove `addDaemonHostOption(...)`
   Status: completed
8. finalize tests and docs
   Status: tests completed for this slice; docs not started

## Success Criteria

- no repeated inline `if (options.host)` branches in daemon-backed command files
- no `addDaemonHostOption(...)` helper remaining
- daemon-backed commands use a shared target-resolution path
- local execution is modeled as the default daemon target
- interactive commands use a single shared launcher/attachment abstraction

Current status against success criteria:

- no repeated inline `if (options.host)` branches in the migrated daemon-backed command files: completed
- no `addDaemonHostOption(...)` helper remaining: completed
- daemon-backed commands use a shared target-resolution path: completed
- local execution is modeled as the default daemon target: completed
- interactive commands use a single shared launcher/attachment abstraction: not completed yet
