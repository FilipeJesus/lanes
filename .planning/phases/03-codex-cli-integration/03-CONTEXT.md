# Phase 3: Codex CLI Integration - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement CodexCodeAgent with correct CLI commands, permission mode mapping, session resume capability, and terminal identification. The stub CodexAgent from Phase 2 becomes a fully functional agent that can start, resume, and manage Codex CLI sessions. No MCP/workflow support, no TOML config file generation, no UI changes (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Permission mode mapping
- Two permission modes only, matching Claude's pattern: a default mode and a bypass mode
- Default mode ("Accept Edits" label): `--sandbox workspace-write --ask-for-approval on-failure`
- Bypass mode ("Bypass Permissions" label): `--sandbox danger-full-access --ask-for-approval never`
- UI labels match Claude's terminology ("Accept Edits" / "Bypass Permissions") for consistency across agents, even though underlying flags differ
- Permission modes are passed as CLI flags, not via config file

### Session resume strategy
- Strict behavior: if session ID capture fails, show error to user — no silent `--last` fallback
- Error message should suggest starting a new session (not manual resume instructions)
- Resume terminal behavior should match whatever Claude Code sessions do (parity between agents)
- Session ID capture method: Claude's discretion (terminal output parsing or codex history command — pick most reliable approach)

### TOML config generation
- No config file generated — all settings passed as inline CLI flags (`--sandbox`, `--ask-for-approval`)
- Only permission flags are passed; user's global `~/.codex/config.toml` handles everything else (model, MCP servers, etc.)
- The SettingsFormatService TOML support from Phase 2 is not used for Codex in this phase — it stays in the codebase but is effectively unused for now
- No local settings propagation for Codex config files in this phase

### Claude's Discretion
- Session ID capture mechanism (terminal output parsing vs codex history command)
- CLI command construction details (flag ordering, shell escaping approach)
- Terminal icon and naming for Codex sessions (blue icon was set in Phase 2 stub)
- How to handle the SettingsService integration given no config file is generated

</decisions>

<specifics>
## Specific Ideas

- User explicitly wanted the external config file approach (like Claude's `--mcp-config`) but Codex doesn't support a `--config-file` flag — only `-c key=value` inline overrides and `-p profile` for named profiles
- The `-c` inline override format is TOML-parsed: `-c sandbox_permissions=["disk-full-read-access"]`
- Codex `resume` command supports `codex resume [SESSION_ID]` or `codex resume --last`

</specifics>

<deferred>
## Deferred Ideas

- Local settings propagation for `~/.codex/config.toml` to worktrees — could be added later
- Model selection per session (passing `-m` flag) — could be a future enhancement
- MCP server configuration for Codex sessions — not needed in this milestone

</deferred>

---

*Phase: 03-codex-cli-integration*
*Context gathered: 2026-02-10*
