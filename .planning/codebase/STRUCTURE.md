# Codebase Structure

**Analysis Date:** 2026-02-08

## Directory Layout

```
/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/
├── src/                      # Source code
│   ├── extension.ts          # Main extension entry point
│   ├── ClaudeSessionProvider.ts  # Session management tree provider
│   ├── SessionFormProvider.ts    # Session creation UI
│   ├── GitChangesPanel.ts    # Git diff webview
│   ├── PreviousSessionProvider.ts  # Previous sessions tree
│   ├── WorkflowsProvider.ts  # Workflows tree provider
│   ├── gitService.ts         # Git operations
│   ├── localSettings.ts      # Settings propagation
│   ├── utils.ts              # Utility functions
│   ├── codeAgents/           # Claude Code agents
│   │   ├── CodeAgent.ts      # Base agent class
│   │   ├── ClaudeCodeAgent.ts  # Claude implementation
│   │   └── index.ts          # Exports
│   ├── mcp/                  # MCP server integration
│   │   └── tools.ts          # MCP tool implementations
│   ├── workflow/             # Workflow system
│   │   ├── state.ts          # State machine
│   │   ├── loader.ts         # Workflow loader
│   │   ├── types.ts          # Workflow types
│   │   ├── discovery.ts      # Workflow discovery
│   │   └── index.ts          # Exports
│   ├── types/                # TypeScript type definitions
│   │   └── git.d.ts          # Git-related types
│   └── test/                 # Test files
├── out/                     # Compiled JavaScript
├── workflows/               # Built-in workflow templates
├── .lanes/                  # Lanes-specific state
│   ├── pending-sessions/    # MCP session requests
│   └── workflows/          # Custom workflows
├── .claude/                # Claude-specific files
│   ├── agents/             # Agent definitions
│   └── skills/             # Skill definitions
├── .planning/              # Planning documents
│   └── codebase/           # Generated architecture docs
├── docs/                   # Documentation
└── package.json            # Extension manifest
```

## Directory Purposes

**`src/`:**
- Purpose: Main source code directory
- Contains: All TypeScript files for the extension
- Key files: `extension.ts` (entry), `ClaudeSessionProvider.ts` (sessions)
- Build output: Compiled to `out/` directory

**`src/codeAgents/`:**
- Purpose: Claude Code agent implementations
- Contains: Base agent and Claude-specific agent
- Key files: `ClaudeCodeAgent.ts` (main implementation)
- Pattern: Abstract factory pattern

**`src/workflow/`:**
- Purpose: Workflow execution system
- Contains: State machine, loader, types, discovery
- Key files: `state.ts` (workflow state management)
- Pattern: State machine with persistence

**`src/mcp/`:**
- Purpose: MCP server communication layer
- Contains: Tool implementations for remote communication
- Key files: `tools.ts` (MCP tool functions)
- Pattern: Tool-based API with state persistence

**`.lanes/`:**
- Purpose: Extension-specific state and storage
- Contains: Pending sessions, custom workflows
- Key files: Generated at runtime
- Pattern: Directory-based persistence

**`workflows/`:**
- Purpose: Built-in workflow templates
- Contains: YAML workflow definitions
- Key files: Various .yaml workflow files
- Generated: By extension build process

**`docs/`:**
- Purpose: Project documentation
- Contains: Blog posts, scripts, plans
- Key files: Various documentation files
- Generated: Continuous updates

## Key File Locations

**Entry Points:**
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/extension.ts`: Main extension entry point
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/package.json`: Extension manifest

**Configuration:**
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/package.json`: Extension configuration, commands, views
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/.vscode/`: VS Code workspace settings

**Core Logic:**
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/ClaudeSessionProvider.ts`: Session management
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/extension.ts`: Extension initialization

**Testing:**
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/test/`: Unit and integration tests
- `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/test/extension.test.ts`: Main test suite

## Naming Conventions

**Files:**
- PascalCase for classes: `ClaudeSessionProvider.ts`
- camelCase for functions and variables: `getSessionId()`
- kebab-case for workflow files: `copy-writer.yaml`
- snake_case for test files: `extension.test.ts`

**Directories:**
- PascalCase for feature directories: `codeAgents/`, `workflow/`
- lowercase for utility directories: `src/test/`
- prefix with dot for hidden directories: `.lanes/`, `.claude/`

**Classes:**
- PascalCase with descriptive names: `SessionFormProvider`
- Suffix with 'Provider' for tree data providers
- Suffix with 'Service' for business logic services

**Functions:**
- camelCase with verbs: `createSession()`, `validateWorkflow()`
- Prefix with 'get' for accessors: `getSessionId()`
- Prefix with 'is' for predicates: `isGlobalStorageEnabled()`

## Where to Add New Code

**New Feature:**
- Primary code: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/` (create new .ts file)
- Tests: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/test/` (create corresponding .test.ts)
- Configuration: Update `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/package.json`

**New Agent:**
- Implementation: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/codeAgents/`
- Extend from `CodeAgent.ts` base class
- Add to `index.ts` exports

**New Workflow:**
- Template: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/workflows/` (add .yaml)
- Custom: User-defined in `.lanes/workflows/`
- Types: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/workflow/types.ts`

**New Tool:**
- Implementation: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/mcp/tools.ts`
- Follow MCP tool signature pattern
- Add state management if needed

## Special Directories

**`out/`:**
- Purpose: Compiled JavaScript output
- Generated: By TypeScript compiler
- Committed: Yes (for distribution)

**`.lanes/`:**
- Purpose: Runtime state and user data
- Generated: By extension during execution
- Committed: No (user-specific)

**`.claude/`:**
- Purpose: Claude-specific configuration and agents
- Generated: By user or extension
- Committed: No (user-specific)

**`workflows/`:**
- Purpose: Built-in workflow templates
- Generated: By build process
- Committed: Yes (part of extension)

---

*Structure analysis: 2026-02-08*
*