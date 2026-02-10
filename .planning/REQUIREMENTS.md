# Requirements: Codex CLI Support

## Scope

Add OpenAI Codex CLI as a second supported agent in Lanes, enabling users to create, open, resume, and delete Codex-powered sessions through the same sidebar workflow used for Claude Code.

## Requirements

### Foundation (Refactoring)

| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|---------------------|
| REQ-F1 | Eliminate hardcoded Claude assumptions | Critical | No "claude" string literals outside agent classes (except imports). All file names, watch patterns, and paths use agent method calls. |
| REQ-F2 | Agent-agnostic service naming | High | Services use generic names (SessionProvider, not ClaudeSessionProvider). No agent-specific naming in shared code. |
| REQ-F3 | Clean abstraction boundary | High | All services receive CodeAgent via dependency injection. No direct instantiation of agent classes outside factory. |

### Agent Abstraction

| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|---------------------|
| REQ-A1 | Agent factory with VS Code setting | Critical | `lanes.defaultAgent` setting selects agent. Factory creates correct CodeAgent subclass. Setting has "claude" and "codex" options. |
| REQ-A2 | Per-session agent selection | Critical | Session creation form includes agent dropdown. Selected agent stored in session metadata. Agent persisted across restarts. |
| REQ-A3 | Agent-specific session tracking | High | Abstract tracking interface. Hook-based tracker for Claude (existing). Alternative tracker for agents without hooks. |
| REQ-A4 | Format-agnostic settings service | Medium | Settings service reads/writes both JSON and TOML. Agent specifies format via method. No hardcoded JSON assumption. |

### Codex Integration

| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|---------------------|
| REQ-C1 | CodexCodeAgent implementation | Critical | Extends CodeAgent. Implements all abstract methods. CLI command: `codex`. Config: `.codex/config.toml`. |
| REQ-C2 | Codex start command building | Critical | Generates `codex [--sandbox <mode>] [--ask-for-approval <mode>] ['<prompt>']`. Proper shell escaping. |
| REQ-C3 | Codex resume command building | Critical | Generates `codex resume <ID>` or `codex resume --last`. Handles missing session ID gracefully. |
| REQ-C4 | Codex permission mode mapping | High | Maps UI permission choices to `--sandbox` + `--ask-for-approval` flag combinations. At least 3 modes: read-only, workspace-write, full-access. |
| REQ-C5 | Codex session tracking | High | Captures Codex session ID without hooks. Enables resume functionality. Fallback to `codex resume --last` if ID unavailable. |
| REQ-C6 | Codex terminal identification | Medium | Terminal name: "Codex: <session-name>". Distinct icon from Claude terminals. |

### UI Integration

| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|---------------------|
| REQ-U1 | Agent selector in session form | Critical | Dropdown in session creation form. Defaults to `lanes.defaultAgent` setting. Persists choice in session metadata. |
| REQ-U2 | Agent-specific permission UI | High | Form shows permission options appropriate for selected agent. Claude: acceptEdits/bypassPermissions. Codex: read-only/workspace-write/full-access. |
| REQ-U3 | Terminal differentiation | Medium | Terminal titles include agent name. Agent-specific icons via `getTerminalIcon()`. |

### Testing

| ID | Requirement | Priority | Acceptance Criteria |
|----|------------|----------|---------------------|
| REQ-T1 | CodexCodeAgent unit tests | Critical | All abstract method implementations tested. Command building verified. Permission mapping validated. |
| REQ-T2 | Agent factory tests | High | Factory creates correct agent from setting. Invalid agent names handled. Default fallback works. |
| REQ-T3 | Session form agent selection tests | High | Agent dropdown renders. Selection persists. Permission options update per agent. |
| REQ-T4 | Backward compatibility tests | Critical | All existing Claude Code tests pass unchanged. No regression in Claude session lifecycle. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-F1 | Phase 1 | Pending |
| REQ-F2 | Phase 1 | Pending |
| REQ-F3 | Phase 1 | Pending |
| REQ-A1 | Phase 2 | Pending |
| REQ-A2 | Phase 2 | Pending |
| REQ-A3 | Phase 2 | Pending |
| REQ-A4 | Phase 2 | Pending |
| REQ-C1 | Phase 3 | Pending |
| REQ-C2 | Phase 3 | Pending |
| REQ-C3 | Phase 3 | Pending |
| REQ-C4 | Phase 3 | Pending |
| REQ-C5 | Phase 3 | Pending |
| REQ-C6 | Phase 3 | Pending |
| REQ-U1 | Phase 4 | Pending |
| REQ-U2 | Phase 4 | Pending |
| REQ-U3 | Phase 4 | Pending |
| REQ-T1 | Phase 5 | Pending |
| REQ-T2 | Phase 5 | Pending |
| REQ-T3 | Phase 5 | Pending |
| REQ-T4 | Phase 5 | Pending |

**Coverage:** 20/20 requirements mapped (100%)

## Out of Scope

| Item | Rationale |
|------|-----------|
| Workflow/MCP support for Codex | Different config mechanism (TOML-based [mcp_servers]), defer to future milestone |
| Codex Cloud integration | Only CLI support needed |
| Cross-agent session migration | Unnecessary complexity, different internal formats |
| Codex authentication management | Codex handles auth via `codex login` |
| Real-time Codex status polling | Start with basic session tracking; advanced status monitoring deferred |
| Sidebar visual differentiation (badges/colors) | User preference: keep UI clean, differentiate via terminal only |
| TOML parser dependency | Prefer simple string generation for config.toml content |

## Dependencies

| Dependency | Type | Notes |
|------------|------|-------|
| Codex CLI (`@openai/codex`) | Runtime (user) | Must be installed by user. Extension should detect availability. |
| VS Code Extension API | Build | Already used. No version upgrade needed. |
| Existing CodeAgent abstraction | Internal | Well-designed, serves as foundation. Minor enhancements needed. |

## Constraints

- All existing Claude Code functionality must continue working unchanged
- Pre-commit hooks enforce compile + lint + test passing
- Minimal new dependencies (avoid TOML parser if string generation suffices)
- Follow existing TypeScript patterns and conventions
- Agent selection must be lightweight (dropdown, not complex wizard)

---
*Created: 2026-02-10 from research synthesis*
*Traceability updated: 2026-02-10 after roadmap creation*
