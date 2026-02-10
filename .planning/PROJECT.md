# Lanes: Codex CLI Support

## What This Is

Adding OpenAI Codex CLI support to Lanes, the VS Code extension that manages isolated coding sessions using Git worktrees. Currently Lanes only supports Claude Code as its code agent. This project adds Codex as a second supported agent, allowing users to create and manage Codex-powered sessions with the same workflow they use for Claude Code.

## Core Value

Users can create, open, resume, and delete Codex CLI sessions through the Lanes sidebar with the same reliability and isolation as Claude Code sessions.

## Requirements

### Validated

- Session management with Git worktrees (create, open, resume, delete) -- existing
- Claude Code agent integration with hooks, MCP, and workflow support -- existing
- CodeAgent abstraction layer with extensible base class -- existing
- Terminal lifecycle management per session -- existing
- Session form with workflow selection, permissions, and prompt -- existing
- Global storage and local storage session tracking -- existing
- Local settings propagation to worktrees -- existing

### Active

- [ ] CodexCodeAgent implementation extending CodeAgent base class
- [ ] Codex CLI command building (start, resume) with proper flags
- [ ] Codex permission/sandbox mode mapping (read-only, workspace-write, full-access)
- [ ] Codex session resume support (codex resume <ID> or --last)
- [ ] VS Code setting for default agent selection (lanes.defaultAgent)
- [ ] Per-session agent selection in session creation form
- [ ] Codex terminal naming and icon differentiation
- [ ] Session tracking adapted for Codex (session ID capture without hooks)
- [ ] Status tracking for Codex sessions (alternative to Claude's hook-based approach)
- [ ] Settings propagation adapted for Codex (.codex/config.toml vs .claude/settings.json)
- [ ] Extension activation updated to support agent selection
- [ ] Tests for CodexCodeAgent implementation

### Out of Scope

- Workflow/MCP support for Codex sessions -- Codex has different MCP config mechanism (TOML-based), defer to future
- Codex Cloud integration -- only CLI support needed
- IDE extension integration for Codex -- only terminal-based CLI
- Migration tooling between Claude and Codex sessions -- unnecessary complexity
- Codex authentication management -- Codex handles its own auth via `codex login`

## Context

**Existing Architecture:**
The codebase already has a well-designed `CodeAgent` abstraction layer (`src/codeAgents/CodeAgent.ts`) with an abstract base class that defines the contract for all code agents. `ClaudeCodeAgent` is the current implementation. Adding Codex means creating a `CodexCodeAgent` class.

**Key Technical Differences (Codex vs Claude Code):**

| Aspect | Claude Code | Codex CLI |
|--------|------------|-----------|
| CLI command | `claude` | `codex` |
| Start | `claude [prompt]` | `codex [prompt]` |
| Resume | `claude --resume <UUID>` | `codex resume <ID>` |
| Permission modes | `--permission-mode acceptEdits`, `--dangerously-skip-permissions` | `--sandbox read-only/workspace-write/danger-full-access`, `--ask-for-approval untrusted/on-failure/on-request/never` |
| Settings | `.claude/settings.json` (JSON, per-project) | `.codex/config.toml` (TOML, per-project + global) |
| MCP config | `--mcp-config <path>` (JSON file) | `[mcp_servers]` section in config.toml |
| Hooks | Rich hook system (SessionStart, Stop, etc.) | `notify` array in config.toml (notifications only) |
| Session IDs | UUID stored in `.claude-session` by hooks | Managed internally by Codex (rollout files + SQLite) |
| Status tracking | `.claude-status` file updated by hooks | No equivalent -- must implement alternative |

**Key Challenges:**
1. **No hook system**: Codex has no event hooks like Claude's SessionStart/Stop. Session ID capture and status tracking need alternative approaches (e.g., file watching, process monitoring, or wrapping).
2. **Session ID format**: Codex session IDs may not be UUIDs -- need to research actual format and adjust validation.
3. **Settings format**: Codex uses TOML instead of JSON for configuration -- different settings propagation needed.

## Constraints

- **Backward compatibility**: All existing Claude Code functionality must continue working unchanged
- **Tech stack**: TypeScript, VS Code Extension API -- must follow existing patterns
- **Testing**: Must have test coverage for new CodexCodeAgent; pre-commit hooks enforce compile + lint + test
- **Minimal UI changes**: Agent selection should be lightweight -- dropdown in form, VS Code setting for default
- **No new dependencies**: Avoid adding TOML parser unless strictly necessary; prefer simple string generation for config.toml content

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Per-session agent selection with global default | Users want flexibility but also convenience | -- Pending |
| Basic sessions only (no workflow/MCP for Codex) | Codex MCP uses different config format; defer complexity | -- Pending |
| No sidebar visual differentiation for agent type | User preference -- keep UI clean | -- Pending |
| Alternative status tracking for Codex | Codex lacks hook system; may need polling or process monitoring | -- Pending |

---
*Last updated: 2026-02-10 after initialization*
