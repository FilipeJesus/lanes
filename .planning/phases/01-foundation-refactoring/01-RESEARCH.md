# Phase 1: Foundation Refactoring - Research

**Phase:** 01-foundation-refactoring
**Date:** 2026-02-10
**Status:** Research Complete

## Executive Summary

Phase 1 requires eliminating hardcoded Claude assumptions from the codebase to support multiple agents. The CodeAgent abstraction already exists and is well-designed, but the codebase contains extensive Claude-specific naming and hardcoded file paths throughout services, commands, and UI elements. This research identifies all refactoring targets, dependencies, and implementation patterns needed to achieve an agent-agnostic foundation.

## Requirements Addressed

| Requirement | Description | Complexity |
|-------------|-------------|------------|
| REQ-F1 | Eliminate hardcoded Claude assumptions | High |
| REQ-F2 | Agent-agnostic service naming | Medium |
| REQ-F3 | Clean abstraction boundary | High |

## Current State Analysis

### Existing CodeAgent Abstraction

**Location:** `src/codeAgents/CodeAgent.ts` (387 lines)

The `CodeAgent` abstract class is well-designed with comprehensive interfaces:

**Strengths:**
- Complete method coverage for file naming, terminal config, command building, session/status parsing
- Hook system abstraction with `generateHooksConfig()`
- Optional MCP support via `supportsMcp()` and `getMcpConfig()`
- Strong validation and security patterns (session ID validation, shell escaping)
- Clear separation between config (read-only) and behavior (methods)

**Current Methods:**
- File naming: `getSessionFileName()`, `getStatusFileName()`, `getSettingsFileName()`, `getDataDirectory()`
- Terminal: `getTerminalName()`, `getTerminalIcon()`
- Commands: `buildStartCommand()`, `buildResumeCommand()`
- Parsing: `parseSessionData()`, `parseStatus()`, `getValidStatusStates()`
- Permissions: `getPermissionModes()`, `validatePermissionMode()`, `getPermissionFlag()`
- Hooks: `getHookEvents()`, `generateHooksConfig()`
- MCP: `supportsMcp()`, `getMcpConfig()` (optional)

**Implementation:** `ClaudeCodeAgent` (334 lines) implements all methods correctly.

### Hardcoded Claude Assumptions

#### 1. String Literals (REQ-F1)

**Critical Findings:** Widespread use of `.claude-session`, `.claude-status`, `Claude:` strings

| File | Line(s) | Pattern | Usage |
|------|---------|---------|-------|
| `ClaudeSessionProvider.ts` | 118, 129 | `.claude-session` | Direct file name usage in `getClaudeSessionPath()` |
| `ClaudeSessionProvider.ts` | 129, 136 | `.claude-status` | Direct file name usage in `getClaudeStatusPath()` |
| `SettingsService.ts` | 101, 104 | `**/.claude-status` | Watch pattern |
| `SettingsService.ts` | 116, 119 | `**/.claude-session` | Watch pattern |
| `watchers.ts` | 83, 95 | `**/.claude-status`, `**/.claude-session` | Global storage watch patterns |
| `commands/sessionCommands.ts` | 162, 177 | `Claude: ${sessionName}` | Terminal name construction |
| `localSettings.ts` | 7-8 | `settings.local.json`, `.claude` | Hardcoded file/dir names |

**Impact:** All file path operations must go through CodeAgent methods instead of constructing paths directly.

#### 2. Agent-Specific Service Naming (REQ-F2)

**Class Names Requiring Rename:**

| Current Name | Target Name | File | Lines | Dependencies |
|--------------|-------------|------|-------|--------------|
| `ClaudeSessionProvider` | `AgentSessionProvider` | `ClaudeSessionProvider.ts` | 399 | 26 imports across codebase |
| `ClaudeStatus` | `AgentStatus` | `ClaudeSessionProvider.ts` | Type | Already exists in CodeAgent.ts |
| `ClaudeStatusState` | `AgentStatusState` | `ClaudeSessionProvider.ts` | Type | Used in validation |
| `ClaudeSessionData` | `AgentSessionData` | `ClaudeSessionProvider.ts` | Type | Already exists as `SessionData` in CodeAgent.ts |

**Function Names Requiring Rename:**

| Current Name | Target Name | Reason |
|--------------|-------------|--------|
| `getClaudeSessionPath()` | `getSessionFilePath()` | Agent-neutral naming |
| `getClaudeStatusPath()` | `getStatusFilePath()` | Agent-neutral naming |
| `getClaudeStatus()` | `getAgentStatus()` | Agent-neutral naming |
| `openClaudeTerminal()` | `openAgentTerminal()` | Agent-neutral naming |

#### 3. Command IDs (Package.json)

**All 17 Commands Use `claudeWorktrees.*` Prefix:**

| Current ID | Target ID | Impact |
|------------|-----------|--------|
| `claudeWorktrees.createSession` | `lanes.createSession` | Command palette, keybindings |
| `claudeWorktrees.deleteSession` | `lanes.deleteSession` | Context menus |
| `claudeWorktrees.openSession` | `lanes.openSession` | Tree item clicks |
| `claudeWorktrees.setupStatusHooks` | `lanes.setupStatusHooks` | Context menus |
| `claudeWorktrees.showGitChanges` | `lanes.showGitChanges` | Inline actions |
| `claudeWorktrees.openInNewWindow` | `lanes.openInNewWindow` | Context menus |
| `claudeWorktrees.openPreviousSessionPrompt` | `lanes.openPreviousSessionPrompt` | Context menus |
| `claudeWorktrees.enableChime` | `lanes.enableChime` | Context menus |
| `claudeWorktrees.disableChime` | `lanes.disableChime` | Context menus |
| `claudeWorktrees.testChime` | `lanes.testChime` | Command palette |
| `claudeWorktrees.clearSession` | `lanes.clearSession` | Context menus |
| `claudeWorktrees.createTerminal` | `lanes.createTerminal` | Context menus |
| `claudeWorktrees.searchInWorktree` | `lanes.searchInWorktree` | Inline actions |
| `claudeWorktrees.openWorkflowState` | `lanes.openWorkflowState` | Inline actions |
| `claudeWorktrees.playChime` | `lanes.playChime` | Internal |

**Migration Strategy:** Backward-compatible aliases for one release (per user decision).

#### 4. View IDs

| Current ID | Target ID | Impact |
|------------|-----------|--------|
| `claudeSessionsView` | `lanesSessionsView` | Tree view registration |
| `claudeSessionFormView` | `lanesSessionFormView` | Webview provider |

#### 5. Direct CodeAgent Instantiation (REQ-F3)

**Current Pattern (Violates REQ-F3):**
```typescript
// extension.ts line 102
const codeAgent = new ClaudeCodeAgent();
```

**Required Pattern:**
- Services receive `CodeAgent` via dependency injection (already partially done)
- Single instantiation point in `extension.ts` (already achieved)
- No imports of `ClaudeCodeAgent` outside of factory/extension.ts

**Current Violations:**
- `extension.ts` directly imports and instantiates `ClaudeCodeAgent` (line 102)
- This is the ONLY direct instantiation (good!)
- All services receive `codeAgent` via parameters (excellent!)

**Action Required:**
- Keep current pattern (it's already correct for REQ-F3)
- Document that `ClaudeCodeAgent` import in `extension.ts` is the designated factory point
- Phase 2 will add proper factory, but Phase 1 can keep the simple instantiation

### Dependency Injection Analysis

**Services Already Following DI Pattern:**

| Service | Receives CodeAgent? | Uses Correctly? |
|---------|---------------------|-----------------|
| `SessionService.ts` | Yes (param) | Yes - passes to TerminalService |
| `TerminalService.ts` | Yes (param) | Yes - calls agent methods |
| `SettingsService.ts` | Yes (param) | Yes - calls agent methods |
| `SessionCommands.ts` | Yes (via ServiceContainer) | Yes - passes to services |

**Patterns:**
- All services receive `codeAgent?: CodeAgent` as optional parameter
- Services use fallback logic when `codeAgent` is undefined (hardcoded Claude behavior)
- This allows gradual migration and backward compatibility

### localSettings.ts Agent-Awareness

**Current State:**
- Hardcodes `.claude/settings.local.json` path (line 7-8)
- Uses fixed `CLAUDE_DIR_NAME` constant

**Required Changes:**
- Accept `CodeAgent` parameter to query config directory
- Use `codeAgent.getDataDirectory()` instead of hardcoded `.claude`
- Query agent for list of config files to propagate (future: Codex uses `config.toml`)

**Current Function Signature:**
```typescript
async function propagateLocalSettings(
    baseRepoPath: string,
    worktreePath: string,
    mode: LocalSettingsPropagationMode
): Promise<void>
```

**Target Signature:**
```typescript
async function propagateLocalSettings(
    baseRepoPath: string,
    worktreePath: string,
    mode: LocalSettingsPropagationMode,
    codeAgent: CodeAgent
): Promise<void>
```

## Implementation Patterns

### Pattern 1: File Path Operations

**Before (Hardcoded):**
```typescript
const sessionFileName = '.claude-session';
const sessionPath = path.join(dir, sessionFileName);
```

**After (Agent Method):**
```typescript
const sessionFileName = codeAgent.getSessionFileName();
const sessionPath = path.join(dir, sessionFileName);
```

**Fallback Pattern (for optional agent):**
```typescript
const sessionFileName = codeAgent?.getSessionFileName() || '.claude-session';
```

### Pattern 2: Terminal Naming

**Before:**
```typescript
const terminalName = `Claude: ${sessionName}`;
```

**After:**
```typescript
const terminalName = codeAgent.getTerminalName(sessionName);
```

**Fallback:**
```typescript
const terminalName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;
```

### Pattern 3: Watch Patterns

**Before (Hardcoded):**
```typescript
const pattern = '**/.claude-status';
```

**After (Agent Query):**
```typescript
const statusFileName = codeAgent.getStatusFileName();
const pattern = `**/${statusFileName}`;
```

### Pattern 4: Service Function Signatures

**Before:**
```typescript
export function getClaudeStatusPath(worktreePath: string): string {
    const statusFileName = globalCodeAgent?.getStatusFileName() || '.claude-status';
    // ...
}
```

**After:**
```typescript
export function getStatusFilePath(worktreePath: string, codeAgent: CodeAgent): string {
    const statusFileName = codeAgent.getStatusFileName();
    // ...
}
```

**Note:** Many functions currently use `globalCodeAgent` singleton. This pattern is acceptable for Phase 1 since there's only one agent instance, but should be documented for Phase 2 cleanup.

### Pattern 5: Type Consolidation

**Before (Duplicate Types):**
```typescript
// ClaudeSessionProvider.ts
export interface ClaudeSessionData {
    sessionId: string;
    timestamp?: string;
    workflow?: string;
    // ...
}

// CodeAgent.ts
export interface SessionData {
    sessionId: string;
    timestamp?: string;
    workflow?: string;
    agentName: string;
    // ...
}
```

**After (Use CodeAgent Types):**
```typescript
import { SessionData } from './codeAgents';

// Remove ClaudeSessionData, use SessionData everywhere
```

## Standard Session Metadata Schema

**User Decision:** Define standard JSON schema in Phase 1 that all agents write.

**Required Fields:**

```typescript
interface SessionMetadata {
    // Required
    agentType: string;           // 'claude' | 'codex' | ...
    sessionId: string;           // Agent-specific session identifier
    createdAt: string;           // ISO 8601 timestamp
    sessionName: string;         // User-friendly session name

    // Optional
    updatedAt?: string;          // ISO 8601 timestamp
    workflow?: string;           // Full path to workflow YAML
    permissionMode?: string;     // Agent-specific permission mode ID
    isChimeEnabled?: boolean;    // Audio notification preference
    taskListId?: string;         // Task list identifier
}
```

**Storage Location:**
- Global storage: `{globalStorage}/{repo-identifier}/{session-name}/session.json`
- Non-global: `.lanes/session_management/{session-name}/session.json`

**File Name:** `session.json` (agent-agnostic, not `.claude-session`)

**Migration Plan:**
- Phase 1: Read from both `.claude-session` and `session.json`, write to `session.json`
- Phase 2: Only read from `session.json`
- Phase 3: Delete `.claude-session` files during cleanup

## Command Migration Strategy

**User Decision:** Backward-compatible aliases for one release, removed in next version.

**Implementation Pattern:**

```typescript
// package.json: Register new command
{
    "command": "lanes.createSession",
    "title": "New Session"
}

// extension.ts: Register both old and new IDs
const createSessionImpl = async () => { /* ... */ };
context.subscriptions.push(
    vscode.commands.registerCommand('lanes.createSession', createSessionImpl)
);
// Backward-compatible alias (remove in next release)
context.subscriptions.push(
    vscode.commands.registerCommand('claudeWorktrees.createSession', createSessionImpl)
);
```

**Documentation Note:** Add deprecation notice in CHANGELOG for next release removal.

## File Rename Plan

### Critical Files

| Current File | Target File | Reason |
|--------------|-------------|--------|
| `ClaudeSessionProvider.ts` | `AgentSessionProvider.ts` | Main provider class |

### Source Code Updates

**All imports must be updated:**

```bash
# Find all imports
grep -r "from './ClaudeSessionProvider'" src/
grep -r "from '../ClaudeSessionProvider'" src/
```

**Expected Impact:** ~26 files importing `ClaudeSessionProvider`

**Update Pattern:**
```typescript
// Before
import { ClaudeSessionProvider } from './ClaudeSessionProvider';

// After
import { AgentSessionProvider } from './AgentSessionProvider';
```

## Testing Strategy

### Unit Tests Affected

**Files to Update:**
- `src/test/session/session-provider.test.ts` - Tests ClaudeSessionProvider
- `src/test/session/session-item.test.ts` - Tests SessionItem
- `src/test/session/session-status.test.ts` - Tests status parsing
- `src/test/core/extension-settings-hooks.test.ts` - Tests settings generation
- `src/test/config/global-storage.test.ts` - Tests storage paths

**Test Categories:**
1. **Path Generation:** Verify `getSessionFilePath()` uses agent method
2. **Service Naming:** Verify `AgentSessionProvider` instantiates correctly
3. **Command Registration:** Verify both old and new command IDs work
4. **Type Consolidation:** Verify no references to old `ClaudeSessionData` type
5. **Backward Compatibility:** Verify old command aliases forward correctly

### Integration Tests

**Scenarios:**
1. Create session with renamed services
2. Resume session using agent-agnostic paths
3. Delete session cleaning up renamed files
4. Watch pattern updates trigger refreshes
5. Terminal naming uses agent method

## Risks and Mitigations

### Risk 1: Breaking Changes in User Extensions

**Risk:** Users with custom keybindings or automation referencing `claudeWorktrees.*` commands

**Mitigation:**
- Implement backward-compatible aliases (user decision)
- Document aliases in CHANGELOG with removal timeline
- Add deprecation warnings in extension logs (optional)

### Risk 2: Test Suite Failures

**Risk:** 70+ test files may reference old naming

**Mitigation:**
- Run full test suite after each rename step
- Fix test imports incrementally
- Use find-and-replace with careful validation

### Risk 3: Global Storage Migration

**Risk:** Existing sessions stored as `.claude-session` won't be found

**Mitigation:**
- Implement dual-read logic: check `session.json` first, fallback to `.claude-session`
- Write to new format during session operations
- Phase 2 can add explicit migration command if needed

### Risk 4: VS Code API Constraints

**Risk:** View IDs and command IDs may have constraints on changes

**Mitigation:**
- Test view ID changes in development environment
- Verify command palette and context menus work correctly
- Document rollback procedure if issues arise

## Plan Breakdown

### Plan 01-01: Refactor Hardcoded File Paths and Agent Assumptions

**Scope:**
1. Update all file path operations to use CodeAgent methods
2. Consolidate types (use SessionData from CodeAgent, remove duplicates)
3. Update localSettings.ts to be agent-aware
4. Update watch patterns to use agent methods
5. Implement standard session metadata schema

**Files Modified:**
- `src/ClaudeSessionProvider.ts` - Path functions use agent methods
- `src/services/SettingsService.ts` - Watch patterns from agent
- `src/services/TerminalService.ts` - Naming from agent
- `src/services/SessionService.ts` - Path operations from agent
- `src/commands/sessionCommands.ts` - Terminal naming from agent
- `src/localSettings.ts` - Add CodeAgent parameter
- `src/watchers.ts` - Watch patterns from agent

**Success Criteria:**
- No hardcoded `.claude-session` or `.claude-status` strings outside agent classes
- All file paths constructed through agent method calls
- localSettings.ts accepts and uses CodeAgent for directory queries

### Plan 01-02: Rename Services and Establish Clean Abstraction Boundary

**Scope:**
1. Rename `ClaudeSessionProvider` to `AgentSessionProvider` and update all imports
2. Rename exported functions to agent-neutral names
3. Update command IDs in package.json with backward-compatible aliases
4. Update view IDs and registrations
5. Document factory pattern for CodeAgent instantiation

**Files Modified:**
- Rename: `src/ClaudeSessionProvider.ts` → `src/AgentSessionProvider.ts`
- `package.json` - Command IDs and view IDs
- `src/extension.ts` - Command registrations with aliases, view registrations
- All imports (~26 files)

**Success Criteria:**
- All services have agent-neutral names
- Command palette shows new `lanes.*` commands
- Old `claudeWorktrees.*` commands still work as aliases
- All imports compile without errors

## Dependencies

### External Dependencies

None - all changes are internal refactoring.

### Phase Dependencies

- **Blocks:** Phase 2 (Agent Abstraction Enhancement) requires clean foundation
- **Depends on:** Nothing (first phase)

## Estimated Effort

| Task | Estimated Hours | Complexity |
|------|----------------|------------|
| Plan 01-01: File path refactoring | 4-6 | Medium |
| Plan 01-02: Service renaming | 6-8 | High (many imports) |
| Test suite updates | 4-6 | Medium |
| Documentation | 2-3 | Low |
| **Total** | **16-23 hours** | **High** |

**Complexity Factors:**
- High: 26+ imports to update for file rename
- Medium: Watch pattern updates across multiple files
- Medium: Dual-read logic for backward compatibility
- Low: Command aliases (straightforward)

## Key Decisions Required

### Decision 1: Session Metadata Format

**Status:** ✅ Decided (from context)
- Use standard JSON schema defined above
- All agents write same format
- File name: `session.json` (not agent-specific)

### Decision 2: Migration Approach

**Status:** ✅ Decided (from context)
- Backward-compatible aliases for one release
- One commit per plan (01-01 gets one commit, 01-02 gets one commit)

### Decision 3: CodeAgent Abstraction Enhancements

**Status:** ✅ Decided (from context)
- Add new abstract methods when alternative is worse hack
- Example: `getSessionFilePath()` if needed
- Otherwise refactor consumers to use existing abstraction

## Implementation Notes

### Commit Strategy

**Per User Decision:** One commit per plan

**Plan 01-01 Commit:**
```
refactor(core): eliminate hardcoded file paths and agent assumptions

- Replace hardcoded .claude-session/.claude-status with agent method calls
- Update localSettings.ts to query agent for config directory
- Consolidate types: use SessionData from CodeAgent
- Update watch patterns to use agent queries
- Implement standard session metadata schema

Refs: REQ-F1

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

**Plan 01-02 Commit:**
```
refactor(core): rename services and establish agent-agnostic naming

- Rename ClaudeSessionProvider → AgentSessionProvider
- Rename command IDs claudeWorktrees.* → lanes.* with backward-compatible aliases
- Rename view IDs to agent-neutral names
- Update all imports across codebase
- Document CodeAgent instantiation pattern

Refs: REQ-F2, REQ-F3

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

### Pre-commit Hook Verification

**Required Checks:**
- `npm run compile` - TypeScript compilation
- `npm run lint` - ESLint validation
- `npm test` - Full test suite

**Expected Test Updates:**
- Session provider tests: Update class names
- Path generation tests: Verify agent method usage
- Command tests: Verify both old and new IDs work

### Documentation Updates

**Files to Update:**
- `CLAUDE.md` - Update class names in "Key Files" table
- `CHANGELOG.md` - Add entry for command alias deprecation
- `README.md` - Update any code examples using old names

## Success Metrics

### Completion Criteria

1. ✅ **REQ-F1:** No "claude" string literals outside agent classes (except imports)
2. ✅ **REQ-F2:** Services use generic names (SessionProvider, not ClaudeSessionProvider)
3. ✅ **REQ-F3:** Services receive CodeAgent via dependency injection
4. ✅ All file paths constructed through agent method calls
5. ✅ All tests pass without modification to test logic (only names)
6. ✅ Command aliases work in command palette
7. ✅ Extension compiles without errors
8. ✅ Pre-commit hooks pass

### Verification Commands

```bash
# Verify no hardcoded paths outside agent classes
grep -r '\.claude-session' src/ --exclude-dir=codeAgents
grep -r '\.claude-status' src/ --exclude-dir=codeAgents
grep -r '"Claude: "' src/ --exclude-dir=codeAgents

# Verify command IDs updated
grep 'claudeWorktrees\.' package.json  # Should find aliases
grep 'lanes\.' package.json            # Should find new IDs

# Verify imports updated
grep -r "ClaudeSessionProvider" src/   # Should only find in AgentSessionProvider.ts

# Run test suite
npm test
```

## Next Steps

After Phase 1 completion:
1. **Phase 2:** Implement agent factory with VS Code setting
2. **Phase 3:** Add Codex CLI integration
3. **Phase 4:** UI integration for agent selection

## References

### Key Files Analyzed

- `src/extension.ts` (287 lines) - Main entry point, direct instantiation
- `src/ClaudeSessionProvider.ts` (442 lines) - Session provider, path functions
- `src/codeAgents/CodeAgent.ts` (387 lines) - Abstract base class
- `src/codeAgents/ClaudeCodeAgent.ts` (334 lines) - Claude implementation
- `src/services/SessionService.ts` (496 lines) - Session creation logic
- `src/services/TerminalService.ts` (380 lines) - Terminal management
- `src/services/SettingsService.ts` (343 lines) - Settings and watch patterns
- `src/localSettings.ts` (71 lines) - Local settings propagation
- `src/commands/sessionCommands.ts` (600+ lines) - Command implementations
- `src/watchers.ts` (200+ lines) - File system watchers
- `package.json` - Extension manifest with commands

### User Decisions Document

- `.planning/phases/01-foundation-refactoring/CONTEXT.md`

### Requirements Document

- `.planning/REQUIREMENTS.md`

### Roadmap Document

- `.planning/ROADMAP.md`

---

**Research Completed:** 2026-02-10
**Ready for Planning:** Yes
**Blockers:** None
