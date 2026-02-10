# Pitfalls Research: Adding Codex CLI to Multi-Agent VS Code Extension

**Domain:** Multi-agent IDE extension development (Claude Code + OpenAI Codex CLI)
**Researched:** 2026-02-10
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Hardcoded Agent Assumptions Throughout Codebase

**What goes wrong:**
Despite having a `CodeAgent` abstraction layer, agent-specific assumptions leak throughout the codebase. File paths (`.claude-session`, `.claude-status`), watch patterns (`getStatusWatchPattern`), function names (`getClaudeSessionPath`), and UI labels ("Claude: sessionName") all hardcode Claude assumptions. When adding Codex, developers must hunt through the entire codebase to find and fix these assumptions, leading to subtle bugs where Codex sessions are created but not properly tracked, displayed, or managed.

**Why it happens:**
The first implementation naturally uses concrete names during development. The abstraction layer exists but wasn't enforced strictly - services and providers directly reference Claude-specific constants instead of using the agent abstraction. The codebase evolved from single-agent to abstract without full refactoring.

**How to avoid:**
- **Phase 1**: Audit and refactor all hardcoded references to use agent abstraction
  - Replace all `.claude-*` string literals with agent method calls (`agent.getSessionFileName()`)
  - Rename services from `ClaudeSessionProvider` to `SessionProvider`
  - Make watch patterns agent-aware: `getStatusWatchPattern(agent: CodeAgent)`
  - Terminal names should use `agent.getTerminalName()` not "Claude: X"
- **Phase 2**: Add linting rules to prevent new hardcoded references
  - ESLint rule to flag string literals containing "claude" outside agent implementations
  - TypeScript strict mode to catch missing agent parameters

**Warning signs:**
- Searching codebase for "claude" finds 100+ matches outside agent classes
- File paths constructed with string literals instead of agent methods
- Service methods don't accept agent parameter
- UI shows "Claude" label when Codex session is active
- Tests pass with Claude but fail with Codex on identical logic

**Phase to address:**
Phase 1 (Foundation/Refactoring) - Must complete before adding second agent

---

### Pitfall 2: Session State Tracking Without Hook Events

**What goes wrong:**
Codex has NO hook events system like Claude's SessionStart, Stop, UserPromptSubmit. Lanes relies on hooks to capture session IDs, write status files, and trigger workflow updates. Without hooks, the extension cannot:
- Detect when a Codex session starts/stops
- Capture the session ID for resume operations
- Track session status (working vs waiting)
- Trigger workflow synchronization on SessionStart

This creates "ghost sessions" where a Codex terminal runs but the extension doesn't know the session ID, can't show status icons, and can't resume the session later.

**Why it happens:**
Developers assume all CLI agents provide lifecycle hooks because Claude does. The architecture depends on hooks for critical functionality (session ID capture, status tracking, workflow sync) without a fallback mechanism. The fundamental design assumes reactive event-driven tracking rather than proactive polling.

**How to avoid:**
- **Polling-based status tracking**: For agents without hooks, implement periodic status checks
  - Read session files from `~/.codex/sessions/YYYY/MM/DD/*.jsonl`
  - Parse JSONL to extract session ID and status
  - Watch filesystem for new session files
- **Hybrid tracking strategy**: Abstract session tracking interface with two implementations
  - `HookBasedTracker` for Claude (reactive, immediate)
  - `PollingBasedTracker` for Codex (proactive, periodic)
- **CLI introspection**: Use CLI commands to query session state
  - Parse output of `codex /status` or similar commands
  - Extract session ID and state from terminal output
- **File watching**: Monitor session directories for changes
  - Watch `~/.codex/sessions/**/*.jsonl` for writes
  - Debounce rapid changes to avoid performance issues

**Warning signs:**
- Codex terminal opens but session doesn't appear in sidebar
- Status icon always shows "unknown" for Codex sessions
- Resume button doesn't work for Codex sessions
- Workflow synchronization never triggers for Codex
- Session ID is "unknown" in session files

**Phase to address:**
Phase 2 (Agent Abstraction Enhancement) - Add tracking strategy abstraction before Codex integration

---

### Pitfall 3: Configuration Format Conflicts (TOML vs JSON)

**What goes wrong:**
Claude uses JSON for settings (`.claude/settings.json`), Codex uses TOML (`~/.codex/config.toml`). The extension has:
- `localSettings.ts` hardcoded to copy `settings.local.json`
- Settings service that reads/writes JSON only
- Hook generation that creates JSON settings files
- No TOML parser or writer

When creating a Codex session, the extension creates invalid JSON settings files that Codex ignores, leading to missing configurations (wrong model, wrong approval policy, missing MCP servers). Users must manually configure every Codex session.

**Why it happens:**
Configuration format is an implementation detail developers assume is shared. The settings propagation system was built for Claude without considering alternative formats. TOML vs JSON seems trivial until you need to merge settings, validate schemas, or generate configs programmatically.

**How to avoid:**
- **Format-agnostic settings service**:
  ```typescript
  interface SettingsService {
    read(path: string, format: 'json' | 'toml'): Promise<object>;
    write(path: string, data: object, format: 'json' | 'toml'): Promise<void>;
    merge(base: object, override: object): object;
  }
  ```
- **Agent-specific settings builders**: Each agent provides format and structure
  ```typescript
  abstract class CodeAgent {
    abstract getSettingsFormat(): 'json' | 'toml';
    abstract getSettingsSchema(): object; // for validation
    abstract buildSettings(options: SettingsOptions): object;
  }
  ```
- **Library selection**: Add TOML parser dependency
  - Use `@iarna/toml` or `smol-toml` for parsing/writing TOML
  - Consider performance - TOML parsing is slower than JSON
- **Settings propagation per agent**:
  - Claude: Copy `.claude/settings.local.json`
  - Codex: Copy `~/.codex/config.toml` (different location, different format)

**Warning signs:**
- Codex sessions use default model instead of configured model
- Approval policies don't apply to Codex sessions
- MCP servers configured for Claude don't appear in Codex
- Settings file exists but agent ignores it
- Agent CLI warns about invalid configuration format

**Phase to address:**
Phase 2 (Agent Abstraction Enhancement) - Add before settings generation for Codex

---

### Pitfall 4: Permission Mode Flag Syntax Divergence

**What goes wrong:**
Claude uses `--dangerously-skip-permissions` and `--permission-mode acceptEdits`. Codex uses `--yolo`, `--full-auto`, `--ask-for-approval never`, and `--sandbox workspace-write`. The extension UI shows permission options that don't map to Codex flags, terminal commands fail with "unknown flag" errors, or worse - silently ignore flags and run with wrong permissions.

**Why it happens:**
Permission modes seem like a simple enum, but each agent has different philosophy:
- Claude: Binary (ask/skip) + mode (acceptEdits/readOnly)
- Codex: Two-dimensional (approval policy × sandbox mode) + convenience flags (--full-auto)

Developers map UI options to flags without considering that agents have different permission models. The abstraction layer defines `getPermissionFlag(mode: string): string` but different agents need different input parameters.

**How to avoid:**
- **Rich permission model abstraction**:
  ```typescript
  interface PermissionConfig {
    // High-level intent
    autoApprove: boolean;
    restrictWrites: boolean;
    allowNetwork: boolean;

    // Agent translates to specific flags
    toFlags(agent: CodeAgent): string[];
  }
  ```
- **Agent-specific permission UI**: Different dropdowns per agent
  - Claude: Simple 2-option dropdown ("Ask" vs "Auto-approve")
  - Codex: Two dropdowns ("Approval policy" + "Sandbox mode") + checkbox for convenience flags
- **Validation layer**: Agent validates permission combinations
  ```typescript
  abstract class CodeAgent {
    abstract validatePermissions(config: PermissionConfig): ValidationResult;
    abstract getPermissionFlags(config: PermissionConfig): string[];
  }
  ```
- **CLI introspection**: Test actual CLI behavior with flags
  - Unit tests: Does `--yolo` work? Does it do what we think?
  - Integration tests: Start session with flags, verify behavior

**Warning signs:**
- Terminal command fails with "unknown flag: --dangerously-skip-permissions"
- Codex asks for approval when UI shows "Auto-approve" selected
- Codex writes to filesystem when UI shows "Read-only" mode
- Permission dropdown options don't match agent's actual capabilities
- Users manually fix terminal commands after extension generates them

**Phase to address:**
Phase 3 (Codex Integration) - Map Codex flags during implementation, add validation

---

### Pitfall 5: Session ID Storage Location Mismatch

**What goes wrong:**
Claude stores session IDs in `.claude/settings.json` (or global storage) where the extension writes them via hooks. Codex stores session IDs in `~/.codex/sessions/YYYY/MM/DD/*.jsonl` files managed by Codex CLI internally. The extension cannot:
- Find the session ID to enable resume functionality
- Determine which session is running in a terminal
- Clean up old sessions
- Migrate sessions between machines

Users see duplicate sessions in the sidebar (stale extension records + actual Codex sessions), resume buttons that don't work, and inability to manage Codex session history.

**Why it happens:**
Developers assume session metadata is stored in a location the extension controls. Claude's hook system allows the extension to write session tracking files. Codex's internal database means the extension must READ from locations it doesn't control and coordinate with Codex's lifecycle without hooks.

**How to avoid:**
- **Agent-specific session discovery**:
  ```typescript
  abstract class CodeAgent {
    // Where does this agent store session records?
    abstract getSessionStoragePath(): string;

    // How to find all sessions?
    abstract discoverSessions(): Promise<SessionRecord[]>;

    // How to read session metadata?
    abstract readSessionMetadata(sessionId: string): Promise<SessionData>;
  }
  ```
- **Two-tier session tracking**:
  - Extension tracking: Minimal metadata (worktree path, agent type, workflow)
  - Agent tracking: Full session data (messages, state, history)
  - Reconciliation: Extension reads agent storage to sync its records
- **Filesystem watching per agent**:
  - Claude: Watch `.claude-session` files (extension-controlled)
  - Codex: Watch `~/.codex/sessions/**/*.jsonl` (Codex-controlled)
- **Session ID extraction strategies**:
  - Hooks (Claude): Session ID written directly by extension
  - File parsing (Codex): Extract from JSONL files
  - Terminal parsing (fallback): Extract from CLI output
  - User input (last resort): Ask user to provide session ID

**Warning signs:**
- Resume fails with "session not found" despite terminal showing active session
- Multiple sessions with same name appear in sidebar
- Stale sessions never disappear from sidebar
- Session status doesn't update after Codex terminal closes
- Extension tracking files contain "null" session IDs

**Phase to address:**
Phase 2 (Agent Abstraction Enhancement) - Add session discovery abstraction before Codex

---

### Pitfall 6: Local Settings Propagation Assumptions

**What goes wrong:**
The `localSettings.ts` module propagates `.claude/settings.local.json` from base repo to worktrees. For Codex:
- Settings are at `~/.codex/config.toml` (user-level, not project-level)
- Project-level settings are at `.codex/config.toml` (different directory name)
- Settings use TOML not JSON (different format)
- Symlink/copy strategy might not work (user-level vs project-level)

Creating a Codex worktree session propagates Claude settings, not Codex settings. Codex ignores the `.claude` directory. Users lose their Codex configuration in worktrees.

**Why it happens:**
Settings propagation was designed for Claude's specific architecture: project-scoped JSON files in `.claude` directory. Codex's user-level TOML config is fundamentally different. The assumption that "settings are project files that should be copied to worktrees" doesn't apply to Codex.

**How to avoid:**
- **Agent-specific propagation strategy**:
  ```typescript
  abstract class CodeAgent {
    abstract propagateSettings(
      baseRepoPath: string,
      worktreePath: string,
      mode: 'copy' | 'symlink' | 'disabled'
    ): Promise<void>;
  }
  ```
- **Claude implementation**: Current behavior (copy `.claude/settings.local.json`)
- **Codex implementation**: Different strategy
  - Option A: Copy `~/.codex/config.toml` → `<worktree>/.codex/config.toml` (make user config project-scoped)
  - Option B: Don't propagate (Codex reads user config automatically)
  - Option C: Merge user + base repo config → worktree config
- **Settings scope awareness**:
  - User-level: `~/.codex/config.toml`, `~/.claude/settings.json`
  - Project-level: `.codex/config.toml`, `.claude/settings.json`
  - Worktree-level: `<worktree>/.codex/config.toml`, `<worktree>/.claude/settings.json`
  - Decide which scopes to propagate per agent

**Warning signs:**
- Codex worktree sessions use different model than base repo sessions
- Environment variables defined in user Codex config missing in worktree
- `.claude` directory exists in Codex worktree (wrong directory copied)
- Settings propagation code throws errors for Codex sessions
- Users manually copy Codex config to each worktree

**Phase to address:**
Phase 3 (Codex Integration) - Implement Codex-specific propagation strategy

---

### Pitfall 7: UI Confusion - Agent Type Not Visible

**What goes wrong:**
The session form and sidebar don't show which agent is being used. All sessions look identical (icon, label, status). Users:
- Create Codex session thinking it's Claude
- Try Claude-specific commands in Codex terminal
- Can't tell at a glance which sessions are Claude vs Codex
- Expect Claude behavior from Codex sessions (or vice versa)

This gets worse with 3+ agents. Users need visual differentiation (icons, colors, labels) to manage multiple agent types.

**Why it happens:**
Single-agent UI design doesn't need agent type indicators. Adding a second agent without updating UI creates confusion. Developers focus on backend functionality (making Codex work) and overlook UX (helping users understand which agent they're using).

**How to avoid:**
- **Visual differentiation per agent**:
  - Icons: Claude (robot), Codex (brain/codex icon)
  - Colors: Claude (green), Codex (blue)
  - Labels: "Claude: session-name" vs "Codex: session-name"
- **Agent type in session form**:
  - Dropdown to select agent before creating session
  - Form adapts to show agent-specific options (permissions, workflows)
  - Clear preview: "Creating Codex session with..."
- **Session item UI enhancements**:
  - Agent icon in tree view next to session name
  - Agent type in tooltip: "Codex session (working)"
  - Color-coded status indicators per agent type
- **Terminal differentiation**:
  - Terminal title: "Codex: session-name" (uses `agent.getTerminalName()`)
  - Terminal icon: Agent-specific icon (uses `agent.getTerminalIcon()`)
  - Terminal env vars: `LANES_AGENT=codex`

**Warning signs:**
- User bug reports: "Claude command doesn't work" (actually Codex terminal)
- Users asking "which agent is this session?"
- Support issues: "Why is behavior different?" (different agents)
- Multiple sessions with identical icons/labels
- No way to filter sessions by agent type

**Phase to address:**
Phase 3 (Codex Integration) - Update UI when adding Codex, not after

---

### Pitfall 8: MCP Server Configuration Divergence

**What goes wrong:**
Claude MCP config is JSON in settings file, Codex MCP config is TOML in config file. Syntax differs:

**Claude:**
```json
{
  "mcpServers": {
    "lanes-workflow": {
      "command": "node",
      "args": ["server.js", "--worktree", "/path"]
    }
  }
}
```

**Codex:**
```toml
[mcp_servers.lanes-workflow]
command = "node"
args = ["server.js", "--worktree", "/path"]
```

The extension's `getMcpConfig()` returns JSON structure. Writing this to Codex TOML file creates invalid syntax. MCP servers fail to load, workflows don't work, users see errors.

**Why it happens:**
MCP config generation assumes JSON output. Each agent needs both correct structure AND correct format. The abstraction layer defines return type but not serialization format. Developers test with Claude (JSON works) but don't verify TOML output for Codex.

**How to avoid:**
- **Format-aware MCP config generation**:
  ```typescript
  abstract class CodeAgent {
    abstract getMcpConfig(
      worktreePath: string,
      workflowPath: string,
      repoRoot: string
    ): McpConfig | null;

    // New method for serialization
    abstract serializeMcpConfig(config: McpConfig): string;

    // New method for merging with existing settings
    abstract mergeMcpIntoSettings(
      existingSettings: string,
      mcpConfig: McpConfig
    ): string;
  }
  ```
- **Testing strategy**:
  - Unit tests: Verify TOML/JSON output matches agent's expected format
  - Integration tests: Write config file, start agent, verify MCP server loads
  - Schema validation: Parse generated config to ensure valid syntax
- **Agent-specific serializers**:
  - Claude: JSON.stringify() with proper nesting
  - Codex: TOML library with proper section headers and array syntax

**Warning signs:**
- MCP server shows in settings but doesn't load in agent
- Agent CLI errors: "invalid config syntax at line X"
- Workflow tools not available in Codex sessions
- Generated config file has JSON syntax in .toml file
- Manual config works, generated config fails

**Phase to address:**
Phase 3 (Codex Integration) - Add TOML serialization when implementing Codex MCP support

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip agent abstraction refactoring | Faster Codex integration | Every new agent requires full codebase audit | Never - must refactor first |
| Use polling for all agents | Simpler unified architecture | Higher CPU usage, slower updates for Claude | Never - use hooks where available |
| Manual session ID entry | Works without filesystem watching | Poor UX, error-prone | Demo/MVP only, never production |
| Share permission UI for all agents | Faster implementation | Confusing UX, wrong permissions set | Never - permissions are critical |
| JSON-only config generation | Avoids TOML dependency | Codex sessions lack proper config | Never - config format is fundamental |
| Single-agent UI (no type indicators) | No UI changes needed | Users confused about agent type | Never - UX debt compounds with each agent |
| Assume session storage location | Simpler discovery logic | Breaks with each new agent | Never - storage is agent-specific |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Codex CLI | Assume hooks exist | Implement polling-based status tracker first |
| Codex config | Write JSON to .toml file | Use TOML library, validate syntax |
| Codex session IDs | Look in extension storage | Parse `~/.codex/sessions/**/*.jsonl` files |
| Codex permissions | Use Claude permission flags | Map to `--sandbox` + `--ask-for-approval` |
| Codex MCP | Copy Claude MCP config structure | Adapt TOML format, test loading |
| Codex settings propagation | Copy `.claude/settings.local.json` | Decide user-level vs project-level strategy |
| Codex terminal commands | Generate like Claude commands | Different flag syntax, different resume format |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling all agents constantly | High CPU, battery drain on laptops | Poll Codex only, use hooks for Claude | Immediately with 2+ Codex sessions |
| Parsing large JSONL session files | Slow session discovery | Stream parsing, cache results | Sessions > 1000 messages |
| Watching entire `~/.codex/sessions/` tree | Too many filesystem events | Watch specific date directories only | > 50 Codex sessions |
| Re-generating configs on every activation | Slow extension startup | Cache configs, regenerate on change only | > 10 total sessions |
| Not debouncing filesystem events | Status updates trigger too frequently | Debounce 500ms, batch updates | Any real-world usage |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not validating session IDs before shell commands | Command injection via malicious session ID | Validate UUID format, whitelist characters |
| Copying user TOML config without sanitization | Secrets leaked to worktrees | Parse TOML, strip sensitive keys before copying |
| Trusting JSONL files from Codex | Malicious session files execute code | Validate JSON structure, sanitize file paths |
| Using `eval()` to parse config formats | Code execution | Use proper parsers (JSON.parse, TOML library) |
| Not escaping agent CLI arguments | Shell injection via prompts/paths | Use proper shell escaping or spawn with array args |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Same icon for all agent types | Can't distinguish Claude from Codex sessions | Agent-specific icons and colors |
| Generic permission dropdown | Users pick wrong permissions for Codex | Agent-specific permission UI |
| No agent selector in session form | Users confused about which agent will start | Prominent agent type dropdown first |
| Missing agent type in session list | Can't filter or sort by agent | Show agent type badge on each session item |
| Identical terminal names | Multiple "Claude: test" terminals | Include agent type in terminal title |
| No visual feedback on config errors | Users don't know why session fails | Show validation errors in session form |
| Resume button appears for un-resumable sessions | Button fails when clicked (Codex without session ID) | Hide button or show "session ID not found" state |

## "Looks Done But Isn't" Checklist

- [ ] **Agent abstraction:** All string literals replaced with agent method calls, no hardcoded "claude" references outside agent classes
- [ ] **Status tracking:** Both hook-based and polling-based tracking implemented and tested with real agents
- [ ] **Configuration:** TOML parser added, settings service supports both JSON and TOML with validation
- [ ] **Permission mapping:** Each agent's permission model documented, UI shows agent-appropriate options
- [ ] **Session discovery:** Agent-specific discovery implemented for both extension storage and agent CLI storage
- [ ] **Settings propagation:** Agent-specific strategy implemented for user-level vs project-level settings
- [ ] **UI differentiation:** Agent icons, colors, labels, and type indicators visible in all views
- [ ] **MCP config:** Format-aware serialization tested for both JSON (Claude) and TOML (Codex)
- [ ] **Error handling:** Graceful degradation when agent CLI not found, session ID missing, or config invalid
- [ ] **Testing:** Integration tests run with both Claude and Codex, not just Claude

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Hardcoded agent assumptions | MEDIUM | 1. Search codebase for "claude" strings 2. Replace with agent.method() calls 3. Rename services to be agent-agnostic 4. Add ESLint rule to prevent regression 5. Test with both agents |
| Missing hook alternative | HIGH | 1. Design polling-based tracker interface 2. Implement filesystem watching for Codex sessions 3. Add CLI output parsing 4. Test polling performance 5. Add config for poll interval |
| Wrong config format written | LOW | 1. Add TOML library dependency 2. Implement TOML serializer 3. Add format parameter to config writer 4. Add syntax validation 5. Test generated configs with agent CLI |
| Session IDs not captured | MEDIUM | 1. Implement agent.discoverSessions() 2. Add filesystem watcher for agent session directory 3. Parse session files for IDs 4. Reconcile with extension records 5. Test discovery with old sessions |
| Permission flags incorrect | LOW | 1. Document each agent's permission model 2. Create permission config object 3. Implement agent.getPermissionFlags() 4. Update UI to use config object 5. Validate flags in integration tests |
| Settings not propagated | MEDIUM | 1. Implement agent.propagateSettings() 2. Determine user vs project level strategy 3. Handle TOML format for Codex 4. Test propagation with real worktrees 5. Add config option to control behavior |
| UI shows wrong agent | LOW | 1. Add agent icons to asset bundle 2. Update session items to show icon 3. Update terminal names with agent type 4. Add agent badge to session list 5. Test with multiple sessions of each type |
| MCP config format wrong | MEDIUM | 1. Implement agent.serializeMcpConfig() 2. Add agent.mergeMcpIntoSettings() 3. Test TOML array and table syntax 4. Validate against Codex config schema 5. Integration test MCP server loading |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Hardcoded agent assumptions | Phase 1 (Refactoring) | Search codebase for "claude", count should be < 10 outside agent classes |
| Session tracking without hooks | Phase 2 (Abstraction) | Create mock agent without hooks, verify polling works |
| Configuration format conflicts | Phase 2 (Abstraction) | Generate TOML config, parse it back, verify structure matches |
| Permission flag divergence | Phase 3 (Codex Integration) | Start Codex with generated flags, verify behavior matches UI |
| Session ID storage mismatch | Phase 2 (Abstraction) | Implement discovery, find existing Codex sessions from CLI |
| Settings propagation assumptions | Phase 3 (Codex Integration) | Create worktree, verify Codex config exists and is valid |
| UI confusion (no agent type) | Phase 3 (Codex Integration) | Visual inspection - can you tell agent types apart? |
| MCP configuration divergence | Phase 3 (Codex Integration) | Start Codex with MCP, verify workflow tools available |

## Sources

### Multi-Agent IDE Architecture
- [Your Home for Multi-Agent Development - VS Code](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- [The best agentic IDEs heading into 2026](https://www.builder.io/blog/agentic-ide)
- [VS Code 1.107 Multi-Agent Orchestration](https://visualstudiomagazine.com/articles/2025/12/12/vs-code-1-107-november-2025-update-expands-multi-agent-orchestration-model-management.aspx)
- [Building an Agentic IDE with Multi-Agent Systems](https://medium.com/@prashanthkgajula/building-an-agentic-ide-how-i-built-a-multi-agent-code-generation-system-with-langgraph-and-467f08f6bf64)

### Common AI Agent Development Mistakes
- [Common AI Agent Development Mistakes and How to Avoid Them](https://www.wildnetedge.com/blogs/common-ai-agent-development-mistakes-and-how-to-avoid-them)
- [How to Build Multi-Agent Systems: Complete 2026 Guide](https://dev.to/eira-wexford/how-to-build-multi-agent-systems-complete-2026-guide-1io6)
- [Agent design patterns](https://rlancemartin.github.io/2026/01/09/agent_design/)

### Codex CLI Configuration
- [Codex CLI Command Line Reference](https://developers.openai.com/codex/cli/reference/)
- [Codex Config Basics](https://developers.openai.com/codex/config-basic/)
- [Codex Configuration Reference](https://developers.openai.com/codex/config-reference/)
- [OpenAI Codex CLI Comprehensive Guide 2026](https://smartscope.blog/en/generative-ai/chatgpt/openai-codex-cli-comprehensive-guide/)

### Session Management Challenges
- [SubagentStop hook cannot identify specific subagent - Claude Code Issue](https://github.com/anthropics/claude-code/issues/7881)
- [Session Management Commands - Claude Code Guide](https://deepwiki.com/FlorianBruniaux/claude-code-ultimate-guide/16.1-session-management-commands)
- [Feature Request: Expose Session Metadata - Claude Code](https://github.com/anthropics/claude-code/issues/17188)
- [agent-sessions: Multi-CLI Agent Session Browser](https://github.com/jazzyalex/agent-sessions)

### Codex Security and Permissions
- [Codex CLI Security](https://developers.openai.com/codex/security/)
- [Codex CLI Approval Modes Explained](https://vladimirsiedykh.com/blog/codex-cli-approval-modes-2025)
- [How Codex CLI Flags Actually Work](https://www.vincentschmalbach.com/how-codex-cli-flags-actually-work-full-auto-sandbox-and-bypass/)
- [Codex CLI Disable Approval Guide](https://smartscope.blog/en/generative-ai/chatgpt/codex-cli-approval-modes-no-approval/)

### Codex Session Storage
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/)
- [Feature: Multi-Session Management for Codex CLI](https://github.com/openai/codex/discussions/341)
- [Claude vs Codex Comparison 2026](https://wavespeed.ai/blog/posts/claude-vs-codex-comparison-2026/)
- [First Few Days with Codex CLI](https://amanhimself.dev/blog/first-few-days-with-codex-cli/)

### Multi-Agent UX Challenges
- [A2A, MCP, AG-UI, A2UI: 2026 AI Agent Protocol Stack](https://medium.com/@visrow/a2a-mcp-ag-ui-a2ui-the-essential-2026-ai-agent-protocol-stack-ee0e65a672ef)
- [Agents Will Kill Your UI by 2026](https://medium.com/@codeai/agents-will-kill-your-ui-by-2026-unless-you-build-this-instead-088a2f2bbe4d)
- [Rethinking UX in the Age of Multi-Agent AI](https://www.weforum.org/stories/2025/08/rethinking-the-user-experience-in-the-age-of-multi-agent-ai/)
- [10 Things Developers Want from Agentic IDEs](https://redmonk.com/kholterhoff/2025/12/22/10-things-developers-want-from-their-agentic-ides-in-2025/)

### Configuration Format Management
- [JSON vs YAML vs TOML: Which Format for 2026?](https://dev.to/jsontoall_tools/json-vs-yaml-vs-toml-which-configuration-format-should-you-use-in-2026-1hlb)
- [How to Handle Configuration with Config-rs in Rust](https://oneuptime.com/blog/post/2026-02-01-rust-config-rs-configuration/view)
- [Codex IDE Extension Settings](https://developers.openai.com/codex/ide/settings/)

### Git Worktrees for Multi-Agent Development
- [Using Git Worktrees for Parallel AI Development](https://stevekinney.com/courses/ai-development/git-worktrees)
- [How Git Worktrees Changed My AI Agent Workflow](https://nx.dev/blog/git-worktrees-ai-agents)
- [Running Multiple AI Agents Using Git Worktrees](https://medium.com/design-bootcamp/running-multiple-ai-agents-at-once-using-git-worktrees-57759e001d7a)
- [Parallel AI Development with Git Worktrees](https://sgryt.com/posts/git-worktree-parallel-ai-development/)

### VS Code Agent Integration
- [Using agents in Visual Studio Code](https://code.visualstudio.com/docs/copilot/agents/overview)
- [Third-party agents in VS Code](https://code.visualstudio.com/docs/copilot/agents/third-party-agents)
- [Use agent mode in VS Code](https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode)
- [VS Code January 2026 Update](https://code.visualstudio.com/updates/v1_109?pubDate=20260204)

---
*Pitfalls research for: Adding OpenAI Codex CLI support to Lanes VS Code extension*
*Researched: 2026-02-10*
