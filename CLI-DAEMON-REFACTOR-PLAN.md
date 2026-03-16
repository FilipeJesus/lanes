# CLI Daemon-First Refactor Plan

## Goal

Refactor the CLI so daemon targeting is resolved once and commands stop branching on `options.host` inline. The intended end state is a daemon-first CLI where local is just the default daemon target, not a separate execution model inside each command.

## Why

The current shape has two architectural problems:

1. `addDaemonHostOption(...)` is a command-registration smell.
   It pushes daemon-targeting concerns into each command instead of making target resolution part of the CLI framework.

2. Repeated `if (options.host)` branches mean commands know too much about transport.
   If the CLI is meant to be a wrapper over the daemon API, command files should not contain separate local-vs-remote execution paths.

## Refactor Plan

### 1. Audit the CLI command surface

Classify commands into:

- daemon-capable and should always go through a daemon-backed path
- truly local-only commands
- interactive commands that need terminal/session launch handling (`create`, `open`, `clear`)

Expected outcome:

- a clear list of which commands should migrate to a daemon-first path
- any exceptions documented explicitly

### 2. Introduce a single daemon target resolver

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

### 3. Replace per-command host option wiring

Remove the `addDaemonHostOption(...)` pattern.

Instead, use a shared command-registration pattern so daemon-backed commands receive daemon targeting consistently, without each command opting in manually.

Possible approaches:

- a command factory for daemon-backed commands
- a shared option-registration wrapper at the CLI composition layer

Constraint:

- command files should not need to know how daemon targeting is attached

### 4. Move command behavior behind daemon-backed handlers

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

### 5. Isolate interactive command behavior

Interactive commands (`create`, `open`, `clear`) still need special treatment because they involve:

- launch metadata
- tmux/vscode terminal modes
- terminal attachment/streaming

That logic should live in one launcher/terminal adapter abstraction, not repeated across command files.

Target shape:

- command resolves daemon target
- command calls a shared session launcher
- launcher handles local/remote terminal attachment differences internally

### 6. Add focused tests around the new architecture

Add or update tests for:

- daemon target resolution
- command registration / option shape
- representative daemon-backed command execution
- interactive launcher behavior
- local default vs remote host parity

Avoid relying only on command-structure tests; cover the shared abstraction directly.

### 7. Update documentation after code stabilizes

Once the CLI shape is settled, update docs to describe:

- local daemon as the default CLI target
- remote daemon as an alternate target
- `--host` as target selection, not a separate command behavior path

## Suggested Implementation Order

1. audit and write down command classification
2. introduce target resolver abstraction
3. introduce shared daemon-backed operation layer
4. migrate non-interactive commands first
5. migrate interactive commands onto a shared launcher
6. remove leftover `if (options.host)` branches
7. remove `addDaemonHostOption(...)`
8. finalize tests and docs

## Success Criteria

- no repeated inline `if (options.host)` branches in daemon-backed command files
- no `addDaemonHostOption(...)` helper remaining
- daemon-backed commands use a shared target-resolution path
- local execution is modeled as the default daemon target
- interactive commands use a single shared launcher/attachment abstraction
