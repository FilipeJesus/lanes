# Lanes: Multi-Agent Code Sessions

## What This Is

A VS Code extension that manages isolated coding sessions using Git worktrees. Supports multiple code agents (Claude Code and OpenAI Codex CLI) with per-session agent selection, shared worktree isolation, and full session lifecycle management.

## Core Value

Users can create, open, resume, and delete code agent sessions through the Lanes sidebar with the same reliability and isolation regardless of which agent they choose.

## Requirements

### Validated

- Session management with Git worktrees (create, open, resume, delete) -- existing
- Claude Code agent integration with hooks, MCP, and workflow support -- existing
- CodeAgent abstraction layer with extensible base class -- existing
- Terminal lifecycle management per session -- existing
- Session form with workflow selection, permissions, and prompt -- existing
- Global storage and local storage session tracking -- existing
- Local settings propagation to worktrees -- existing
- CodexCodeAgent implementation extending CodeAgent base class -- v1.0
- Codex CLI command building (start, resume) with proper flags -- v1.0
- Codex permission/sandbox mode mapping (2 modes) -- v1.0
- Codex session resume support (codex resume <UUID>, strict validation) -- v1.0
- VS Code setting for default agent selection (lanes.defaultAgent) -- v1.0
- Per-session agent selection in session creation form -- v1.0
- Codex terminal naming and icon differentiation -- v1.0
- Session tracking adapted for Codex (filesystem polling, no hooks) -- v1.0
- Status tracking for Codex sessions (active/idle via terminal events) -- v1.0
- Format-agnostic settings service (JSON + TOML) -- v1.0
- Extension activation updated to support agent factory -- v1.0
- Tests for multi-agent system (57 new, 705 total) -- v1.0
- Backward compatibility with legacy claudeWorktrees.* commands (15 aliases) -- v1.0
- Security hardening (injection prevention, path traversal, cross-platform) -- v1.0

### Active

(None yet — planning next milestone)

### Out of Scope

- Workflow/MCP support for Codex sessions -- different TOML-based config mechanism, defer to future
- Codex Cloud integration -- only CLI support needed
- IDE extension integration for Codex -- only terminal-based CLI
- Migration tooling between Claude and Codex sessions -- unnecessary complexity
- Codex authentication management -- Codex handles its own auth via `codex login`
- Sidebar visual differentiation by agent -- user preference to keep UI clean
- Real-time Codex status polling -- basic terminal tracking sufficient for now

## Context

Shipped v1.0 with multi-agent support. 705 tests passing across TypeScript codebase. Tech stack: TypeScript, VS Code Extension API, @iarna/toml. 86 files modified, 11,572 lines added.

Architecture: `CodeAgent` abstract base class with `ClaudeCodeAgent` and `CodexCodeAgent` implementations. Agent factory with singleton caching. Format-agnostic settings service. Hookless session tracking via terminal lifecycle events.

18 tech debt items accumulated (3 important: duplicate utilities, status validation, regex validation). See `.planning/milestones/v1.0-MILESTONE-AUDIT.md`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Per-session agent selection with global default | Users want flexibility but also convenience | Good |
| Basic sessions only (no workflow/MCP for Codex) | Codex MCP uses different config format; defer complexity | Good |
| No sidebar visual differentiation for agent type | User preference -- keep UI clean | Good |
| Hookless session tracking via terminal events | Codex lacks hook system; terminal open/close gives active/idle | Good |
| Hardcoded factory map (not plugin registry) | Only 2 agents, registry is over-engineering | Good |
| .claude-session filename for ALL agents | Pragmatic -- avoids migration, single source of truth | Good |
| Two permission modes matching Claude pattern | Simpler UI, maps well to both agents | Good |
| Strict error on session ID capture failure | No silent --last fallback, user sees explicit error | Good |
| @iarna/toml dependency added | String generation insufficient for reliable TOML | Good |
| Agent-prefixed generic naming | AgentSessionProvider etc. -- clear and extensible | Good |
| execFile with args array for CLI checks | Prevents command injection vs exec with template literal | Good |

## Constraints

- Backward compatibility: All existing Claude Code functionality must continue working
- Tech stack: TypeScript, VS Code Extension API
- Testing: Pre-commit hooks enforce compile + lint + test (705 tests)
- Minimal UI changes: Agent selection is lightweight dropdown
- Phase directories accumulate across milestones (never deleted)

---
*Last updated: 2026-02-10 after v1.0 milestone*
