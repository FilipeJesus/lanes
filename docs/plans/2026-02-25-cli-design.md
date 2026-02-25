# Lanes CLI Design

## Overview

A command-line interface for Lanes that allows users to manage isolated AI coding sessions via Git worktrees from the terminal. Targets both headless/CI environments and terminal-first developers.

Distributed as a separate npm package (`lanes-cli`). Shares the `src/core/` layer with the VS Code extension — no code duplication.

## Command Surface

```
lanes create --name <name> [--branch <source>] [--agent <agent>] [--prompt <text>] [--workflow <name>] [--permission-mode <mode>]
lanes open <session-name>
lanes list
lanes delete <session-name> [--force]
lanes clear <session-name>
lanes status [<session-name>]
lanes diff <session-name> [--base <branch>]
lanes insights <session-name>
lanes hooks <session-name>

lanes workflow list
lanes workflow create [--from <template>] --name <name>
lanes workflow validate <file>

lanes repair
lanes config [--key <key>] [--value <value>]
```

All commands use flags — no interactive prompts. Fully scriptable.

## Architecture

The CLI is a peer consumer of `src/core/`, sitting alongside `src/vscode/`:

```
src/
  core/              # shared (unchanged)
  vscode/            # VS Code extension (unchanged)
  cli/
    adapters/
      CliConfigProvider.ts
      CliStorageProvider.ts
      CliGitPathResolver.ts
      CliTerminalBackend.ts
    commands/
      create.ts
      open.ts
      list.ts
      delete.ts
      clear.ts
      status.ts
      diff.ts
      insights.ts
      hooks.ts
      workflow.ts
      repair.ts
      config.ts
    cli.ts            # entry point, argument parsing
```

### Adapters

| Interface | CLI Implementation |
|---|---|
| `IConfigProvider` | Reads `.lanes/config.json` in repo root. `onDidChange` is a no-op (single-run process). |
| `IStorageProvider` | Uses `.lanes/session_management/` in the repo. No global storage. |
| `IGitPathResolver` | Resolves `git` from `$PATH` via `which`. |
| `ITerminalBackend` | Builds agent command, `exec`s into it (replaces process). Tmux mode available. |
| `IUIProvider` | Not needed — CLI uses flags instead of prompts. |
| `IFileWatcher` | Not needed — CLI is single-shot, no watching. |

## Configuration

Config file: `.lanes/config.json`

```json
{
  "worktreesFolder": ".worktrees",
  "defaultAgent": "claude",
  "baseBranch": "",
  "includeUncommittedChanges": true,
  "localSettingsPropagation": "copy",
  "customWorkflowsFolder": ".lanes/workflows",
  "terminalMode": "vscode",
  "permissionMode": "acceptEdits"
}
```

All keys mirror the VS Code `lanes.*` settings with the same defaults. If the file doesn't exist, defaults apply.

## Shared State

CLI and extension can manage sessions in the same repo. They share:

- Worktrees (same `.worktrees/` folder)
- Session files in worktrees (`.claude-session`, `.claude-status`)
- Workflow templates (`.lanes/workflows/`)
- MCP state (`workflow-state.json` in worktree)

Sessions created by the CLI appear in the VS Code sidebar automatically because the extension reads worktrees from git.

## `lanes create` Behavior

`lanes create` always opens the agent session after creating the worktree:

1. Validate inputs (name, branch, agent)
2. Create worktree via `git worktree add`
3. Propagate local settings if configured
4. Seed session file with agent name and timestamp
5. Set up settings file and hooks
6. Generate MCP config if workflow specified
7. Build agent start command via `CodeAgent.buildStartCommand()`
8. `exec` into the agent process

## `lanes open` Behavior

**Default mode** — exec into agent:

1. Look up session data from worktree
2. Resolve agent from session metadata
3. Build resume or start command
4. Set up settings/hooks/MCP config
5. `exec` — replace lanes process with agent process

**Tmux mode** (`lanes open <name> --tmux`):

1. Same setup steps
2. Create or attach to tmux session via `TmuxService`

No background session management. `lanes status` reads session files from disk.

## Build & Distribution

npm package: `lanes-cli`

Third esbuild bundle target:
```
npm run bundle:cli  ->  out/cli.js
```

Install:
```bash
npm install -g lanes-cli
lanes create --name fix-bug --agent claude
```

Or:
```bash
npx lanes-cli create --name fix-bug
```

Three artifacts from the same repo:
- `out/extension.bundle.js` — VS Code extension
- `out/mcp/server.js` — MCP server
- `out/cli.js` — CLI
