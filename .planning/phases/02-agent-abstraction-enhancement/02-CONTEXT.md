# Phase 2: Agent Abstraction Enhancement - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Infrastructure to support multiple agents with different capabilities. Includes: agent factory that creates the right CodeAgent subclass from a VS Code setting, persistent per-session agent metadata, session tracking for agents without hook systems, and a format-agnostic settings service (JSON + TOML). This phase does NOT implement specific agents (Phase 3) or UI (Phase 4).

</domain>

<decisions>
## Implementation Decisions

### Factory & registration
- Hardcoded map (`Record<string, () => CodeAgent>`) with 'claude' and 'codex' entries — no registry pattern
- Singleton per agent type — one instance per agent, reused across the extension lifecycle
- Unrecognized `lanes.defaultAgent` values fall back to Claude with a VS Code warning notification
- Factory validates CLI tool availability at creation time (e.g., `which codex`) — returns null or throws if not installed

### Session metadata persistence
- Agent type stored inside the session file as a field (e.g., `"agent": "codex"`)
- Keep `.claude-session` as the file name for ALL sessions regardless of agent — agent type is in the content, not the file name
- Existing session files without an `agent` field are treated as implicitly Claude — no migration, no rewriting
- New sessions always include the `agent` field

### Hookless session tracking
- Lanes writes the session file itself when creating a Codex terminal — no hooks involved
- Status tracked via terminal open/close events only — no live working/idle status for hookless agents
- Attempt to capture Codex's internal session ID by parsing terminal output
- If session ID capture fails, show an error to the user (no silent `--last` fallback)
- Codex resume uses `codex resume <captured-id>` with the captured session ID

### Claude's Discretion
- Whether session tracking lives as abstract methods on CodeAgent or as a separate SessionTracker interface — pick based on complexity for 2 agents
- Internal details of the settings service format abstraction (JSON vs TOML writing)
- How CLI availability check is implemented (child_process `which`, `command -v`, etc.)

</decisions>

<specifics>
## Specific Ideas

- Factory should be simple enough that adding a third agent means adding one line to the map
- Session file keeps `.claude-session` name to avoid churn — this is a pragmatic choice, not a permanent decision
- The `agent` field in session data maps directly to the factory's agent name keys

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-agent-abstraction-enhancement*
*Context gathered: 2026-02-10*
