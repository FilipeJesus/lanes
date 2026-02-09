# Technology Stack

**Analysis Date:** 2026-02-09

## Languages

**Primary:**
- TypeScript 5.9.3 - Core application code, all extension and MCP server functionality
- JavaScript (ES2022) - Build scripts (esbuild bundling) and test configuration

**Secondary:**
- YAML - Workflow template definitions (loaded and parsed by the application)
- Shell Script - Release automation and installation scripts

## Runtime

**Environment:**
- Node.js 18+ (target for bundled code via esbuild)
- VS Code Extension Host (Electron-based, runs extension.bundle.js)
- Standalone Node process (MCP server runs as subprocess via mcp/server.js)

**Package Manager:**
- npm 8.x+ (implicit from package.json)
- Lockfile: `package-lock.json` (present, checked into repo)

## Frameworks

**Core:**
- VS Code API 1.75.0+ (`@types/vscode: ^1.75.0`) - Extension UI, sidebar views, commands, webviews
- Model Context Protocol (MCP) 1.25.2 (`@modelcontextprotocol/sdk: ^1.25.2`) - Workflow control interface between Claude and extension

**Testing:**
- Mocha 10.x (@types/mocha: ^10.0.10) - Test runner and assertion framework
- Sinon 21.x (sinon: ^21.0.1) - Mocking and stubbing
- VS Code Test Suite (@vscode/test-cli: ^0.0.12, @vscode/test-electron: ^2.5.2) - Extension testing harness

**Build/Dev:**
- esbuild 0.27.2 - Fast TypeScript compilation and bundling (extension + MCP server)
- TypeScript 5.9.3 - Transpilation (tsconfig.json targets ES2022, module Node16)
- ESLint 9.39.1 + typescript-eslint 8.48.1 - Linting and code quality
- Husky 9.1.7 - Git pre-commit hooks for compile/lint/test
- VS Code Extension Tools (@vscode/vsce: ^3.7.1, ovsx: ^0.10.2) - Packaging and publishing

## Key Dependencies

**Critical:**
- `@modelcontextprotocol/sdk@^1.25.2` - Core MCP SDK for server implementation, stdio transport, tool definitions
  - Location: `src/mcp/server.ts` (Server, StdioServerTransport) and `src/mcp/tools.ts`
  - Bundled into `out/mcp/server.js` for distribution

- `yaml@^2.8.2` - YAML parsing for workflow template definitions
  - Location: `src/workflow/loader.ts` (loadWorkflowTemplateFromString), `src/workflow/discovery.ts`
  - Handles `.yaml` workflow files, type-safe parsing

**Infrastructure:**
- `vscode@latest` - Extension runtime (provided by VS Code, not bundled)
  - Referenced via `src/extension.ts`, all providers and commands
  - Excluded from bundle in esbuild config

- `@types/node@22.x` - Node.js type definitions (async fs/promises, child_process, path utilities)
  - Used throughout for async file I/O and git command execution

- `@types/vscode@^1.75.0` - VS Code API types for TreeDataProvider, Webview, ExtensionContext, etc.

**Testing Infrastructure:**
- `memfs@^4.56.10` - In-memory filesystem for unit tests, avoiding disk I/O during tests
  - Used in service tests to mock file operations

- `sinon@^21.0.1` - Spies, stubs, and mocks for isolating services during tests

## Configuration

**Environment:**
- No `.env` file required - extension uses VS Code settings (`lanes.worktreesFolder`, `lanes.baseBranch`, `lanes.chimeSound`, etc.)
- Optional: `.claude/settings.local.json` in base repo (auto-propagated to worktrees via `src/localSettings.ts` if `lanes.localSettingsPropagation` is enabled)
- Git executable path: resolved from VS Code's Git Extension API or defaults to system `git`

**Build:**
- `tsconfig.json` - TypeScript compilation (target: ES2022, module: Node16, strict: true, sourceMap: true)
  - Compiles `src/**/*.ts` to `out/**/*.js`

- `esbuild` bundling:
  - Extension: `scripts/bundle-extension.mjs` → `out/extension.bundle.js` (external: ['vscode'], minify: false)
  - MCP Server: `scripts/bundle-mcp.mjs` → `out/mcp/server.js` (bundles all deps, minify: false)

- `.vscode-test.mjs` - Test runner configuration using @vscode/test-cli
  - Test files: `out/test/**/*.test.js`
  - Uses temporary directory for VS Code user data

- `eslint.config.mjs` - Flat config format (ESLint v9+)
  - Enforces no synchronous fs methods (error rule in production)
  - Allows in test files only

## Platform Requirements

**Development:**
- VS Code 1.75.0 or later (editor required for extension development)
- Node.js 18+ (for build scripts and local testing)
- Git (local installation or via VS Code Git Extension)
- TypeScript compiler (via npm)

**Production:**
- VS Code 1.75.0 or later (deployment target)
- Requires: `vscode.git` extension dependency (uses VS Code's Git Extension API)
- Bundles: All dependencies except `vscode` (which is provided by VS Code)
- Distributes: `out/extension.bundle.js` (entry point in package.json) + `out/mcp/server.js`

**Extension Distribution:**
- VS Code Marketplace (.vsix package via vsce)
- Open VSX Registry (.ovsx package via ovsx)

---

*Stack analysis: 2026-02-09*
