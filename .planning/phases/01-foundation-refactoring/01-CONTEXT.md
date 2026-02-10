# Phase 1: Foundation Refactoring - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate hardcoded Claude assumptions from the codebase so that all services, commands, and file references are agent-agnostic. After this phase, no code outside of agent classes (ClaudeCodeAgent) should reference Claude-specific names, paths, or concepts. The CodeAgent abstraction becomes the sole interface for agent-specific behavior.

</domain>

<decisions>
## Implementation Decisions

### Renaming strategy
- Class naming convention: Agent-prefixed generic (AgentSessionProvider, AgentSession, etc.)
- Source files renamed to match new class names (ClaudeSessionProvider.ts → AgentSessionProvider.ts)
- Command prefix renamed: claudeWorktrees.* → lanes.* (all 17 commands)
- Extension ID already agent-agnostic ("lanes" in package.json) — no change needed
- Tree view ID renamed: claudeWorktrees → lanes
- User-facing strings (terminal names, status messages) made agent-agnostic now, not deferred

### Abstraction boundary
- extension.ts references only CodeAgent type — never ClaudeCodeAgent directly
- All services receive CodeAgent via dependency injection; no direct instantiation outside a factory point
- Claude's Discretion: Add new abstract methods to CodeAgent when the alternative would be a worse hack (e.g., getSessionFilePath() if needed). Otherwise, only refactor consumers to use existing abstraction.

### Migration approach
- Backward-compatible command aliases for one release: old claudeWorktrees.* IDs forward to new lanes.* IDs, removed in next version
- .claude-session marker file stays as-is for now — code references it through CodeAgent method, but the actual filename doesn't change
- Existing VS Code settings keys kept unchanged (already lanes.* prefixed and agent-agnostic)
- One commit per plan in the roadmap (plan 01-01 gets one commit, plan 01-02 gets one commit)

### File/path conventions
- All agents share the same .worktrees/ base directory — sessions co-located regardless of agent type
- localSettings.ts generalized now to be agent-aware — asks CodeAgent what config files to propagate (ready for Codex's config.toml in Phase 3)
- Standard JSON session metadata schema defined in Phase 1 (agent type, session ID, created date, etc.) — all agents write the same format for consistent discovery
- Claude's Discretion: Whether agent-specific paths are exposed via methods (agent.getSessionMarkerName()) or a config object (agent.paths.sessionMarker) — pick what fits the existing CodeAgent design best

</decisions>

<specifics>
## Specific Ideas

- Command aliases should be simple forwarding — register the old ID and have it call the new command. No deprecation warnings needed in the UI, just remove in next release.
- The standard session metadata schema should include at minimum: agent type identifier, session ID (if available), creation timestamp, and session name.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation-refactoring*
*Context gathered: 2026-02-10*
