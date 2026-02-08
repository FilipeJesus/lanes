# External Integrations

**Analysis Date:** 2026-02-08

## APIs & External Services

**Claude AI:**
- Claude Code CLI - Direct integration for session management
- Permission modes: acceptEdits, bypassPermissions, dontAsk
- Session tracking via .claude-session files
- Status tracking via .claude-status files
- CLI command: `claude`

**Git Integration:**
- Git worktrees - Isolated session management
- Git command execution via gitService.ts
- Branch comparison for change tracking
- Status hooks integration
- Extension dependency: vscode.git

**VS Code API:**
- Terminal management - Dedicated terminal per session
- Webview components - Session form and workflows UI
- Tree data providers - Session, previous session, and workflow views
- Global and workspace storage
- Extension menus and keybindings

## Data Storage

**Databases:**
- None - Uses file system for persistence
- Session state stored in worktree directories

**File Storage:**
- Local filesystem - All state management
- Worktree-based storage for sessions
- VS Code global storage for extension metadata
- .lanes directory for internal files

**Caching:**
- Project Manager service in-memory cache
- TypeScript compiler output (out/ directory)

## Authentication & Identity

**Auth Provider:**
- Not applicable - No external authentication required
- Uses local Git identity for commits

## Monitoring & Observability

**Error Tracking:**
- Console logging throughout codebase
- No external error tracking service
- VS Code output channel for debugging

**Logs:**
- Console.error and console.log
- Git execution logging
- Session activity tracking

## CI/CD & Deployment

**Hosting:**
- VS Code Marketplace
- Open VSX (ovsx CLI)

**CI Pipeline:**
- Manual via release scripts
- Pre-commit hooks (compile, lint, test)
- No external CI detected

## Environment Configuration

**Required env vars:**
- None required for extension operation
- Claude Code configuration via settings.local.json

**Secrets location:**
- No secrets handled by the extension
- User-managed Claude Code configuration

## Webhooks & Callbacks

**Incoming:**
- MCP tool calls from external Claude sessions
- File system monitoring for pending session requests

**Outgoing:**
- None detected
- No external API calls from extension

---

*Integration audit: 2026-02-08*
```