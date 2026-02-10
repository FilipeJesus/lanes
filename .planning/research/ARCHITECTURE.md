# Architecture Research: Codex CLI Integration

**Domain:** VS Code Extension - Multi-Agent Support
**Researched:** 2026-02-10
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                      VS Code Extension Layer                         │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  extension.ts │  │  Commands    │  │  Watchers    │              │
│  │  (activate)   │  │  (handlers)  │  │ (filesystem) │              │
│  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘              │
│          │                 │                 │                       │
│          └─────────────────┴─────────────────┘                       │
│                            ↓                                         │
├─────────────────────────────────────────────────────────────────────┤
│                       Provider Layer                                 │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  SessionForm │  │  SessionTree │  │  Workflows   │              │
│  │  Provider    │  │  Provider    │  │  Provider    │              │
│  └───────┬──────┘  └───────┬──────┘  └───────┬──────┘              │
│          │                 │                 │                       │
│          │                 ↓                 │                       │
│          │         ┌──────────────┐          │                       │
│          └────────→│ ServiceContainer├────────┘                      │
│                    └────────┬─────┘                                  │
├─────────────────────────────┴───────────────────────────────────────┤
│                       Service Layer                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Session  │  │ Terminal │  │ Settings │  │ Workflow │           │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │             │              │             │                  │
│       └─────────────┴──────────────┴─────────────┘                  │
│                            ↓                                         │
│  ┌──────────────────────────────────────────────────────┐           │
│  │              CodeAgent (abstraction)                 │           │
│  │  ┌────────────────┐  ┌────────────────┐             │           │
│  │  │ ClaudeCodeAgent│  │ CodexCodeAgent │ ← NEW       │           │
│  │  └────────────────┘  └────────────────┘             │           │
│  └──────────────────────────────────────────────────────┘           │
├─────────────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                               │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │   File   │  │   Git    │  │Validation│  │  Errors  │           │
│  │  Service │  │ Service  │  │  Utils   │  │  Types   │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| extension.ts | Extension lifecycle, initialization, wiring | Hardcodes `new ClaudeCodeAgent()` at line 102 |
| SessionFormProvider | Webview form for session creation | No agent selection UI currently |
| ServiceContainer | Dependency injection container | Holds single `codeAgent: CodeAgent` instance |
| SessionService | Session creation, worktree management | Uses `codeAgent` parameter in createSession() |
| TerminalService | Terminal lifecycle, command building | Uses `codeAgent` for terminal naming, commands |
| SettingsService | Settings file generation, hooks config | Uses `codeAgent` for file naming, hook generation |
| CodeAgent | Agent abstraction (15+ abstract methods) | Base class defining contract for all agents |
| ClaudeCodeAgent | Claude-specific implementation | Hooks, MCP, permission modes, JSON settings |

## Recommended Project Structure

```
src/
├── codeAgents/             # Agent abstraction layer
│   ├── CodeAgent.ts        # Abstract base class (existing)
│   ├── ClaudeCodeAgent.ts  # Claude implementation (existing)
│   ├── CodexCodeAgent.ts   # NEW - Codex implementation
│   └── index.ts            # Export all agents
├── extension.ts            # CHANGE - Agent factory/selection logic
├── SessionFormProvider.ts  # CHANGE - Add agent selector UI
├── services/
│   ├── SessionService.ts   # MINOR - Already agent-aware
│   ├── TerminalService.ts  # MINOR - Already agent-aware
│   └── SettingsService.ts  # MINOR - Already agent-aware
└── validation/
    └── validators.ts       # POSSIBLE - Codex session ID validation
```

### Structure Rationale

- **codeAgents/:** Already exists and designed for multiple agents. CodexCodeAgent fits naturally here.
- **extension.ts:** Currently hardcodes ClaudeCodeAgent. Needs factory pattern or agent selection logic based on VS Code setting.
- **SessionFormProvider.ts:** Webview needs agent dropdown added to HTML form.
- **services/:** Already receive `codeAgent` as parameter. Minimal changes needed.

## Architectural Patterns

### Pattern 1: CodeAgent Abstraction (Abstract Factory)

**What:** Abstract base class with 15+ abstract methods defining the contract for all code agents. Each agent implements agent-specific behavior (file naming, command building, permission modes, hooks).

**When to use:** When adding support for a new CLI-based code agent (Codex, OpenCode, Gemini CLI, etc.).

**Trade-offs:**
- **Pros:** Clean separation of concerns, easy to add new agents, no conditional logic scattered across codebase
- **Cons:** Requires implementing all abstract methods even if some don't apply (e.g., Codex has no hooks)

**Example:**
```typescript
// src/codeAgents/CodexCodeAgent.ts
export class CodexCodeAgent extends CodeAgent {
    constructor() {
        super({
            name: 'codex',
            displayName: 'Codex',
            cliCommand: 'codex',
            sessionFileExtension: '.codex-session',
            statusFileExtension: '.codex-status',
            settingsFileName: 'config.toml',
            defaultDataDir: '.codex'
        });
    }

    getSessionFileName(): string {
        return this.config.sessionFileExtension;
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts: string[] = [this.config.cliCommand];

        // Codex uses --sandbox flag instead of --permission-mode
        if (options.permissionMode) {
            const sandboxMode = this.mapPermissionToSandbox(options.permissionMode);
            parts.push(`--sandbox ${sandboxMode}`);
        }

        // Add prompt last
        if (options.prompt) {
            const escapedPrompt = this.escapeForSingleQuotes(options.prompt);
            parts.push(`'${escapedPrompt}'`);
        }

        return parts.join(' ');
    }

    buildResumeCommand(sessionId: string, options: ResumeCommandOptions): string {
        // Codex uses "codex resume <ID>" instead of "codex --resume <UUID>"
        return `${this.config.cliCommand} resume ${sessionId}`;
    }

    // ... implement remaining abstract methods
}
```

### Pattern 2: Single Agent Instance (Singleton per Extension)

**What:** Extension creates one CodeAgent instance during activation and passes it through ServiceContainer to all services, commands, and providers.

**When to use:** When the agent is selected once (via VS Code setting or form) and remains consistent throughout the extension lifetime.

**Trade-offs:**
- **Pros:** Simple, no need to track agent per session, single source of truth
- **Cons:** Cannot mix agents in the same VS Code window (e.g., Claude sessions + Codex sessions simultaneously)

**Example:**
```typescript
// src/extension.ts (current approach)
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Hardcoded single agent
    const codeAgent = new ClaudeCodeAgent();

    // Pass to all services
    const services: ServiceContainer = {
        extensionContext: context,
        sessionProvider,
        codeAgent  // Single instance
    };

    // All commands use this agent
    registerAllCommands(context, services, refreshWorkflows);
}
```

### Pattern 3: Agent Factory (Recommended for Codex Support)

**What:** Factory function that creates the appropriate CodeAgent based on VS Code setting or user selection. Extension activation reads the setting and instantiates the correct agent.

**When to use:** When users need to choose their preferred agent (Codex vs Claude) at extension activation or session creation time.

**Trade-offs:**
- **Pros:** User control, flexible, allows per-session agent selection if extended
- **Cons:** More complex than singleton, requires agent selection UI

**Example:**
```typescript
// src/codeAgents/factory.ts (NEW FILE)
export function createCodeAgent(agentName: string): CodeAgent {
    switch (agentName) {
        case 'claude':
            return new ClaudeCodeAgent();
        case 'codex':
            return new CodexCodeAgent();
        default:
            throw new Error(`Unknown agent: ${agentName}`);
    }
}

// src/extension.ts (UPDATED)
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Read agent from VS Code setting
    const config = vscode.workspace.getConfiguration('lanes');
    const defaultAgent = config.get<string>('defaultAgent', 'claude');

    const codeAgent = createCodeAgent(defaultAgent);
    console.log(`Code agent initialized: ${codeAgent.displayName}`);

    // Rest of activation...
}
```

## Data Flow

### Agent Selection Flow (NEW)

```
[Extension Activation]
    ↓
[Read VS Code Setting: lanes.defaultAgent]
    ↓
[Agent Factory: createCodeAgent(defaultAgent)]
    ↓
[ClaudeCodeAgent | CodexCodeAgent] → [ServiceContainer]
    ↓
[All Services Use Selected Agent]
```

### Session Creation Flow (UPDATED)

```
[User Submits Session Form]
    ↓
[SessionFormProvider] → [createSession(name, prompt, ..., codeAgent)]
    ↓
[SessionService.createSession()]
    ↓
[CodeAgent: getDataDirectory(), getSessionFileName()]
    ↓
[Create Git Worktree]
    ↓
[SettingsService: getOrCreateExtensionSettingsFile(worktreePath, codeAgent)]
    ↓
[CodeAgent: getSettingsFileName(), generateHooksConfig()]
    ↓
[Write Settings File] (.claude/settings.json OR .codex/config.toml)
    ↓
[TerminalService: openClaudeTerminal(name, path, ..., codeAgent)]
    ↓
[CodeAgent: buildStartCommand() OR buildResumeCommand()]
    ↓
[Terminal: sendText(command)]
```

### Command Building Flow (Per Agent)

**Claude Code:**
```
[buildStartCommand]
    ↓
["claude --mcp-config <path> --settings <path> --permission-mode acceptEdits '<prompt>'"]
```

**Codex CLI:**
```
[buildStartCommand]
    ↓
["codex --sandbox workspace-write '<prompt>'"]
```

### Key Data Flows

1. **Agent Selection:** Extension activation reads `lanes.defaultAgent` setting → Factory creates agent → Stored in ServiceContainer → Passed to all services
2. **Terminal Command Generation:** Service calls `codeAgent.buildStartCommand(options)` → Agent constructs CLI-specific command → Terminal sends text
3. **Settings File Creation:** SettingsService calls `codeAgent.getSettingsFileName()` and `codeAgent.generateHooksConfig()` → Writes agent-specific settings file
4. **Session File Naming:** ClaudeSessionProvider calls `codeAgent.getSessionFileName()` → Reads `.claude-session` or `.codex-session` based on agent

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-2 agents | Current singleton pattern works fine with agent factory |
| 3-5 agents | Consider agent registry pattern instead of hardcoded factory switch |
| Per-session agent selection | Replace single agent instance with agent-per-session map in ServiceContainer |

### Scaling Priorities

1. **First extension:** Single agent instance with global setting is sufficient. Agent factory keeps it flexible.
2. **Future growth:** If users want multiple agents active simultaneously (Claude in one session, Codex in another), store agent name in session metadata and instantiate per session.

## Anti-Patterns

### Anti-Pattern 1: Conditional Logic in Services

**What people do:** Check agent type in services and branch logic based on agent
```typescript
// WRONG
if (codeAgent.name === 'claude') {
    // Claude-specific logic
} else if (codeAgent.name === 'codex') {
    // Codex-specific logic
}
```

**Why it's wrong:** Violates Open/Closed Principle, requires changing services for every new agent, leads to spaghetti code

**Do this instead:** Add abstract methods to CodeAgent that encapsulate the behavior
```typescript
// RIGHT - in CodeAgent
abstract buildStartCommand(options: StartCommandOptions): string;

// Service just calls the method
const command = codeAgent.buildStartCommand(options);
```

### Anti-Pattern 2: Hardcoding Agent in Extension

**What people do:** Keep `new ClaudeCodeAgent()` hardcoded in extension.ts

**Why it's wrong:** Forces recompilation to change agents, no user control, makes testing difficult

**Do this instead:** Use agent factory with VS Code setting
```typescript
// RIGHT
const defaultAgent = config.get<string>('lanes.defaultAgent', 'claude');
const codeAgent = createCodeAgent(defaultAgent);
```

### Anti-Pattern 3: Mixing Session Metadata Formats

**What people do:** Store agent-specific data in session file (e.g., Claude-specific hooks in `.codex-session`)

**Why it's wrong:** Agent-specific metadata pollutes cross-agent session files, breaks abstraction

**Do this instead:** Keep session files agent-agnostic with common fields (sessionId, timestamp, workflow). Store agent-specific config in agent-specific settings files (.claude/settings.json vs .codex/config.toml).

## Integration Points

### Component Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| extension.ts ↔ CodeAgent | Factory pattern | Extension creates agent instance via factory |
| ServiceContainer ↔ Services | Dependency injection | ServiceContainer holds agent, passes to services |
| SessionFormProvider ↔ extension.ts | Callback | Form submits agent selection, extension creates agent |
| TerminalService ↔ CodeAgent | Method calls | Terminal calls buildStartCommand(), buildResumeCommand() |
| SettingsService ↔ CodeAgent | Method calls | Settings calls getSettingsFileName(), generateHooksConfig() |

### Integration Changes for Codex

| Component | Change Required | Complexity | Notes |
|-----------|-----------------|------------|-------|
| **extension.ts** | HIGH | Medium | Replace `new ClaudeCodeAgent()` with agent factory |
| **SessionFormProvider.ts** | HIGH | Medium | Add agent dropdown to webview HTML |
| **ServiceContainer** | NONE | N/A | Already has `codeAgent: CodeAgent` field |
| **SessionService** | NONE | N/A | Already receives `codeAgent` parameter |
| **TerminalService** | MINOR | Low | Remove fallback logic (lines 275-279, 356-374) |
| **SettingsService** | MINOR | Low | Handle TOML generation for Codex (or return empty hooks) |

### Data Flow Changes

**Current (Claude-only):**
```
extension.ts: new ClaudeCodeAgent()
    ↓
ServiceContainer { codeAgent: ClaudeCodeAgent }
    ↓
All services use ClaudeCodeAgent
```

**Proposed (Multi-agent):**
```
extension.ts: config.get('lanes.defaultAgent')
    ↓
createCodeAgent(defaultAgent) → ClaudeCodeAgent | CodexCodeAgent
    ↓
ServiceContainer { codeAgent: CodeAgent }
    ↓
All services use polymorphic CodeAgent interface
```

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| VS Code Settings | Read configuration | New setting: `lanes.defaultAgent` (enum: 'claude' | 'codex') |
| Git CLI | Execute shell commands | No changes needed |
| Claude Code CLI | Execute `claude` command | Existing integration via ClaudeCodeAgent |
| Codex CLI | Execute `codex` command | New integration via CodexCodeAgent |

## Suggested Build Order

### Phase 1: Foundation (No UI Changes)

1. **Create CodexCodeAgent class** (`src/codeAgents/CodexCodeAgent.ts`)
   - Implement all abstract methods from CodeAgent
   - Focus on command building (buildStartCommand, buildResumeCommand)
   - Implement file naming (getSessionFileName, getStatusFileName, getSettingsFileName)
   - Stub out hooks (return empty array from generateHooksConfig)
   - Dependencies: None (pure implementation)

2. **Add agent factory** (`src/codeAgents/factory.ts` or in `index.ts`)
   - `createCodeAgent(name: string): CodeAgent` function
   - Switch statement for 'claude' | 'codex'
   - Dependencies: ClaudeCodeAgent, CodexCodeAgent

3. **Add VS Code setting** (`package.json`)
   - New setting: `lanes.defaultAgent`
   - Enum values: ['claude', 'codex']
   - Default: 'claude'
   - Dependencies: None (configuration only)

4. **Update extension.ts activation**
   - Replace hardcoded `new ClaudeCodeAgent()` with factory call
   - Read setting: `config.get<string>('lanes.defaultAgent', 'claude')`
   - Call factory: `const codeAgent = createCodeAgent(defaultAgent)`
   - Dependencies: Agent factory

### Phase 2: UI Integration

5. **Update SessionFormProvider webview**
   - Add agent selector dropdown to HTML (before workflow selector)
   - Add agent state to webview state management
   - Update form submission to include selected agent
   - Update callback signature: `setOnSubmit(callback: (name, prompt, sourceBranch, permissionMode, workflow, attachments, agent) => Promise<void>)`
   - Dependencies: Extension activation (to receive agent list)

6. **Update session creation flow**
   - Modify `createSession()` in SessionService to accept agent name parameter
   - Create agent instance per session (or use default from ServiceContainer)
   - Pass agent to all service calls
   - Dependencies: Agent factory

### Phase 3: Cleanup

7. **Remove fallback logic in services**
   - TerminalService lines 275-279, 356-374 (hardcoded fallback to Claude commands)
   - SettingsService lines 276-302 (hardcoded fallback to Claude hooks)
   - These fallbacks are unnecessary once CodeAgent is always provided
   - Dependencies: Full agent integration

8. **Add Codex-specific validation**
   - Session ID format validation for Codex (may differ from UUID)
   - Sandbox mode validation
   - Dependencies: Codex CLI documentation

### Phase 4: Polish (Optional)

9. **Add agent icon/color differentiation**
   - Update terminal icon based on agent (e.g., different color for Codex)
   - Update session tree item icons
   - Dependencies: CodeAgent API extension

10. **Add per-session agent switching**
    - Store agent name in session metadata
    - Read agent from session file on resume
    - Requires refactoring ServiceContainer to support multiple agents
    - Dependencies: Major refactor

### Dependencies Between Phases

```
Phase 1 (Foundation) → Phase 2 (UI) → Phase 3 (Cleanup) → Phase 4 (Polish)
     ↓                     ↓
     All self-contained   Depends on Phase 1
```

**Critical Path:**
1. CodexCodeAgent implementation (Phase 1.1)
2. Agent factory (Phase 1.2)
3. Extension activation update (Phase 1.4)
4. SessionFormProvider UI (Phase 2.5)

**Can be done in parallel:**
- VS Code setting (Phase 1.3) can be added anytime
- Cleanup (Phase 3) can start after Phase 2 completes
- Polish (Phase 4) is independent

## Key Technical Differences (Codex vs Claude)

| Aspect | Claude Code | Codex CLI | Impact on CodeAgent |
|--------|------------|-----------|---------------------|
| CLI command | `claude` | `codex` | `config.cliCommand` |
| Start command | `claude [prompt]` | `codex [prompt]` | `buildStartCommand()` |
| Resume command | `claude --resume <UUID>` | `codex resume <ID>` | `buildResumeCommand()` |
| Permission modes | `--permission-mode acceptEdits`, `--dangerously-skip-permissions` | `--sandbox read-only/workspace-write/danger-full-access`, `--ask-for-approval ...` | `getPermissionModes()`, `getPermissionFlag()` |
| Settings file | `.claude/settings.json` (JSON) | `.codex/config.toml` (TOML) | `getSettingsFileName()`, settings generation in SettingsService |
| MCP config | `--mcp-config <path>` (JSON file) | `[mcp_servers]` section in config.toml | `supportsMcp()` returns false for Codex (initially) |
| Hooks | Rich hook system (SessionStart, Stop, etc.) | `notify` array (notifications only) | `getHookEvents()` returns empty for Codex, `generateHooksConfig()` returns empty array |
| Session IDs | UUID stored in `.claude-session` | Managed internally (rollout files + SQLite) | Session ID capture requires different approach for Codex |
| Status tracking | `.claude-status` file updated by hooks | No equivalent | Status tracking not available for Codex (initially) |

## Implementation Notes

### Codex-Specific Challenges

1. **No Hook System:**
   - **Problem:** Codex has no SessionStart/Stop hooks. Cannot capture session ID automatically.
   - **Solution (Initial):** Skip session ID capture for Codex sessions. Use worktree name as session identifier. Resume support limited to `codex resume --last` flag.
   - **Solution (Future):** Parse Codex rollout files or SQLite database to extract session IDs.

2. **Status Tracking:**
   - **Problem:** Codex has no `.codex-status` file equivalent. Cannot track working/waiting state.
   - **Solution (Initial):** Status remains "unknown" for Codex sessions. No icon changes in tree view.
   - **Solution (Future):** Implement process monitoring or parse Codex output to infer status.

3. **Settings Format:**
   - **Problem:** Codex uses TOML, not JSON. Settings propagation logic differs.
   - **Solution:** `SettingsService.getOrCreateExtensionSettingsFile()` checks agent type and generates TOML for Codex. Start with minimal config (no hooks, no MCP).

4. **Session Resume:**
   - **Problem:** Codex uses `codex resume <ID>` instead of `codex --resume <UUID>`. Session ID format unknown.
   - **Solution:** `buildResumeCommand()` uses Codex syntax. Session ID validation may need adjustment (remove UUID check for Codex).

### Migration from Single Agent to Multi-Agent

**Current State:**
- Extension hardcodes `new ClaudeCodeAgent()` at line 102 of extension.ts
- ServiceContainer holds single `codeAgent` instance
- All services receive agent via ServiceContainer

**Migration Path:**
1. Add factory function (no breaking changes)
2. Replace hardcoded instantiation with factory call (no API changes)
3. Add VS Code setting for default agent (backward compatible)
4. Add agent selector to form (UI change, no breaking changes)
5. Update session creation to accept agent parameter (backward compatible with default)

**Backward Compatibility:**
- Existing Claude sessions continue working (no metadata format change)
- Default agent setting is 'claude' (no behavior change for existing users)
- Agent abstraction already in place (no service API changes needed)

## Sources

- Lanes codebase analysis (src/codeAgents/CodeAgent.ts, src/extension.ts, src/services/)
- VS Code Extension API documentation
- Claude Code CLI documentation (inferred from ClaudeCodeAgent implementation)
- Codex CLI documentation (from PROJECT.md technical differences table)

---
*Architecture research for: Codex CLI integration into Lanes VS Code extension*
*Researched: 2026-02-10*
