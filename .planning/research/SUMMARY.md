# Project Research Summary

**Project:** Codex CLI Integration into Lanes VS Code Extension
**Domain:** Multi-Agent IDE Extensions
**Researched:** 2026-02-10
**Confidence:** HIGH

## Executive Summary

Lanes currently manages isolated Claude Code sessions via Git worktrees. Adding OpenAI Codex CLI support requires extending the existing CodeAgent abstraction to handle fundamental architectural differences: TOML-based configuration (vs JSON), different CLI flag patterns for permissions/sandbox modes, and critically, the absence of hook events for session tracking. The recommended approach leverages the existing agent abstraction layer while implementing Codex-specific session discovery via file system monitoring and TOML configuration generation.

The project is well-positioned for success. The codebase already has a robust CodeAgent abstraction with 15+ abstract methods, dependency injection via ServiceContainer, and agent-aware services. The main challenges are: (1) refactoring hardcoded Claude assumptions scattered throughout the codebase, (2) implementing polling-based session tracking as an alternative to Claude's hook system, and (3) handling TOML configuration generation and validation. These are implementation challenges, not architectural blockers.

Key risks center on session state tracking without hook events and UI confusion when managing multiple agent types. Mitigation strategies include filesystem monitoring for Codex session rollout files, agent-specific UI differentiation (icons, labels, colors), and phased rollout starting with foundation refactoring before adding Codex-specific features. The existing multi-agent architecture patterns from VS Code 1.109 and competitor analysis validate this approach.

## Key Findings

### Recommended Stack

Codex CLI uses different technologies than Claude Code, requiring new dependencies and configuration strategies. The core challenge is adapting from Claude's JSON/hook-based approach to Codex's TOML/polling-based architecture while maintaining a unified abstraction layer.

**Core technologies:**
- **@iarna/toml ^2.2.5**: TOML parsing/generation — Codex uses TOML for all configuration (config.toml) instead of JSON
- **chokidar ^3.5.3**: File system monitoring — Watch ~/.codex/sessions/ for rollout files since Codex lacks hook events
- **better-sqlite3 ^9.0.0**: SQLite database access — Query Codex's state.db for session metadata and status information
- **uuid ^9.0.0**: Session ID validation — Validate UUID format for session identifiers (Codex uses UUIDs like Claude)

**Critical architectural differences:**
- **Configuration:** Codex uses TOML (config.toml) in [mcp_servers] sections, not JSON (mcp-config.json)
- **CLI commands:** Different flag syntax (--sandbox workspace-write vs --permission-mode acceptEdits; --ask-for-approval vs --dangerously-skip-permissions)
- **Session management:** Codex stores sessions in ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl files with SQLite tracking, not extension-managed .claude-session files
- **Hooks:** Codex has NO hook system (no SessionStart, Stop, UserPromptSubmit events) — requires filesystem monitoring for state tracking

### Expected Features

The multi-agent IDE landscape in 2026 has established clear expectations. VS Code 1.109 introduced native multi-agent support with unified session views. Users expect seamless agent selection and management without compromising per-agent capabilities.

**Must have (table stakes):**
- Agent selection during session creation — Core requirement; users must choose which agent runs each session
- Per-session agent persistence — Chosen agent remembered across VS Code restarts
- Agent-specific terminal identification — Terminal name shows agent type (e.g., "Codex: feat-X")
- Full session lifecycle per agent — Create, open, resume, delete work identically regardless of agent
- Agent-specific CLI command building — Each agent has different syntax (buildStartCommand, buildResumeCommand)
- Session ID capture and tracking — Enable seamless resume functionality (different implementation per agent)
- Permission mode selection — Security-conscious users expect control (map to agent-specific flags)

**Should have (competitive):**
- Visual agent differentiation in sidebar — Icons, colors, or badges for faster visual scanning
- Agent availability detection — Check CLI availability, disable/warn if agent not installed
- Per-agent status tracking — Session status (working, idle, waiting) despite different implementations
- Agent-specific settings propagation — Propagate .codex/config.toml like .claude/settings.json
- Unified session history — Searchable history across all agents

**Defer (v2+):**
- Agent performance metrics — Session duration, token usage, cost tracking (complex, privacy concerns)
- Agent-specific keyboard shortcuts — Fast session creation (keybinding conflicts, discoverability issues)
- Advanced status tracking — Real-time updates, progress indicators (battery/CPU concerns)

**Anti-features (deliberately NOT building):**
- Auto-switch agent mid-session — Session state incompatible across agents, users lose context
- Unified agent API wrapper — Forces lowest-common-denominator, loses agent-specific strengths
- Agent auto-selection based on task — Requires brittle task classification, users lose control
- Real-time agent switching UI — Terminal must restart, session state lost, confusing UX

### Architecture Approach

The existing CodeAgent abstraction provides a solid foundation. Extension activation creates a single agent instance via factory pattern, passes it through ServiceContainer to all services. Each agent implements 15+ abstract methods (getSessionFileName, buildStartCommand, generateHooksConfig, etc.) that encapsulate agent-specific behavior.

**Major components:**
1. **CodeAgent abstraction** — Base class defining contract for all agents (existing, well-designed)
2. **Agent factory** — Creates appropriate CodeAgent based on VS Code setting (NEW, enables user choice)
3. **CodexCodeAgent implementation** — Codex-specific behavior extending CodeAgent (NEW, core deliverable)
4. **SessionFormProvider** — Add agent selector dropdown to webview (UPDATE, minimal UI change)
5. **Settings service** — Handle both JSON and TOML generation/validation (UPDATE, add TOML support)
6. **Session tracking** — Hybrid: hook-based for Claude, polling-based for Codex (NEW abstraction)

**Architectural patterns:**
- **Abstract Factory** — CodeAgent with agent-specific implementations (already proven)
- **Singleton per Extension** — Single agent instance from VS Code setting (current approach, works for v1)
- **Dependency Injection** — ServiceContainer passes agent to all services (already implemented)

**Integration changes required:**
- extension.ts: Replace hardcoded `new ClaudeCodeAgent()` with factory call (HIGH impact, medium complexity)
- SessionFormProvider: Add agent dropdown to webview HTML (HIGH impact, medium complexity)
- SettingsService: Generate TOML for Codex, JSON for Claude (MINOR impact, low complexity)
- TerminalService: Remove hardcoded fallback logic (MINOR cleanup, low complexity)

### Critical Pitfalls

Research identified 8 critical pitfalls from multi-agent IDE development patterns and Codex-specific integration challenges. Top 5 impact roadmap structure:

1. **Hardcoded agent assumptions throughout codebase** — Despite CodeAgent abstraction, 100+ "claude" string literals exist outside agent classes. File paths (.claude-session), watch patterns, function names (getClaudeSessionPath), UI labels all hardcode Claude. **Prevention:** Phase 1 must audit and refactor ALL hardcoded references before adding Codex. Use agent.getSessionFileName() instead of ".claude-session" literals. Add ESLint rule to prevent regression.

2. **Session state tracking without hook events** — Codex has NO SessionStart/Stop/UserPromptSubmit hooks. Cannot capture session IDs, write status files, or trigger workflows reactively. Creates "ghost sessions" where terminal runs but extension doesn't track it. **Prevention:** Implement polling-based session tracker as alternative to hook-based tracker. Watch ~/.codex/sessions/**/*.jsonl for new files, parse for session IDs. Abstract tracking interface with two implementations.

3. **Configuration format conflicts (TOML vs JSON)** — Codex uses TOML (config.toml), Claude uses JSON (settings.json). Settings service hardcoded to read/write JSON only. No TOML parser. **Prevention:** Add @iarna/toml dependency, implement format-agnostic settings service with read/write/merge for both formats. Agent provides getSettingsFormat() and buildSettings().

4. **Permission mode flag syntax divergence** — Claude uses --permission-mode acceptEdits, --dangerously-skip-permissions. Codex uses --sandbox workspace-write, --ask-for-approval on-request, --full-auto, --yolo. Different permission models (binary vs two-dimensional). **Prevention:** Rich permission config abstraction that translates high-level intent (autoApprove, restrictWrites) to agent-specific flags. Agent-specific permission UI, not shared dropdown.

5. **UI confusion - agent type not visible** — Single-agent UI has no agent indicators. All sessions look identical. Users can't tell Claude from Codex sessions, create wrong agent thinking it's right one. **Prevention:** Visual differentiation (icons, colors, labels). Terminal titles show agent type. Session tree items show agent badge. Agent dropdown in session form.

**Additional critical pitfall:**
6. **Session ID storage location mismatch** — Claude stores IDs in extension-controlled files (.claude-session), Codex stores in ~/.codex/sessions/**/*.jsonl and SQLite database. Extension can't find Codex session IDs. **Prevention:** Agent-specific session discovery (discoverSessions(), readSessionMetadata()). Filesystem watching per agent. Reconciliation between extension records and agent storage.

## Implications for Roadmap

Based on research, suggested phase structure follows dependency chain: refactor hardcoded assumptions, enhance agent abstraction, implement Codex-specific features, polish UX.

### Phase 1: Foundation Refactoring
**Rationale:** Cannot add second agent until codebase is agent-agnostic. Hardcoded Claude assumptions must be eliminated first (Pitfall #1). Research shows 100+ hardcoded references that will break Codex integration.

**Delivers:**
- All string literals replaced with agent method calls
- Services renamed to be agent-agnostic (ClaudeSessionProvider → SessionProvider)
- Watch patterns accept agent parameter
- ESLint rule to prevent new hardcoded references
- Clean abstraction boundary validated

**Addresses (from FEATURES.md):**
- Foundation for agent-specific CLI command building
- Prerequisite for per-session agent persistence

**Avoids (from PITFALLS.md):**
- Pitfall #1: Hardcoded agent assumptions
- Technical debt pattern: Conditional logic in services

**Complexity:** Medium (search/replace across codebase, refactor method signatures)

### Phase 2: Agent Abstraction Enhancement
**Rationale:** Codex lacks hooks (Pitfall #2) and uses different config format (Pitfall #3). Must abstract session tracking and settings management BEFORE implementing Codex to avoid building Codex-specific workarounds into general codebase.

**Delivers:**
- Session tracking interface with two implementations (HookBasedTracker, PollingBasedTracker)
- Format-agnostic settings service (JSON + TOML support)
- Agent factory function with VS Code setting
- Agent-specific session discovery abstraction (discoverSessions(), readSessionMetadata())
- TOML parser dependency (@iarna/toml)

**Uses (from STACK.md):**
- @iarna/toml for config generation
- chokidar for filesystem watching
- better-sqlite3 for Codex database queries

**Implements (from ARCHITECTURE.md):**
- Pattern 3: Agent Factory
- Hybrid tracking strategy
- Format-aware settings service

**Addresses (from FEATURES.md):**
- Session ID capture and tracking (prerequisite)
- Agent-specific settings propagation (foundation)

**Avoids (from PITFALLS.md):**
- Pitfall #2: Session tracking without hooks
- Pitfall #3: Configuration format conflicts
- Pitfall #5: Session ID storage mismatch

**Complexity:** High (new abstraction layer, filesystem watching, async polling)

### Phase 3: Codex CLI Integration
**Rationale:** With clean abstraction and enhanced infrastructure, implement Codex-specific agent. This phase builds on Phase 1/2 foundation to avoid common pitfalls.

**Delivers:**
- CodexCodeAgent class implementing all CodeAgent abstract methods
- Codex CLI command building (buildStartCommand, buildResumeCommand with --sandbox, --ask-for-approval flags)
- Codex permission mode mapping (Pitfall #4 prevention)
- Codex MCP configuration (TOML format in [mcp_servers] section)
- Session ID extraction from rollout files
- PollingBasedTracker implementation for Codex

**Uses (from STACK.md):**
- All Phase 2 dependencies
- Codex CLI command reference (--sandbox, --ask-for-approval, codex resume)
- Codex config.toml structure ([mcp_servers], approval_policy)

**Implements (from ARCHITECTURE.md):**
- Build order Phase 1: CodexCodeAgent implementation
- Command building flow for Codex
- Settings file creation (TOML generation)

**Addresses (from FEATURES.md):**
- Agent-specific CLI command building
- Permission mode selection (mapping to Codex flags)
- Full session lifecycle per agent

**Avoids (from PITFALLS.md):**
- Pitfall #4: Permission flag divergence
- Pitfall #8: MCP configuration divergence
- Integration gotchas (assume hooks exist, write JSON to .toml)

**Complexity:** Medium (well-defined interface, implementation straightforward given Phase 1/2 foundation)

### Phase 4: UI Integration
**Rationale:** Core functionality working, now add UI for agent selection and differentiation (Pitfall #7 prevention). Keeps UI changes separate from backend to reduce coupling.

**Delivers:**
- Agent selector dropdown in SessionFormProvider
- Agent icons/colors in session tree view
- Terminal titles showing agent type
- Agent badge on session items
- Global default agent setting UI

**Addresses (from FEATURES.md):**
- Agent selection during session creation
- Agent-specific terminal identification
- Visual agent differentiation in sidebar
- Global default agent setting

**Avoids (from PITFALLS.md):**
- Pitfall #7: UI confusion (no agent type visible)
- UX pitfalls (same icon for all agents, no agent selector in form)

**Complexity:** Low-Medium (HTML/CSS changes, VS Code UI APIs well-documented)

### Phase 5: Testing & Validation
**Rationale:** Multi-agent system requires comprehensive testing with BOTH agents, not just Claude. Validate assumptions from research.

**Delivers:**
- CodexCodeAgent unit tests (all abstract methods)
- Integration tests with real Codex CLI
- Permission mode validation tests
- TOML config generation validation
- Session discovery tests (rollout file parsing)
- Cross-agent test suite

**Addresses (from gaps):**
- Validate Codex session ID format (assumed UUID, needs verification)
- Test polling performance and debouncing
- Verify TOML config syntax with Codex CLI
- Confirm permission flag behavior

**Avoids (from PITFALLS.md):**
- "Looks done but isn't" checklist failures
- Performance traps (polling too frequently, parsing large files)

**Complexity:** Medium (requires Codex CLI installed, real sessions, filesystem watching)

### Phase Ordering Rationale

- **Phase 1 before Phase 2:** Cannot enhance abstractions until codebase is agent-agnostic. Hardcoded assumptions will leak into new abstractions.
- **Phase 2 before Phase 3:** Codex implementation needs session tracking and settings abstractions. Building Codex-specific workarounds into general codebase creates technical debt.
- **Phase 3 before Phase 4:** Backend functionality must work before adding UI. UI changes are visible to users; backend bugs are showstoppers.
- **Phase 5 throughout:** Testing validates assumptions at each phase. Defer comprehensive multi-agent testing until Phase 5.

**Critical path:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 (sequential dependencies)

**Opportunities for parallelization:**
- Phase 2: Session tracking and settings abstraction can be developed in parallel (separate concerns)
- Phase 4: UI components (form, tree view, terminal) can be developed in parallel after Phase 3

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 2 (Session Tracking):** Filesystem watching patterns, debounce intervals, SQLite schema — niche domain, needs experimentation
- **Phase 2 (Settings Service):** TOML merging semantics, schema validation — library-specific behavior needs testing
- **Phase 5 (Testing):** Codex CLI mocking strategies, integration test environment setup — tooling unclear

**Phases with standard patterns (skip research-phase):**
- **Phase 1 (Refactoring):** Search/replace, ESLint rules — well-documented patterns
- **Phase 3 (Codex Implementation):** CodeAgent interface well-defined, implementation straightforward — existing ClaudeCodeAgent serves as template
- **Phase 4 (UI):** VS Code webview APIs, tree view customization — official documentation comprehensive

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Official Codex docs available and detailed. TOML library choice validated. Uncertainty around best-sqlite3 schema (undocumented) and polling performance at scale. |
| Features | HIGH | VS Code 1.109 multi-agent support, Cursor/Windsurf analysis, competitor feature matrix all confirm table stakes. MVP definition clear and validated against market. |
| Architecture | HIGH | Existing CodeAgent abstraction is well-designed. Integration points clearly documented in codebase analysis. Build order validated against dependency graph. |
| Pitfalls | HIGH | Multi-agent IDE patterns from VS Code team, community experience reports, Codex-specific gotchas from official docs. All 8 pitfalls have documented prevention strategies. |

**Overall confidence:** HIGH

Research based on official documentation (Codex CLI, VS Code APIs), real-world multi-agent IDE implementations (VS Code 1.109, Cursor, Windsurf), and codebase analysis (existing CodeAgent abstraction proven). Main uncertainties are implementation details (polling intervals, TOML merging) that require experimentation, not architectural concerns.

### Gaps to Address

**During Phase 2 planning:**
- **Polling frequency:** Codex session status updates — needs experimentation to balance responsiveness vs CPU usage. Start with 2-second interval, add adaptive polling based on activity.
- **SQLite schema:** Codex state.db structure undocumented — reverse engineer via database inspection. Focus on sessions and rollouts tables.
- **TOML merging:** User config + project config precedence — test with @iarna/toml to understand merge semantics vs JSON.

**During Phase 3 implementation:**
- **Session ID format validation:** Research assumes UUID but Codex docs don't specify — verify with actual Codex sessions, adjust validation if needed.
- **Permission flag combinations:** Which flags are mutually exclusive? — test --sandbox + --ask-for-approval combinations, document valid/invalid pairs.
- **MCP server startup:** TOML array syntax for args — validate generated TOML loads correctly in Codex CLI.

**During Phase 5 validation:**
- **Codex CLI availability:** How to detect Codex installed? — test `which codex`, parse version output, handle missing CLI gracefully.
- **Rollout file format stability:** JSONL structure versioning — monitor for format changes across Codex versions, add version detection.

**User preference validation:**
- **Visual differentiation opt-in:** User stated "no sidebar visual differentiation" — confirm this applies to agent type indicators or just other UI elements. Add `lanes.showAgentIndicators` setting (default: false) for opt-in.

**Performance validation:**
- **Filesystem watching scale:** Does chokidar handle ~/.codex/sessions/**/*.jsonl efficiently with 100+ sessions? — benchmark with large session directories, add date-based filtering if needed.

## Sources

### Primary (HIGH confidence)
- [Codex CLI Official Documentation](https://developers.openai.com/codex/cli/) — Command reference, configuration, features
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/) — TOML structure, MCP configuration, approval policies
- [Codex Security Documentation](https://developers.openai.com/codex/security/) — Sandbox modes, approval policies, permission model
- [VS Code Multi-Agent Development](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) — Official multi-agent platform announcement
- [VS Code January 2026 Release (v1.109)](https://code.visualstudio.com/updates/v1_109) — Agent sessions view, worktree support, partner agents
- [VS Code Using Agents Documentation](https://code.visualstudio.com/docs/copilot/agents/overview) — Agent types, session management, background agents
- Lanes codebase analysis — CodeAgent abstraction (15+ abstract methods), ServiceContainer, extension.ts activation

### Secondary (MEDIUM confidence)
- [Codex vs Claude Code 2026 Benchmark (SmartScope)](https://smartscope.blog/en/generative-ai/chatgpt/codex-vs-claude-code-2026-benchmark/) — Feature comparison, CLI differences, use cases
- [Builder.io Codex vs Claude Code](https://www.builder.io/blog/codex-vs-claude-code) — Permission models, configuration approaches
- [Codex MCP Configuration TOML Guide](https://vladimirsiedykh.com/blog/codex-mcp-config-toml-shared-configuration-cli-vscode-setup-2025) — Real-world TOML examples
- [How Codex CLI Flags Work](https://www.vincentschmalbach.com/how-codex-cli-flags-actually-work-full-auto-sandbox-and-bypass/) — Flag behavior analysis, permission combinations
- [Building Multi-Agent IDE Systems](https://medium.com/@prashanthkgajula/building-an-agentic-ide-how-i-built-a-multi-agent-code-generation-system-with-langgraph-and-467f08f6bf64) — Architecture patterns, pitfalls
- [Windsurf vs Cursor Comparison](https://www.builder.io/blog/windsurf-vs-cursor) — Session management, agent paradigms, UX patterns

### Tertiary (LOW confidence - needs validation)
- [Codex Session ID Exposure Feature Request](https://github.com/openai/codex/issues/8923) — Confirms no environment variable for session ID (as of request date)
- [Agent Sessions Multi-CLI Browser](https://github.com/jazzyalex/agent-sessions) — Community tool for cross-agent session management (validates multi-agent patterns)
- [Git Worktrees for Multi-Agent Development](https://stevekinney.com/courses/ai-development/git-worktrees) — Worktree isolation patterns (general advice, not Lanes-specific)

---
*Research completed: 2026-02-10*
*Ready for roadmap: yes*
