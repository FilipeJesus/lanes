# Technology Stack

**Analysis Date:** 2026-02-08

## Languages

**Primary:**
- TypeScript 5.9.3 - Core extension logic, MCP server, and CLI tooling
- ES2022 target with Node16 module system

**Secondary:**
- JavaScript - Bundled extension and MCP server for runtime execution

## Runtime

**Environment:**
- Node.js 18+ (minimum target for MCP server)
- VS Code Extension API ^1.75.0

**Package Manager:**
- npm 8+ or 9+
- Lockfile: package-lock.json (present)

## Frameworks

**Core:**
- VS Code Extension API - UI components, commands, views, and terminal management
- Model Context Protocol (MCP) ^1.25.2 - Workflow tool integration

**Testing:**
- VS Code Test CLI ^0.0.12 - Test runner
- Mocha ^10.0.10 - Test framework
- TypeScript ESLint ^8.48.1 - Linting and type checking

**Build/Dev:**
- esbuild ^0.27.2 - Bundling (extension and MCP server)
- TypeScript compiler - Source compilation
- husky ^9.1.7 - Git hooks
- ovsx ^0.10.2 - Extension publishing

## Key Dependencies

**Critical:**
- @modelcontextprotocol/sdk ^1.25.2 - MCP protocol implementation
- yaml ^2.8.2 - Workflow template parsing

**Infrastructure:**
- vscode ^1.75.0 - Extension API
- typescript-eslint ^8.48.1 - TypeScript ESLint integration
- @types/node 22.x - Node.js type definitions
- @types/vscode ^1.75.0 - VS Code API type definitions

## Configuration

**Environment:**
- No environment variables required
- Settings via VS Code configuration (lanes.* namespace)

**Build:**
- TypeScript config: tsconfig.json
- ESLint config: eslint.config.mjs
- Bundle scripts: scripts/bundle-*.mjs

## Platform Requirements

**Development:**
- Node.js 18+
- VS Code ^1.75.0 (for development host)

**Production:**
- VS Code marketplace or Open VSX
- VS Code ^1.75.0 (runtime)
- Git extension dependency

---

*Stack analysis: 2026-02-08*
```