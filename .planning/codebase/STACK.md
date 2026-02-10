# Technology Stack

**Analysis Date:** 2026-02-10

## Languages

**Primary:**
- TypeScript 5.9.3 - Extension and MCP server development, source in `src/`
- JavaScript - Build scripts (esbuild bundling)

**Secondary:**
- Shell/Bash - Release and installation scripts in `scripts/`

## Runtime

**Environment:**
- Node.js (target 18+)
- VS Code 1.75.0+ (VS Code extension host)

**Package Manager:**
- npm (Node Package Manager)
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- VS Code Extension API (`vscode@^1.75.0`) - Extension UI and integration
- Model Context Protocol (MCP) SDK (`@modelcontextprotocol/sdk@^1.25.2`) - MCP server for workflow tools

**Build & Bundling:**
- esbuild 0.27.2 - Fast ES module bundler for extension and MCP server
- TypeScript 5.9.3 - Compilation to ES2022/Node16

**Development:**
- @vscode/test-cli 0.0.12 - VS Code extension testing runner
- @vscode/test-electron 2.5.2 - Electron-based test execution
- @vscode/vsce 3.7.1 - VS Code Extension packaging and publishing

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk@^1.25.2` - Enables MCP server implementation for workflow state management and tool execution. Used in `src/mcp/server.ts` to provide tools for workflow control
- `yaml@^2.8.2` - YAML workflow template parsing and loading in `src/workflow/loader.ts`
- `vscode` - VS Code API for all extension features (sidebar, commands, webviews, terminals, file watchers)

**Infrastructure:**
- `child_process` (Node.js built-in) - Git command execution via spawned processes in `src/gitService.ts`
- `fs/promises` (Node.js built-in) - Async file I/O for session state, settings, and workflow state
- `path` (Node.js built-in) - Path manipulation for worktree and configuration management

## Configuration

**Environment:**
- Configuration managed via VS Code settings: `lanes.worktreesFolder`, `lanes.baseBranch`, `lanes.localSettingsPropagation`, etc.
- Local settings propagation via `.claude/settings.local.json` (optional file in base repo)
- Workflow-state.json persisted in worktrees for MCP server resumption

**Build:**
- `tsconfig.json` - TypeScript compiler options (ES2022 target, Node16 module resolution, strict mode)
- `eslint.config.mjs` - ESLint with typescript-eslint plugin, enforces async file I/O
- `scripts/bundle-extension.mjs` - esbuild configuration for extension bundling
- `scripts/bundle-mcp.mjs` - esbuild configuration for MCP server bundling
- `package.json` - Extension manifest with VS Code contribution declarations

## Testing Framework

**Test Runner:**
- Mocha (via `@vscode/test-cli`) - Test execution
- Sinon 21.0.1 - Mocking and stubbing
- memfs 4.56.10 - In-memory file system for file operation mocking

**Test Files:**
- Location: `src/test/extension.test.ts`
- Run: `npm test` (compiles, lints, runs tests)
- Watch: `npm run watch` (TypeScript compilation)

## Platform Requirements

**Development:**
- Node.js 18+ for running build scripts and tests
- Git 2.13.0+ (for git worktree support)
- VS Code 1.75.0+ with Git extension enabled

**Production (Extension Runtime):**
- VS Code 1.75.0+
- Git extension (required: listed in `extensionDependencies`)
- Git CLI available in PATH or discoverable via VS Code Git extension
- Fallback to system `git` command if VS Code Git extension unavailable

**Special Files:**
- `.env` files - Not present; all configuration via VS Code settings
- Lockfile present: `package-lock.json` ensures consistent dependencies across environments

---

*Stack analysis: 2026-02-10*
