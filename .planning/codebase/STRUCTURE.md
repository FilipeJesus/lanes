# Codebase Structure

**Analysis Date:** 2026-02-09

## Directory Layout

```
project-root/
├── src/                           # TypeScript source code
│   ├── extension.ts              # VS Code extension activation & initialization
│   ├── ClaudeSessionProvider.ts   # Tree view for active sessions
│   ├── SessionFormProvider.ts     # Webview form for creating sessions
│   ├── PreviousSessionProvider.ts # Tree view for previous sessions
│   ├── WorkflowsProvider.ts       # Tree view for workflow templates
│   ├── GitChangesPanel.ts         # Webview panel for git diff display
│   ├── ProjectManagerService.ts   # Tracks projects in vs-code-project-manager
│   ├── gitService.ts              # Git command execution abstraction
│   ├── utils.ts                   # Shared utilities (errors, validation)
│   ├── watchers.ts                # File system and config watchers
│   ├── AsyncQueue.ts              # Task queue for race condition prevention
│   ├── localSettings.ts           # .claude/settings.local.json propagation
│   │
│   ├── services/                  # Business logic layer
│   │   ├── SessionService.ts      # Session creation, worktree management
│   │   ├── TerminalService.ts     # Terminal creation, Claude process spawning
│   │   ├── WorkflowService.ts     # Workflow validation, loading, execution
│   │   ├── SettingsService.ts     # User settings, base repo resolution
│   │   ├── DiffService.ts         # Git diff generation and branch comparison
│   │   ├── FileService.ts         # File I/O abstractions (read/write/exists)
│   │   ├── BrokenWorktreeService.ts # Worktree repair and recovery
│   │   ├── SessionProcessService.ts # Claude CLI process management
│   │   └── McpAdapter.ts          # MCP server subprocess spawning
│   │
│   ├── commands/                  # Command handlers
│   │   ├── index.ts               # Command registration hub
│   │   ├── sessionCommands.ts     # Session creation, deletion, opening
│   │   ├── workflowCommands.ts    # Workflow creation, validation
│   │   └── repairCommands.ts      # Worktree repair commands
│   │
│   ├── mcp/                       # MCP (Model Context Protocol) integration
│   │   ├── server.ts              # MCP server entry point (spawned subprocess)
│   │   ├── tools.ts               # MCP tool implementations
│   │   └── index.ts               # MCP exports
│   │
│   ├── workflow/                  # Workflow execution system
│   │   ├── types.ts               # Type definitions (WorkflowTemplate, WorkflowState)
│   │   ├── state.ts               # WorkflowStateMachine state machine logic
│   │   ├── loader.ts              # YAML workflow template loading
│   │   ├── discovery.ts           # Workflow file discovery
│   │   └── index.ts               # Workflow module exports
│   │
│   ├── validation/                # Input validation
│   │   ├── validators.ts          # Core validators (session names, branches, paths)
│   │   ├── pathSanitizer.ts       # Path security checks
│   │   ├── schemas.ts             # YAML schema validation
│   │   └── index.ts               # Validation exports
│   │
│   ├── errors/                    # Error classes
│   │   ├── LanesError.ts          # Base error with discriminated union pattern
│   │   ├── GitError.ts            # Git operation failures
│   │   ├── ValidationError.ts     # User input validation failures
│   │   └── index.ts               # Error exports
│   │
│   ├── codeAgents/                # Code agent abstraction
│   │   ├── CodeAgent.ts           # Abstract base for agent behavior
│   │   ├── ClaudeCodeAgent.ts     # Claude Code specific implementation
│   │   └── index.ts               # Agent exports
│   │
│   ├── types/                     # TypeScript type definitions
│   │   ├── serviceContainer.d.ts  # Dependency injection container interface
│   │   ├── extension.d.ts         # VS Code extension type augmentations
│   │   ├── git.d.ts               # Git extension API types
│   │   └── mcp.d.ts               # MCP type definitions
│   │
│   └── test/                      # Test suite (organized by category)
│       ├── core/                  # Core functionality tests
│       ├── config/                # Configuration tests
│       ├── integration/           # Integration tests
│       ├── git/                   # Git operation tests
│       ├── session/               # Session management tests
│       ├── workflow/              # Workflow tests
│       ├── *.test.ts              # Root-level feature tests
│       └── extension.test.ts      # Main extension tests
│
├── package.json                   # Extension manifest, commands, views, keybindings
├── tsconfig.json                  # TypeScript configuration
├── eslint.config.mjs              # ESLint configuration
│
├── workflows/                     # Built-in workflow templates
│   └── *.yaml                     # YAML workflow definitions
│
├── .lanes/                        # Lanes extension state (user-created)
│   ├── session_management/        # Session tracking (if not using global storage)
│   └── workflows/                 # Custom workflow templates
│
├── .worktrees/                    # Git worktrees (sessions)
│   └── <session-name>/            # Individual worktree (cloned repo)
│       ├── .claude-session        # Session ID (if using repo storage)
│       ├── .claude-status         # Status ('idle', 'working', etc.)
│       ├── .chime-enabled         # Chime enabled flag
│       ├── workflow-state.json    # Workflow execution state (if running workflow)
│       └── ... (rest of repo)
│
├── .claude/                       # Claude Code settings directory
│   └── settings.local.json        # Local settings (propagated to worktrees)
│
├── scripts/                       # Build scripts
│   ├── bundle-extension.mjs       # esbuild bundle for extension
│   └── bundle-mcp.mjs             # esbuild bundle for MCP server
│
├── .planning/                     # GSD planning documents
│   └── codebase/                  # Codebase analysis
│       ├── ARCHITECTURE.md        # Architecture overview
│       ├── STRUCTURE.md           # This file
│       ├── CONVENTIONS.md         # Coding conventions
│       ├── TESTING.md             # Testing patterns
│       ├── STACK.md               # Technology stack
│       ├── INTEGRATIONS.md        # External integrations
│       └── CONCERNS.md            # Technical debt & issues
│
└── docs/                          # Documentation
    └── ... (various docs)
```

## Directory Purposes

**src/**
- Purpose: All TypeScript source code
- Contains: Extension logic, services, UI providers, commands
- Key files: `extension.ts` (entry), `ClaudeSessionProvider.ts` (main UI), `services/` (business logic)

**src/services/**
- Purpose: Business logic layer - all core operations
- Contains: Session/terminal/workflow/settings management, Git operations
- Key files: `SessionService.ts`, `TerminalService.ts`, `WorkflowService.ts`

**src/commands/**
- Purpose: Command handlers that route UI actions to services
- Contains: Session commands, workflow commands, repair commands
- Depends on: Services, providers, validation
- Used by: Extension (registers all commands)

**src/mcp/**
- Purpose: MCP server integration for Claude workflow execution
- Contains: Server entry point, tool implementations
- Note: `server.ts` is spawned as separate Node.js process

**src/workflow/**
- Purpose: Workflow template definitions and execution state machine
- Contains: Type definitions, state machine, YAML loader, discovery
- Key class: `WorkflowStateMachine` (tracks position in workflow)

**src/validation/**
- Purpose: Input validation and security checks
- Contains: Session name, branch name, path validators
- Pattern: Reject invalid input (never sanitize)

**src/errors/**
- Purpose: Structured error handling with type narrowing
- Contains: Base error class + specific error types
- Pattern: Discriminated union with `kind` property

**src/codeAgents/**
- Purpose: Abstract agent behavior (strategy pattern)
- Contains: Base CodeAgent, ClaudeCodeAgent implementation
- Usage: Injected at extension initialization

**src/types/**
- Purpose: TypeScript type definitions and augmentations
- Contains: Service container, VS Code types, Git extension types

**src/test/**
- Purpose: Complete test suite organized by functionality
- Structure: `core/`, `config/`, `integration/`, `git/`, `session/`, `workflow/`
- Pattern: Test files co-located with features (sessionCommands → sessionCommands.test.ts)

**.lanes/**
- Purpose: Lanes extension state (created at runtime)
- Contains: Session tracking files (if repo-local storage), custom workflows
- Structure: `session_management/` (repo-relative storage), `workflows/` (custom templates)

**.worktrees/**
- Purpose: Git worktrees representing sessions
- Contains: Cloned repo + session metadata files
- Files: `.claude-session` (ID), `.claude-status` (state), `.chime-enabled` (flag), `workflow-state.json` (workflow state)

**.claude/**
- Purpose: Claude Code settings directory
- Contains: `settings.local.json` (user-configured environment, models, permissions)
- Propagation: Copied/symlinked to each worktree by SessionService

**scripts/**
- Purpose: Build automation
- Contains: esbuild bundling scripts for extension and MCP server

**.planning/codebase/**
- Purpose: GSD codebase analysis documents
- Contains: Architecture, structure, conventions, testing, stack, integrations, concerns

**workflows/**
- Purpose: Built-in workflow templates
- Contains: YAML files defining multi-step workflows for Claude

**docs/**
- Purpose: User and developer documentation
- Contains: API docs, guides, examples

## Key File Locations

**Entry Points:**
- `src/extension.ts` - Main extension activation
- `src/mcp/server.ts` - MCP server subprocess entry (spawned by TerminalService)

**Configuration:**
- `package.json` - Extension manifest (commands, views, menus, keybindings, settings)
- `tsconfig.json` - TypeScript compiler options
- `eslint.config.mjs` - Linting rules

**Core Logic:**
- `src/services/SessionService.ts` - Session/worktree creation and lifecycle
- `src/services/TerminalService.ts` - Claude terminal spawning
- `src/services/WorkflowService.ts` - Workflow validation and execution
- `src/services/SettingsService.ts` - Settings and base repo detection
- `src/gitService.ts` - Git command abstraction

**UI/Views:**
- `src/ClaudeSessionProvider.ts` - Active sessions tree view
- `src/SessionFormProvider.ts` - Session creation webview form
- `src/PreviousSessionProvider.ts` - Previous sessions history
- `src/WorkflowsProvider.ts` - Workflow templates tree view
- `src/GitChangesPanel.ts` - Git diff webview panel

**Workflow System:**
- `src/workflow/types.ts` - WorkflowTemplate, WorkflowState interfaces
- `src/workflow/state.ts` - WorkflowStateMachine class
- `src/workflow/loader.ts` - YAML template loading
- `src/mcp/tools.ts` - MCP tool implementations (workflow_status, workflow_advance, etc.)

**Testing:**
- `src/test/extension.test.ts` - Main extension tests
- `src/test/core/` - Core functionality tests (workflows, settings, hooks, diffs)
- `src/test/config/` - Configuration tests (storage, prompts, package config)
- `src/test/integration/` - Integration tests (error paths, MCP, git recovery)

## Naming Conventions

**Files:**
- PascalCase for classes/providers: `ClaudeSessionProvider.ts`, `SessionFormProvider.ts`
- camelCase for utilities/services: `gitService.ts`, `utils.ts`, `AsyncQueue.ts`
- camelCase for services: `SessionService.ts` (even though it's a module exporting functions)
- Test files: `*.test.ts` suffix (e.g., `extension.test.ts`, `session-provider-workflow.test.ts`)

**Directories:**
- lowercase for feature directories: `services/`, `commands/`, `validation/`, `errors/`
- lowercase for organized test categories: `core/`, `config/`, `integration/`, `git/`

**Exports:**
- Named exports preferred: `export function createSession() {}`
- Default exports for classes: `export default class ClaudeSessionProvider {}`
- Barrel files (`index.ts`) for re-exporting: `src/commands/index.ts`, `src/workflow/index.ts`

**Constants:**
- UPPER_SNAKE_CASE: `const PERMISSION_MODES = ['acceptEdits', 'bypassPermissions']`
- const at module level: `const MAX_SESSION_NAME_LENGTH = 200`

## Where to Add New Code

**New Feature:**
- Primary code: `src/services/` (business logic) + `src/commands/` (UI handler)
- Tests: `src/test/core/` (if core logic), `src/test/integration/` (if cross-service)
- Example: Adding session property → `SessionService.ts` + `commands/sessionCommands.ts` + `test/core/`

**New Component/Module:**
- Implementation: Create new service in `src/services/YourService.ts` or provider in `src/YourProvider.ts`
- Tests: Co-located test file or dedicated test directory
- Exports: Register exports in appropriate barrel file (`src/commands/index.ts`, etc.)
- Example: New provider → `src/NewProvider.ts` + `src/test/NewProvider.test.ts`

**Utilities:**
- Shared helpers: `src/utils.ts` (for functions), or create `src/lib/YourUtil.ts`
- Validation: `src/validation/validators.ts` (for input checks)
- Errors: `src/errors/YourError.ts` (for error subclasses)
- Example: New validator → `src/validation/validators.ts` + function export

**New Workflow Feature:**
- Workflow types: `src/workflow/types.ts`
- State machine logic: `src/workflow/state.ts` (WorkflowStateMachine methods)
- MCP tools: `src/mcp/tools.ts` (new tool functions)
- Example: New step type → Add to WorkflowStep union in types.ts, handle in state.ts, add tool in tools.ts

**Tests:**
- Unit tests for services: `src/test/core/service-name.test.ts`
- Integration tests: `src/test/integration/feature-name.test.ts`
- Test utilities: `src/test/fixtures/` or inline factories
- Example: Test session creation → `src/test/session/session-service.test.ts` or `src/test/core/session-service.test.ts`

## Special Directories

**src/test/**
- Purpose: Test suite
- Generated: No
- Committed: Yes
- Organization: By feature/layer (core, config, integration, git, session, workflow)

**.lanes/session_management/**
- Purpose: Session tracking files (when not using global storage)
- Generated: Yes (created at runtime by SessionService)
- Committed: No (in .gitignore)
- Structure: Contains session ID files and session metadata

**.worktrees/<session-name>/**
- Purpose: Individual session worktree
- Generated: Yes (created by `git worktree add`)
- Committed: No (in .gitignore)
- Special files:
  - `.claude-session` - Session UUID (for tracking)
  - `.claude-status` - Status JSON ({status: 'idle'|'working'|etc.})
  - `.chime-enabled` - Boolean flag
  - `workflow-state.json` - Current workflow execution state

**.planning/codebase/**
- Purpose: GSD codebase analysis documents
- Generated: Yes (by gsd:map-codebase)
- Committed: Yes
- Contains: Architecture, structure, conventions, testing, stack, integrations, concerns

**workflows/**
- Purpose: Built-in YAML workflow templates
- Generated: No (checked in)
- Committed: Yes
- Format: YAML with name, description, agents, loops, steps

**out/**
- Purpose: Compiled JavaScript output
- Generated: Yes (by `npm run compile`)
- Committed: No (in .gitignore)
- Contains: `.js` and `.js.map` files from TypeScript compilation

**node_modules/**
- Purpose: npm dependencies
- Generated: Yes (by `npm install`)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-02-09*
