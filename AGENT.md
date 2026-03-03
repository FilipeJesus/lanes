# Lanes - Development Guidelines

## Project Overview

Lanes is a cross-IDE tool for managing isolated AI coding sessions using Git worktrees. It ships as a VS Code extension, a JetBrains IDE plugin, and a standalone CLI. Each session gets its own worktree, terminal, and code agent process, enabling parallel AI-assisted development.

Supported code agents: Claude Code, Codex (OpenAI), Cortex (Snowflake), Gemini (Google), OpenCode.

## Directory Structure

```
src/
├── core/                     # Platform-agnostic core library
│   ├── codeAgents/           # Agent implementations (Claude, Codex, Cortex, Gemini, OpenCode) + factory
│   ├── errors/               # Typed errors (LanesError, GitError, ValidationError)
│   ├── interfaces/           # Platform abstractions (IConfigProvider, IStorageProvider, etc.)
│   ├── services/             # Business logic (session creation, agent launch, diff, insights, etc.)
│   ├── session/              # Session types + SessionDataService
│   ├── validation/           # Input validation & path sanitization
│   └── workflow/             # Workflow state machine & YAML template loading
├── vscode/                   # VS Code extension
│   ├── adapters/             # Platform adapter implementations
│   ├── commands/             # Command handlers (session, workflow, repair)
│   ├── providers/            # Tree views + webviews (sessions, forms, diffs, workflows)
│   └── services/             # VS Code-specific services (terminal, polling, etc.)
├── cli/                      # Standalone CLI (`lanes` command, Commander.js)
│   ├── adapters/             # CLI platform adapters
│   └── commands/             # list, create, delete, open, diff, insights, etc.
├── mcp/                      # MCP server (workflow tools, stdio transport)
├── jetbrains-ide-bridge/     # JetBrains IDE HTTP bridge server
├── test/                     # Test suite (mirrors source structure)
└── types/                    # Global TypeScript type definitions

jetbrains-ide-plugin/         # Kotlin JetBrains plugin (separate Gradle build)
scripts/                      # Build, bundle & install scripts
docs/                         # Documentation site
```

## Architecture

### Platform Abstraction

Core business logic lives in `src/core/` and is platform-agnostic. Platform-specific code (VS Code, CLI, JetBrains) implements the interfaces in `src/core/interfaces/`:

| Interface | VS Code Adapter | CLI Adapter |
|-----------|----------------|-------------|
| `IConfigProvider` | `VscodeConfigProvider` | `CliConfigProvider` |
| `IStorageProvider` | `VscodeStorageProvider` | `CliStorageProvider` |
| `IGitPathResolver` | `VscodeGitPathResolver` | `CliGitPathResolver` |
| `IFileWatcher` | `VscodeFileWatcher` | — |
| `ITerminalBackend` | `VscodeTerminalBackend` | — |
| `IUIProvider` | `VscodeUIProvider` | — |

### Storage

Session state is stored locally in the repository at `.lanes/current-sessions/<sessionName>/`. Each session has:
- `.claude-session` (or agent-specific file) — session data
- `.claude-status` (or agent-specific file) — session status
- `workflow-state.json` — workflow state (in the worktree)

### Code Agent System

The `CodeAgent` abstract base class (`src/core/codeAgents/CodeAgent.ts`) defines the contract. Each agent provides its CLI command, session/status file names, settings file locations, and permission modes. Use `factory.ts` to instantiate agents.

### Bundling

Three separate esbuild bundles are produced:

| Bundle | Entry | Output | Purpose |
|--------|-------|--------|---------|
| Extension | `src/extension.ts` | `out/extension.bundle.js` | VS Code extension |
| MCP Server | `src/mcp/server.ts` | `out/mcp/server.js` | Workflow MCP server |
| CLI | `src/cli/cli.ts` | `out/cli.js` | `lanes` CLI tool |

## Conventions

### Code Style

- **Async I/O only** — Synchronous `fs` methods (`readFileSync`, `existsSync`, etc.) are banned via ESLint and will error. Use `fs/promises` and `async/await`. See `FileService.ts` for helpers.
- **Test files** are exempt from the sync fs ban.
- **Naming** — `camelCase` for variables/functions, `PascalCase` for classes/interfaces/types. Interfaces are prefixed with `I` (e.g., `IConfigProvider`).
- **Imports** — `camelCase` or `PascalCase` only (enforced by ESLint).
- **Strict TypeScript** — `strict: true` in tsconfig, target ES2022.

### Commit Messages

Enforced via commitlint + husky `commit-msg` hook. Uses [Conventional Commits](https://www.conventionalcommits.org/).

Format: `type(scope): description`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat: add tmux terminal backend`
- `fix(sessions): prevent duplicate worktree creation`
- `chore: release v1.4.0`

### Pre-commit Hooks

The husky `pre-commit` hook runs compile, lint, and test. All must pass before a commit is accepted.

## Commands

```bash
# Build
npm run compile              # TypeScript compile + bundle all three targets
npm run bundle:extension     # Bundle VS Code extension only
npm run bundle:mcp           # Bundle MCP server only
npm run bundle:cli           # Bundle CLI only
npm run watch                # TypeScript watch mode (no bundling)

# Quality
npm run lint                 # ESLint
npm test                     # Full test suite (compile + lint + vscode-test)

# Release
npm run changelog            # Generate CHANGELOG from commits
npm run release              # Interactive release
npm run release:patch        # Patch release
npm run release:minor        # Minor release

# Local install
./scripts/install-local-vscode.sh  # Install extension locally
./scripts/install-local-cli.sh     # Install CLI locally
./scripts/install-local-idea.sh    # Install JetBrains plugin locally

# Debug
# Press F5 in VS Code to launch Extension Development Host
```

### Testing

- **Framework**: Mocha via `@vscode/test-cli` + `@vscode/test-electron`
- **Mocking**: Sinon for stubs/spies, memfs for virtual file systems
- **Config**: `.vscode-test.mjs` — runs all `out/test/**/*.test.js` files
- **Run**: `npm test` (compiles, lints, then runs tests)
- Test files live in `src/test/` mirroring the source structure

## Workflow System

Lanes uses a structured workflow system managed via MCP tools. Workflow templates are YAML files loaded from `.lanes/workflows/` or a custom folder.

### MCP Tools

| Tool | Purpose |
|------|---------|
| `workflow_start` / `workflow_start_from_path` | Initialize a workflow |
| `workflow_status` | Get current position and instructions |
| `workflow_set_tasks` | Define tasks for loop steps |
| `workflow_advance` | Complete current step, move to next |
| `workflow_context` | Retrieve outputs from previous steps |
| `workflow_track_artefacts` | Track file paths produced by steps |

Workflow state persists to `workflow-state.json` in the worktree and auto-resumes on MCP server restart.

## Local Settings Propagation

When creating a session, Lanes can propagate `.claude/settings.local.json` from the base repo to each worktree:

```json
{ "lanes.localSettingsPropagation": "copy" }  // "copy" | "symlink" | "disabled"
```

## Agent Summary

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `coder` | Plan tests + implement features | Each coding task |
| `vscode-expert` | VS Code API verification | Called by coder |
| `shell-ops` | Git/shell safety checks | Called by coder |
| `test-engineer` | Implement planned tests | After each feature |
| `code-reviewer` | Code quality review | After tests pass |

## Constraints

- Always run tests before committing: `npm test`
- Pre-commit hook enforces: compile, lint, and test
- Commit-msg hook enforces: conventional commit format
- Never commit code that breaks existing tests
- Keep changes focused and minimal
- No synchronous fs methods in production code
