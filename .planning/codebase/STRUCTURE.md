# Codebase Structure

**Analysis Date:** 2026-02-10

## Directory Layout

```
lanes/ (project root)
├── src/                          # All TypeScript source code
│   ├── extension.ts              # Main entry point, activation, initialization
│   ├── ClaudeSessionProvider.ts   # Tree view for active sessions
│   ├── SessionFormProvider.ts     # Webview form for creating sessions
│   ├── PreviousSessionProvider.ts # Tree view for previous sessions
│   ├── WorkflowsProvider.ts       # Tree view for workflow templates
│   ├── GitChangesPanel.ts         # Panel showing git changes for session
│   ├── ProjectManagerService.ts   # Integration with VS Code Project Manager
│   ├── AsyncQueue.ts              # Serial execution queue for preventing race conditions
│   ├── watchers.ts                # File system watchers for status/session changes
│   ├── gitService.ts              # Git command execution wrapper
│   ├── localSettings.ts           # Local settings propagation to worktrees
│   ├── utils.ts                   # Shared utilities (sanitization, validation results)
│   │
│   ├── commands/                  # Command registration and handlers
│   │   ├── index.ts               # Command registration entry point
│   │   ├── sessionCommands.ts      # Session creation, deletion, opening
│   │   ├── workflowCommands.ts     # Workflow creation, validation, execution
│   │   └── repairCommands.ts       # Worktree repair operations
│   │
│   ├── services/                  # Domain business logic services
│   │   ├── SessionService.ts       # Session creation, validation, worktree management
│   │   ├── TerminalService.ts      # Terminal lifecycle, code agent CLI invocation
│   │   ├── WorkflowService.ts      # Workflow loading, validation, template discovery
│   │   ├── SettingsService.ts      # Extension settings file management
│   │   ├── DiffService.ts          # Git diff generation between branches
│   │   ├── FileService.ts          # File I/O operations (read, write, exists checks)
│   │   ├── BrokenWorktreeService.ts # Detection and repair of broken worktrees
│   │   ├── SessionProcessService.ts # Processing pending session requests from MCP
│   │   └── McpAdapter.ts           # Adapter layer for MCP server integration
│   │
│   ├── workflow/                  # Workflow engine and state management
│   │   ├── types.ts               # Workflow template types (WorkflowTemplate, WorkflowStep)
│   │   ├── state.ts               # Workflow state persistence and context retrieval
│   │   ├── loader.ts              # YAML template loading and parsing
│   │   ├── discovery.ts           # Workflow template discovery from directories
│   │   └── index.ts               # Workflow module exports
│   │
│   ├── mcp/                       # Model Context Protocol server integration
│   │   ├── server.ts              # MCP server initialization and lifecycle
│   │   ├── tools.ts               # MCP tool implementations (workflow, artifact tracking)
│   │   └── index.ts               # MCP module exports
│   │
│   ├── codeAgents/                # Code agent abstraction layer
│   │   ├── CodeAgent.ts           # Abstract base class and interfaces
│   │   ├── ClaudeCodeAgent.ts      # Claude-specific implementation
│   │   └── index.ts               # Code agent exports
│   │
│   ├── validation/                # Input validation and sanitization
│   │   ├── validators.ts          # Validation functions (session name, branch name, workflow)
│   │   ├── schemas.ts             # JSON schemas for workflow validation
│   │   ├── pathSanitizer.ts       # Path sanitization to prevent directory traversal
│   │   └── index.ts               # Validation module exports
│   │
│   ├── errors/                    # Custom error classes
│   │   ├── LanesError.ts          # Base error class with context
│   │   ├── GitError.ts            # Git command execution errors
│   │   ├── ValidationError.ts      # Input validation errors
│   │   └── index.ts               # Error class exports
│   │
│   ├── types/                     # TypeScript type definitions
│   │   ├── serviceContainer.d.ts  # Dependency injection container type
│   │   ├── extension.d.ts         # VS Code extension-specific types
│   │   ├── git.d.ts               # Git-related types
│   │   └── mcp.d.ts               # MCP-related types
│   │
│   └── test/                      # Test suite
│       ├── testSetup.ts           # Common test utilities (temp dirs, mocks, stubs)
│       ├── core/                  # Core functionality tests
│       ├── config/                # Configuration tests
│       ├── integration/           # Integration tests
│       ├── workflow/              # Workflow system tests
│       ├── git/                   # Git operation tests
│       ├── session/               # Session management tests
│       └── *.test.ts              # Individual feature test files
│
├── src-mcp/                       # (Not examined - separate MCP server codebase)
│
├── package.json                   # NPM dependencies and extension manifest
├── tsconfig.json                  # TypeScript compiler options
├── eslint.config.mjs              # ESLint configuration
├── .vscode-test.mjs               # VS Code test runner configuration
│
├── .lanes/                        # Session management metadata
│   ├── session_management/        # Persisted session tracking (when not using global storage)
│   └── workflows/                 # Custom workflow templates (user-defined)
│
├── .claude/                       # Claude Code configuration
│   ├── agents/                    # Agent definitions for GSD workflows
│   └── skills/                    # Custom skills for agents
│
├── .github/                       # GitHub configuration
│   └── workflows/                 # CI/CD pipeline definitions
│
├── docs/                          # Project documentation
│   ├── plans/                     # GSD phase plans
│   ├── blog/                      # Blog posts and case studies
│   └── scripts/                   # Documentation helper scripts
│
├── media/                         # Icon and image assets
│
├── scripts/                       # Build and release scripts
│   ├── bundle-extension.mjs       # Webpack bundling for extension
│   ├── bundle-mcp.mjs             # Bundling for MCP server
│   └── release.sh                 # Release automation
│
└── .planning/                     # GSD codebase documentation (generated)
    └── codebase/                  # Architecture, structure, conventions, concerns
```

## Directory Purposes

**src/**
- Purpose: All TypeScript source code for the VS Code extension
- Contains: UI components (providers, commands), services, utilities, types, errors, tests

**src/commands/**
- Purpose: VS Code command handlers organized by domain
- Contains: Session commands (create, delete, open), workflow commands (create, validate, load), repair commands
- Key files: `index.ts` (entry point), `sessionCommands.ts`, `workflowCommands.ts`

**src/services/**
- Purpose: Core business logic separated by domain concern
- Contains: Session management, terminal lifecycle, workflow operations, git operations, file I/O
- Design: Each service exposes a focused set of functions; services call lower-level infrastructure services

**src/workflow/**
- Purpose: Workflow template loading, validation, and execution management
- Contains: YAML parsing, schema validation, template discovery, state persistence
- Key files: `types.ts` (data structures), `loader.ts` (YAML parsing), `state.ts` (persistence)

**src/mcp/**
- Purpose: Model Context Protocol server implementation
- Contains: MCP server lifecycle, tool definitions, artifact tracking
- Used by: Claude Code CLI to access extension functionality via MCP tools

**src/codeAgents/**
- Purpose: Abstraction layer for supporting multiple code agents
- Contains: Base interfaces, Claude-specific configuration
- Design: Extensible for adding support for OpenCode, Gemini CLI, Codex CLI

**src/validation/**
- Purpose: Input validation and sanitization
- Contains: Sanitization functions (session names, paths), validation schemas, validator functions
- Design: Pure functions, no side effects, used by commands and services

**src/errors/**
- Purpose: Custom error classes with context preservation
- Contains: LanesError (base), GitError (git failures), ValidationError (input errors)
- Usage: Caught in commands to determine user-facing error messages

**src/types/**
- Purpose: TypeScript type definitions shared across modules
- Contains: ServiceContainer (DI), VS Code types, git types, MCP types
- Design: Type-only files (.d.ts), no runtime code

**src/test/**
- Purpose: Complete test suite with organized structure
- Contains: Unit tests (core/), integration tests (integration/), workflow tests (workflow/)
- Key files: `testSetup.ts` (common utilities), individual `.test.ts` files

**.lanes/**
- Purpose: Session management metadata storage
- Contains: Session tracking files (when not using VS Code global storage), custom workflow templates
- Created by: Extension during session creation and user workflow template creation
- Committed: Yes, user workflow templates; No, session tracking files (.gitignore)

**.claude/**
- Purpose: Claude Code configuration specific to this repository
- Contains: Agent definitions for GSD orchestration, custom agent skills
- Committed: Yes
- Propagated to worktrees: Yes, via `localSettings.ts` if configured

**.github/workflows/**
- Purpose: GitHub Actions CI/CD pipeline
- Contains: TypeScript compilation, linting, testing, publishing
- Committed: Yes

**docs/**
- Purpose: Project documentation and plans
- Contains: Architecture diagrams, user guides, GSD phase plans, blog posts
- Committed: Yes

**media/**
- Purpose: UI assets (icons, logos, screenshots)
- Contains: PNG/SVG assets for extension sidebar and marketplace
- Committed: Yes

**scripts/**
- Purpose: Build and automation scripts
- Contains: Bundling scripts (esbuild), release scripts
- Committed: Yes

**.planning/codebase/**
- Purpose: Generated documentation for GSD orchestration
- Contains: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md
- Committed: No (generated by GSD mapping)

## Key File Locations

**Entry Points:**
- `src/extension.ts` (main): VS Code extension activation, initialization of all services and providers
- `package.json` (manifest): Extension metadata, commands, views, configuration schema

**Configuration:**
- `package.json`: Extension manifest (commands, views, menus, configuration)
- `tsconfig.json`: TypeScript compiler options
- `eslint.config.mjs`: Linting rules
- `.vscode-test.mjs`: Test runner configuration

**Core Logic:**
- `src/services/SessionService.ts`: Session creation, worktree management, branch validation
- `src/services/TerminalService.ts`: Terminal lifecycle, code agent CLI invocation
- `src/services/WorkflowService.ts`: Workflow loading, validation, discovery
- `src/ClaudeSessionProvider.ts`: Session status tracking, tree view data provider
- `src/commands/sessionCommands.ts`: User-facing session operations

**Testing:**
- `src/test/testSetup.ts`: Common test utilities, fixtures, mock setup
- `src/test/*.test.ts`: Individual test files (run via `npm test`)
- `.vscode-test.mjs`: Test runner configuration (VS Code test CLI)

**Workflows:**
- `.lanes/workflows/`: User-defined workflow templates (YAML)
- Built-in workflows: Bundled with extension (not in source tree)

## Naming Conventions

**Files:**
- `.ts`: Main source files (TypeScript)
- `.d.ts`: Type definitions only (no runtime code)
- `.test.ts`: Test files (suffix pattern for Jest/Mocha discovery)
- Services: `{Domain}Service.ts` e.g., `SessionService.ts`, `TerminalService.ts`
- Providers: `{Domain}Provider.ts` e.g., `ClaudeSessionProvider.ts`

**Directories:**
- `src/`: All source code
- `src/services/`: Business logic services
- `src/commands/`: Command handlers
- `src/test/`: Test files mirroring src structure
- Built-in workflows: Bundled in extension, not in repo
- Custom workflows: `.lanes/workflows/{name}.yaml`

**Variables & Functions:**
- camelCase for functions and variables: `createSession()`, `sessionName`
- PascalCase for classes: `ClaudeSessionProvider`, `LanesError`
- CONSTANT_CASE for constants: `PERMISSION_MODES`, `VALID_STATUS_VALUES`
- Internal/private prefixed with `_`: `_onSubmit`, `_view`

**Types:**
- PascalCase for interfaces: `SessionFormSubmitCallback`, `CodeAgentConfig`
- `Handler` suffix for event handlers: `SessionFormSubmitCallback`
- `Result` suffix for result types: `ValidationResult`, `TempDirResult`

## Where to Add New Code

**New Session Feature:**
- Primary code: `src/services/SessionService.ts` (core logic)
- Commands: `src/commands/sessionCommands.ts` (user-facing entry point)
- Types: `src/types/extension.d.ts` if needs to be shared
- Tests: `src/test/session/*.test.ts`

**New Workflow Feature:**
- Primary code: `src/services/WorkflowService.ts` (business logic)
- Types: `src/workflow/types.ts` (data structures)
- Commands: `src/commands/workflowCommands.ts` (user commands)
- Tests: `src/test/workflow/*.test.ts`

**New Code Agent Support:**
- Primary code: `src/codeAgents/{Agent}CodeAgent.ts` (new implementation)
- Base: Extend from `src/codeAgents/CodeAgent.ts` (interface)
- Export: Add to `src/codeAgents/index.ts`
- Integration: Update `extension.ts` to instantiate new agent

**New Utilities:**
- Shared helpers: `src/utils.ts` (cross-module utilities)
- Validation: `src/validation/validators.ts` (input validation)
- File operations: Reuse `src/services/FileService.ts`
- Git operations: Reuse `src/gitService.ts`

**New Services:**
- Create `src/services/{Domain}Service.ts` with focused responsibility
- Export public functions, keep state private
- Depend on FileService, gitService, and lower-level infrastructure
- Register in ServiceContainer if needs to be shared

**New Commands:**
- Add to appropriate file: `src/commands/{domain}Commands.ts`
- Register in `registerAllCommands()` in `src/commands/index.ts`
- Use ServiceContainer for dependency injection
- Call appropriate services for business logic

**New Test Suite:**
- Create `src/test/{domain}/*.test.ts`
- Import utilities from `src/test/testSetup.ts`
- Use existing test patterns (mocha suites, sinon stubs)
- Add to CI pipeline via `.github/workflows/`

## Special Directories

**src/test/**
- Purpose: Complete test suite
- Generated: No
- Committed: Yes
- Structure mirrors src/ for organization (test/core/, test/integration/, test/workflow/)
- Run with: `npm test`
- Coverage: View with `npm run test -- --coverage`

**.lanes/**
- Purpose: Session metadata and custom workflows
- Generated: Yes (during session creation)
- Committed: User workflows yes, session tracking files no (.gitignore)
- Contents: Session tracking files when not using global storage, custom workflow templates

**.planning/codebase/**
- Purpose: Generated GSD documentation
- Generated: Yes (by GSD codebase mapper)
- Committed: No (.gitignore)
- Contents: ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, CONCERNS.md

**out/**
- Purpose: Compiled JavaScript output
- Generated: Yes (by `npm run compile`)
- Committed: No (.gitignore)
- Contains: Compiled .js files and .js.map source maps

**.vscode/**
- Purpose: VS Code workspace settings and launch configurations
- Generated: No
- Committed: Yes
- Contains: Launch configuration for extension development (F5 debugging)

---

*Structure analysis: 2026-02-10*
