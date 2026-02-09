# External Integrations

**Analysis Date:** 2026-02-09

## APIs & External Services

**Claude AI via MCP:**
- Model Context Protocol (MCP) Server - Enables Claude to control workflows within Lanes
  - SDK: `@modelcontextprotocol/sdk@^1.25.2`
  - Transport: Standard input/output (stdio) via child process
  - Location: `src/mcp/server.ts`, `src/mcp/tools.ts`
  - Endpoint: Spawned as subprocess with arguments `--worktree <path> --workflow-path <path> --repo-root <path>`
  - Tools exposed: `workflow_status`, `workflow_advance`, `workflow_set_tasks`, `workflow_context` (defined in `src/mcp/tools.ts`)

**VS Code Git Extension API:**
- Used to resolve the `git` executable path from VS Code's built-in Git extension
- Location: `src/gitService.ts` (initializeGitPath function)
- API call: `vscode.extensions.getExtension<GitExtension>('vscode.git')`
- Fallback: System `git` command if extension unavailable
- Type definition: `src/types/git.d.ts` (GitExtension interface)

## Data Storage

**Local File System Only:**
- No external database required
- Session state persisted to: `.git/.lanes/pending-*.json` (pending session configs)
- Workflow state persisted to: `workflow-state.json` in each worktree (via `src/services/McpAdapter.ts`)
- Worktree metadata: Stored in global VS Code storage (`context.globalStorageUri`) or `.lanes/session_management/` (configurable)
- Workflow templates: `.lanes/workflows/*.yaml` (custom templates) or discovered from repo

**File Operations:**
- Client: Native Node.js `fs/promises` async API (enforced via ESLint rule)
- Atomic writes: `src/services/FileService.ts` (atomicWrite function) prevents corruption on crash
- Locations: Worktrees folder, session metadata, prompt files, diff outputs

**Caching:**
- None - No dedicated caching layer
- In-memory state: WorkflowStateMachine object held in `src/mcp/server.ts` during session lifecycle

## Authentication & Identity

**Auth Provider:**
- Custom (None required)
- No API key or credential management
- Git authentication: Delegated to user's local git config (SSH keys, credentials)
- VS Code context: Extension identity tied to extension context (stored in globalStorageUri)

## Monitoring & Observability

**Error Tracking:**
- None - No external error tracking service
- Errors logged to VS Code Output Channel and extension logs

**Logs:**
- Console.log to VS Code Output Channel: `console.log()`, `console.error()`, `console.warn()`
- Error handling: Custom error classes in `src/errors/` (LanesError, GitError, ValidationError)
- Debugging: Source maps generated (`sourcemap: true` in tsconfig.json and esbuild)

**Status:**
- Workflow status persisted in `workflow-state.json` (in-memory + disk)
- Session status tracked in tree providers: `src/ClaudeSessionProvider.ts`, `src/PreviousSessionProvider.ts`
- Chime notifications: Audio feedback (local file, not external service)

## CI/CD & Deployment

**Hosting:**
- GitHub repository: `https://github.com/FilipeJesus/lanes`
- Distribution: VS Code Marketplace + Open VSX Registry

**CI Pipeline:**
- Pre-commit hooks: Via Husky (`husky@^9.1.7`)
  - Runs: `npm run compile && npm run lint && npm test`
  - Prevents: Broken code commits
- Manual release: `scripts/release.sh` (semver versioning)
  - Publishes: `.vsix` to VS Code Marketplace via `vsce`
  - Publishes: `.ovsx` to Open VSX Registry via `ovsx`

**Build Process:**
- Compilation: `npm run compile` → TypeScript → esbuild bundles
- Output: `out/extension.bundle.js` (main), `out/mcp/server.js` (workflow server)
- Packaging: `vsce package` creates `.vsix` with bundled artifacts

## Environment Configuration

**VS Code Settings (Configurable):**
- `lanes.worktreesFolder` (string, default: `.worktrees`) - Folder for session worktrees
- `lanes.promptsFolder` (string, default: `""`) - Folder for session prompts (uses global storage if empty)
- `lanes.baseBranch` (string, default: `""`) - Git branch for diff comparison
- `lanes.includeUncommittedChanges` (boolean, default: `true`) - Show unstaged changes in diffs
- `lanes.useGlobalStorage` (boolean, default: `true`) - Store session metadata in VS Code storage vs `.lanes/` folder
- `lanes.localSettingsPropagation` (enum: `copy|symlink|disabled`, default: `copy`) - Propagate `.claude/settings.local.json` to worktrees
- `lanes.workflowsEnabled` (boolean, default: `true`) - Enable workflow selection UI
- `lanes.customWorkflowsFolder` (string, default: `.lanes/workflows`) - Custom workflow templates location
- `lanes.chimeSound` (enum: `chime|alarm|level-up|notification`, default: `chime`) - Audio notification sound

**Required env vars:**
- None for extension itself
- Git SSH key or credentials configured in user's system git config (for git operations)
- Optional: Custom environment variables via `.claude/settings.local.json` (auto-propagated if enabled)

**Secrets location:**
- No secrets stored by Lanes extension
- User credentials: Delegated to local git config (`~/.ssh/id_rsa`, credentials.helper, etc.)
- Sensitive data: Not handled by this extension

## Webhooks & Callbacks

**Incoming:**
- None - Extension does not expose HTTP endpoints

**Outgoing:**
- File watchers: `src/watchers.ts` watches for:
  - Session creation files in `.git/.lanes/pending-*.json` (triggers session creation)
  - Clear request marker files in worktrees (triggers session clearing)
  - Workflow state changes (notifies tree providers)
  - Local settings file changes (re-propagates to worktrees)

**Process Communication:**
- MCP Server spawned as child process: `src/services/SessionProcessService.ts`
  - Parent ↔ Child: stdio (MCP protocol)
  - No HTTP, no webhooks

## Integration Points Summary

| Integration | Type | Location | Required |
|---|---|---|---|
| VS Code Git API | Extension API | `src/gitService.ts` | Yes |
| Model Context Protocol (MCP) | Subprocess | `src/mcp/server.ts` | Yes |
| YAML Workflow Parser | Library | `src/workflow/loader.ts` | Yes |
| Local filesystem | I/O | `src/services/FileService.ts` | Yes |
| VS Code settings | Configuration | `package.json` contributes.configuration | Yes |
| Git worktree CLI | CLI | `src/services/SessionService.ts` | Yes |
| Audio files (chime) | Asset | `media/` (local files) | No |

---

*Integration audit: 2026-02-09*
