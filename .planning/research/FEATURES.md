# Feature Landscape: Multi-Agent IDE Extensions

**Domain:** VS Code extensions supporting multiple CLI-based code agents
**Researched:** 2026-02-10
**Confidence:** HIGH

## Research Context

Researched features for adding Codex CLI support to Lanes, a VS Code extension currently managing Claude Code sessions via Git worktrees. Focus: what's table stakes vs differentiating when supporting multiple CLI code agents in one extension.

## Table Stakes Features

Features users expect when managing multiple code agents. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Agent selection during session creation** | Core requirement -- users must choose which agent runs in each session | LOW | Dropdown in session form; stored in session metadata |
| **Global default agent setting** | Convenience -- most users prefer one agent 90% of the time | LOW | VS Code setting (e.g., `lanes.defaultAgent: "claude"`) |
| **Per-session agent persistence** | Users expect chosen agent remembered across VS Code restarts | LOW | Store in session tracking file (already exists) |
| **Agent-specific terminal identification** | Users need to know which agent they're interacting with at a glance | LOW | Terminal name prefix (e.g., "Claude: feat-X" vs "Codex: feat-Y") |
| **Full session lifecycle per agent** | Create, open, resume, delete must work identically regardless of agent | MEDIUM | Already abstracted via CodeAgent base class |
| **Agent-specific CLI command building** | Each agent has different CLI syntax for start/resume/permissions | MEDIUM | Abstract methods in CodeAgent; implement per agent |
| **Session ID capture and tracking** | Users expect seamless resume; extension must track session IDs | MEDIUM-HIGH | Claude uses hooks; Codex needs alternative (file watching, process monitoring) |
| **Isolated worktree per session** | Core Lanes value prop -- each session isolated via Git worktrees | LOW | Already implemented; agent-agnostic |
| **Permission mode selection** | Security-conscious users expect control over agent permissions | MEDIUM | Agent-specific mappings (Claude: acceptEdits, Codex: workspace-write) |
| **Session list showing all agents** | Users expect unified view of all sessions regardless of agent | LOW | Already exists; add agent indicator |

## Differentiators (Competitive Advantage)

Features that set Lanes apart from other multi-agent tools. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Visual agent differentiation in sidebar** | Faster visual scanning; instant agent identification | LOW | Icon badges, color coding, or agent name display |
| **Per-agent status tracking** | Users want session status (working, idle, waiting) per agent type | HIGH | Claude has hooks; Codex needs custom implementation; consider unified status API |
| **Agent-specific settings propagation** | Power users have per-agent config (e.g., `.claude/settings.json`, `.codex/config.toml`) | MEDIUM | Already implemented for Claude; extend for Codex TOML format |
| **Cross-agent session comparison** | Advanced users may want to run same task with both agents to compare | LOW-MEDIUM | "Duplicate session with different agent" command |
| **Agent availability detection** | Smart UX -- disable/warn if agent CLI not installed | LOW | Check CLI availability on activation; gray out unavailable agents |
| **Per-agent workflow support** | Claude has MCP/workflows; Codex may not -- support both paradigms | HIGH | Already implemented for Claude; Codex workflows deferred (out of scope) |
| **Unified session history** | Power users want searchable history across all agents | MEDIUM | Track session metadata (agent, timestamp, prompt, outcome) |
| **Agent-specific keyboard shortcuts** | Fast session creation: Cmd+Shift+C for Claude, Cmd+Shift+X for Codex | LOW | VS Code keybindings; opt-in via settings |
| **Agent performance metrics** | Developers want data: session duration, token usage, cost tracking | HIGH | Requires per-agent instrumentation; aspirational |

## Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. Deliberately NOT building these.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Auto-switch agent mid-session** | "Let me switch from Claude to Codex without restarting" | Session state incompatible across agents; complex error handling; users lose context | Create new session with different agent; duplicate session with agent switch |
| **Unified agent API wrapper** | "Abstract away all agent differences" | Forces lowest-common-denominator; loses agent-specific strengths (e.g., Claude hooks, Codex approvals) | Embrace agent differences; expose unique capabilities |
| **Agent auto-selection based on task** | "Automatically pick best agent for the job" | Requires task classification (brittle); users lose control; incorrect choices frustrate | Let users choose; offer recommendation tooltips in UI |
| **Cross-agent session merging** | "Merge work from Claude and Codex sessions" | Git conflicts guaranteed; no shared session context; undo becomes impossible | Use separate branches; manual merge via Git |
| **Real-time agent switching UI** | "Toggle agent dropdown in existing session" | Terminal process must restart; session state lost; confusing UX | Clear UX: one agent per session; create new session to switch |
| **Sidebar grouping by agent type** | "Show all Claude sessions together, all Codex together" | Breaks chronological ordering; users lose workflow context; increases cognitive load | Show chronological list with agent indicator; filter/search if needed |

## Feature Dependencies

```
Agent selection (global default)
    └──requires──> Per-session agent persistence
                       └──requires──> Agent-specific CLI command building
                                          └──requires──> Agent-specific session tracking

Agent-specific terminal identification
    └──enhances──> Visual agent differentiation

Permission mode selection
    └──requires──> Agent-specific CLI command building

Agent-specific status tracking
    └──requires──> Session ID capture
    └──conflicts──> Unified status API (Codex has no hooks; implementation diverges)

Agent-specific settings propagation
    └──requires──> Worktree isolation

Cross-agent session comparison
    └──requires──> Agent-specific CLI command building
    └──requires──> Worktree isolation
```

### Dependency Notes

- **Agent selection requires persistence**: Users expect their choice remembered; session metadata must store agent name
- **Terminal identification enhances differentiation**: Terminal name is minimum; visual sidebar differentiation is extra polish
- **Permission modes require CLI building**: Permission flags vary per agent (Claude: `--permission-mode`, Codex: `--sandbox`)
- **Status tracking conflicts with unified API**: Claude uses hooks (synchronous, reliable); Codex needs polling/watching (asynchronous, complex)
- **Settings propagation requires isolation**: Each worktree gets agent-specific config (`.claude/settings.json` or `.codex/config.toml`)

## MVP Definition (v1 Launch Requirements)

### Launch With (v1.0)

Minimum viable multi-agent support -- what's needed to ship Codex alongside Claude.

- [x] **CodeAgent abstraction layer** -- Base class with abstract methods (already exists)
- [x] **ClaudeCodeAgent implementation** -- Current implementation (already exists)
- [x] **CodexCodeAgent implementation** -- New agent implementation extending CodeAgent
- [x] **Agent selection in session form** -- Dropdown with agent choices
- [x] **Global default agent setting** -- VS Code setting: `lanes.defaultAgent`
- [x] **Per-session agent persistence** -- Store agent name in session metadata
- [x] **Agent-specific terminal naming** -- Terminal prefix shows agent (e.g., "Claude: session-X")
- [x] **Agent-specific CLI commands** -- Start/resume commands built per agent
- [x] **Permission mode mapping** -- Map UI choices to agent-specific flags
- [x] **Session ID capture for Codex** -- Alternative to Claude's hook-based approach
- [x] **Basic session lifecycle** -- Create, open, resume, delete for both agents
- [x] **Tests for CodexCodeAgent** -- Unit tests for new agent implementation

### Add After Validation (v1.x)

Features to add once core multi-agent support is working.

- [ ] **Visual agent differentiation** -- Icon badges or color coding in sidebar (trigger: user feedback requesting easier identification)
- [ ] **Agent availability detection** -- Check CLI availability, warn if missing (trigger: user support requests about "agent not working")
- [ ] **Agent-specific status tracking** -- Unified status display despite different implementations (trigger: users want session status for Codex like Claude)
- [ ] **Cross-agent session comparison** -- Duplicate session with different agent (trigger: power users request feature for benchmarking)
- [ ] **Unified session history** -- Searchable history with agent filter (trigger: users manage 10+ sessions across agents)
- [ ] **Settings propagation for Codex** -- Propagate `.codex/config.toml` like `.claude/settings.json` (trigger: Codex power users need per-session config)

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Agent performance metrics** -- Session duration, token usage, cost tracking (why defer: requires instrumentation, privacy concerns, complexity)
- [ ] **Agent-specific keyboard shortcuts** -- Fast session creation per agent (why defer: keybinding conflicts, discoverability issues)
- [ ] **Workflow support for Codex** -- MCP/workflow parity with Claude (why defer: Codex MCP uses TOML config; different paradigm; significant complexity)
- [ ] **Advanced status tracking** -- Real-time status updates, progress indicators (why defer: requires persistent background processes; battery/CPU concerns)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|------------|---------------------|----------|-----------|
| Agent selection in form | HIGH | LOW | P1 | Must-have; core requirement |
| Global default agent | HIGH | LOW | P1 | Convenience; expected by 90% of users |
| Per-session persistence | HIGH | LOW | P1 | Sessions useless without agent memory |
| Agent-specific CLI building | HIGH | MEDIUM | P1 | Core abstraction; enables all other features |
| Terminal identification | HIGH | LOW | P1 | Users need to know which agent they're using |
| Session ID capture | HIGH | MEDIUM-HIGH | P1 | Resume broken without this |
| Full session lifecycle | HIGH | MEDIUM | P1 | Create/resume/delete must work |
| Permission mode selection | MEDIUM | MEDIUM | P1 | Security-conscious users expect this |
| Visual differentiation | MEDIUM | LOW | P2 | Nice polish; not blocking |
| Agent availability check | MEDIUM | LOW | P2 | Good UX; prevents confusing errors |
| Status tracking per agent | MEDIUM | HIGH | P2 | Complex due to hook/no-hook split |
| Settings propagation | MEDIUM | MEDIUM | P2 | Power users want this; TOML adds complexity |
| Cross-agent comparison | LOW | MEDIUM | P3 | Niche power user feature |
| Session history | LOW | MEDIUM | P3 | Nice to have; workarounds exist (file search) |
| Agent shortcuts | LOW | LOW | P3 | Keybinding conflicts risky |
| Performance metrics | LOW | HIGH | P3 | Aspirational; privacy concerns |

**Priority key:**
- **P1**: Must have for launch -- core multi-agent functionality
- **P2**: Should have -- add when feasible after validation
- **P3**: Nice to have -- future consideration after PMF

## Competitor Feature Analysis

Analysis of how leading multi-agent coding tools handle agent selection and management (2026 landscape).

| Feature | VS Code (v1.109) | Cursor IDE | Windsurf IDE | Lanes (proposed) |
|---------|------------------|------------|--------------|------------------|
| **Multiple agents** | Local, background, cloud agents; partner agents (Claude, Codex) | Agent mode + Composer; subagents | Cascade agent; Flows | Claude Code + Codex CLI (v1); extensible for more |
| **Agent selection** | Picker UI for partner agents; model dropdown | Global model selection + mode-based | Per-Flow model selection | Per-session dropdown + global default |
| **Session isolation** | Background agents use Git worktrees | No worktree isolation | No worktree isolation | Git worktrees per session (core value prop) |
| **Session management** | Agent Sessions view (unified, compact/side-by-side modes) | No explicit session management | Cascade maintains context across projects (Flow) | Active Sessions + Previous Sessions views |
| **Status tracking** | Agent status indicator; shows sessions needing attention | No unified status | Real-time updates | Claude: hooks; Codex: alternative tracking |
| **Terminal integration** | Background agents run in terminals | Agent mode runs in chat panel | Cascade runs in chat panel | Dedicated terminal per session |
| **Permission controls** | Per-agent permission dialogs | Permission prompts per action | Approval before save to disk | Per-session permission mode selection |
| **Configuration** | Workspace-level AGENTS.md; user profile | Global settings + project config | Cascade memory (persistent) | Per-worktree agent config + global storage |

### Key Insights from Competitor Analysis

1. **VS Code native support (2026)**: Microsoft embraced multi-agent development as first-class in v1.109 (January 2026). VS Code now has unified Agent Sessions view, worktree support for background agents, and partner agent integration. **Implication**: Users expect multi-agent session management; Lanes is well-positioned with existing worktree architecture.

2. **Cursor's model-first approach**: Cursor emphasizes model selection over agent selection; users pick models per task. Subagents run in parallel with custom models. **Implication**: Consider exposing model selection within agents (future enhancement).

3. **Windsurf's memory persistence**: Windsurf's Cascade maintains context across sessions via persistent memory. **Implication**: Lanes' worktree isolation is orthogonal -- file-based context vs in-memory; both valid.

4. **Unified session views are standard**: All tools provide centralized session/agent management UI. **Implication**: Lanes' Active Sessions view is on par; ensure agent indicator visible.

5. **Permission models diverge**: Every tool handles permissions differently (prompts, modes, approval gates). **Implication**: Lanes' per-session permission mode is differentiated; expose agent-specific options without over-abstracting.

## Research Sources

### Primary Sources (HIGH confidence)

- [VS Code January 2026 Release (v1.109)](https://code.visualstudio.com/updates/v1_109) -- Multi-agent development platform
- [VS Code Multi-Agent Development Blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development) -- Official announcement, features
- [VS Code Using Agents Documentation](https://code.visualstudio.com/docs/copilot/agents/overview) -- Agent types, session management
- [VS Code Background Agents Documentation](https://code.visualstudio.com/docs/copilot/agents/background-agents) -- Worktree isolation, lifecycle
- [Codex vs Claude Code Comparison (Builder.io)](https://www.builder.io/blog/codex-vs-claude-code) -- Feature comparison, CLI differences
- [Codex vs Claude Code 2026 Benchmark (SmartScope)](https://smartscope.blog/en/generative-ai/chatgpt/codex-vs-claude-code-2026-benchmark/) -- Performance, cost, use cases
- [Cursor Features](https://cursor.com/features) -- Official features page
- [Windsurf vs Cursor Comparison (Builder.io)](https://www.builder.io/blog/windsurf-vs-cursor) -- Session management, agent paradigms

### Secondary Sources (MEDIUM confidence)

- [AI Coding Assistants for Large Codebases (Augment Code)](https://www.augmentcode.com/tools/ai-coding-assistants-for-large-codebases-a-complete-guide) -- Table stakes features
- [Top Agentic AI Tools for VS Code (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2025/10/07/top-agentic-ai-tools-for-vs-code-according-to-installs.aspx) -- Marketplace trends
- [VS Code 1.107 Release (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2025/12/12/vs-code-1-107-november-2025-update-expands-multi-agent-orchestration-model-management.aspx) -- Multi-agent orchestration evolution
- [DevCompare: AI Coding Tools Comparison](https://www.devcompare.io/) -- Feature matrix across tools
- [MCP Security and Permission Models (Cerbos)](https://www.cerbos.dev/news/securing-ai-agents-model-context-protocol) -- Authorization patterns
- [Multi-Agent Systems Architecture (ADK Docs)](https://google.github.io/adk-docs/agents/multi-agents/) -- Context isolation patterns

### Domain Expertise (LOW confidence -- WebSearch only)

- [Google Antigravity AI IDE 2026 (Bay Tech Consulting)](https://www.baytechconsulting.com/blog/google-antigravity-ai-ide-2026) -- Per-project configuration persistence
- [Continue.dev Configuration Guide (AskCodi)](https://www.askcodi.com/documentation/integrations/continue/complete-guide-to-continue-dev) -- Configuration-based approach

### Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Table Stakes | HIGH | Official VS Code docs + multiple competitor analyses confirm expectations |
| Differentiators | MEDIUM | Based on competitor analysis; user demand inferred from market trends |
| Anti-Features | MEDIUM | Informed by VS Code's design decisions (e.g., no mid-session agent switching) |
| Dependencies | HIGH | Technical constraints well-documented in CodeAgent abstraction |
| MVP Definition | HIGH | Aligned with Lanes PROJECT.md requirements + competitor feature parity |

## Gaps to Address

1. **Codex session ID format**: Research needed on Codex's actual session ID format (UUID, string, numeric?). Validation logic in CodeAgent may need adjustment.
   - **Action**: Test Codex CLI; inspect `.codex` directory and SQLite database for session ID format.

2. **Codex status tracking mechanism**: Codex has no hook system like Claude. Alternative approaches needed (file watching, process monitoring, periodic polling).
   - **Action**: Spike on Codex process lifecycle; determine best status tracking approach (likely file watching on rollout files).

3. **Codex settings propagation**: Codex uses TOML (`.codex/config.toml`) vs Claude's JSON. Need TOML generation or simple string templating.
   - **Action**: Research Codex config.toml structure; decide between TOML library (toml npm package) vs string templating.

4. **User preference on sidebar differentiation**: User explicitly stated "no sidebar visual differentiation for agent type" to keep UI clean. Confirm this is universal preference or opt-in feature.
   - **Action**: Add VS Code setting `lanes.showAgentIndicators: boolean` (default: false) to make visual differentiation opt-in.

5. **Agent availability detection priority**: Should Lanes check for agent CLI availability at activation, or lazily when user selects agent?
   - **Action**: Lazy check on agent selection (better UX; avoids activation slowdown). Cache availability result per session.

---
*Feature research for: Lanes multi-agent support (Codex CLI integration)*
*Researched: 2026-02-10*
*Confidence: HIGH*
