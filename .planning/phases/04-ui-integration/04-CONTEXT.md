# Phase 4: UI Integration - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Add agent selection to the session creation webview form and ensure the permission toggle adapts correctly per agent. Terminal differentiation (names, icons, colors) was already implemented in Phases 2-3 and only needs validation here.

</domain>

<decisions>
## Implementation Decisions

### Agent selector design
- Placement: After session name field (second field in form) — session name is primary, agent is a configuration detail
- Element type: Dropdown select — matches the existing workflow dropdown style, compact, consistent with form
- Default value: Always resets to `lanes.defaultAgent` VS Code setting on form clear — no last-used memory
- Labels: Full names — "Claude Code" and "Codex CLI" in the dropdown options

### Permission mode adaptation
- Same toggle for both agents — one toggle button works identically regardless of selected agent
- No extra visual feedback — no tooltips, inline labels, or agent-specific explanations for the permission mode
- Toggle state preserved on agent switch — if bypass was on, it stays on when user changes agent
- Keep 2 modes only — stick with Phase 3 decision (acceptEdits/bypassPermissions), do not expose Codex's read-only mode

### Unavailable agent handling
- Show disabled option: "Codex CLI (not installed)" appears grayed out in dropdown when CLI not found
- Hide dropdown entirely when only one agent is available — less clutter for single-agent users
- CLI availability checked once at extension activation, cached result used for form rendering
- Bad default handling: If `lanes.defaultAgent` points to unavailable CLI, fall back to Claude Code AND show a VS Code warning notification

### Claude's Discretion
- Exact CSS styling of the dropdown and disabled option appearance
- How to pass cached CLI availability from factory to the webview form provider
- Whether to add the agent field to webview state persistence
- Label for the dropdown field (e.g., "Agent", "Code Agent", "CLI Agent")

</decisions>

<specifics>
## Specific Ideas

- Dropdown should match the existing workflow template dropdown in visual style and behavior
- REQ-U3 (terminal differentiation) is largely satisfied by Phase 2/3 work — validate but don't reimplement

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-ui-integration*
*Context gathered: 2026-02-10*
