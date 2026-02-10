# Phase 3: Codex CLI Integration - Research

**Researched:** 2026-02-10
**Domain:** Codex CLI command structure, shell escaping, session management, permission modes
**Confidence:** MEDIUM

## Summary

Phase 3 implements the CodexAgent stub created in Phase 2 into a fully functional code agent. The primary technical challenge is command construction with proper shell escaping, permission mode mapping to Codex's dual-flag system (--sandbox + --ask-for-approval), and session ID capture without hooks. Codex differs from Claude in three fundamental ways: (1) no hook system for session tracking, (2) TOML configuration format (though Phase 3 uses inline flags only), and (3) two-flag permission system instead of single-flag modes.

Research reveals that Codex CLI follows standard patterns for sandbox permissions and approval policies, with well-documented flag combinations. Session IDs use UUID format (matching Claude), are displayed via `/status` command, and stored in `~/.codex/sessions/` directory. However, session ID capture without hooks is challenging because VS Code's terminal API doesn't support output capturing without proposed APIs. The recommended approach is using `~/.codex/sessions/` filesystem inspection or external commands like `codex status` executed via child_process.

**Primary recommendation:** Use Codex's well-documented `--sandbox` and `--ask-for-approval` flags for permission modes. Map UI labels to match Claude terminology ("Accept Edits" / "Bypass Permissions") for consistency. Capture session IDs by reading the most recent session file from `~/.codex/sessions/` directory after terminal startup, with strict error handling (no silent `--last` fallback per user decision). Use single-quote shell escaping pattern established by ClaudeCodeAgent (`'\\''` replacement).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Permission mode mapping:**
- Two permission modes only, matching Claude's pattern: a default mode and a bypass mode
- Default mode ("Accept Edits" label): `--sandbox workspace-write --ask-for-approval on-failure`
- Bypass mode ("Bypass Permissions" label): `--sandbox danger-full-access --ask-for-approval never`
- UI labels match Claude's terminology ("Accept Edits" / "Bypass Permissions") for consistency across agents, even though underlying flags differ
- Permission modes are passed as CLI flags, not via config file

**Session resume strategy:**
- Strict behavior: if session ID capture fails, show error to user — no silent `--last` fallback
- Error message should suggest starting a new session (not manual resume instructions)
- Resume terminal behavior should match whatever Claude Code sessions do (parity between agents)
- Session ID capture method: Claude's discretion (terminal output parsing or codex history command — pick most reliable approach)

**TOML config generation:**
- No config file generated — all settings passed as inline CLI flags (`--sandbox`, `--ask-for-approval`)
- Only permission flags are passed; user's global `~/.codex/config.toml` handles everything else (model, MCP servers, etc.)
- The SettingsFormatService TOML support from Phase 2 is not used for Codex in this phase — it stays in the codebase but is effectively unused for now
- No local settings propagation for Codex config files in this phase

### Claude's Discretion
- Session ID capture mechanism (terminal output parsing vs codex history command)
- CLI command construction details (flag ordering, shell escaping approach)
- Terminal icon and naming for Codex sessions (blue icon was set in Phase 2 stub)
- How to handle the SettingsService integration given no config file is generated

### Deferred Ideas (OUT OF SCOPE)
- Local settings propagation for `~/.codex/config.toml` to worktrees — could be added later
- Model selection per session (passing `-m` flag) — could be a future enhancement
- MCP server configuration for Codex sessions — not needed in this milestone
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Codex CLI | Latest | OpenAI's CLI agent | Target agent being integrated |
| TypeScript | 5.9+ | Type safety | Already in use, VS Code extension requirement |
| VS Code API | 1.75+ | Extension platform | Project's minimum engine version |
| Node.js child_process | Built-in | CLI execution, session ID queries | Standard for process spawning |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js fs/promises | Built-in | Session file inspection | For reading `~/.codex/sessions/` directory |
| os.homedir() | Built-in | Home directory path | Resolving `~/.codex/sessions/` path |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Filesystem inspection | VS Code's onDidWriteTerminalData | onDidWriteTerminalData is "forever proposed API" — unstable, requires enableProposedApi flag, not recommended for production |
| Filesystem inspection | Parse terminal output | Terminal output parsing fragile to format changes, no official capture API available |
| UUID validation | Accept any session ID format | Codex uses UUID format (confirmed), validation prevents command injection |

**Installation:**
```bash
# Codex CLI (user must install separately)
npm install -g codex-cli

# No additional dependencies needed - using Node.js built-ins
```

## Architecture Patterns

### Recommended Project Structure
```
src/
├── codeAgents/
│   ├── CodeAgent.ts              # Abstract base (already exists)
│   ├── ClaudeCodeAgent.ts        # Claude implementation (reference)
│   └── CodexAgent.ts             # Codex implementation (UPDATE from stub)
├── services/
│   ├── TerminalService.ts        # Terminal creation/resume logic
│   └── SessionService.ts         # Session ID capture helpers (if needed)
└── test/
    └── codeAgents/
        └── CodexAgent.test.ts    # Unit tests for CodexAgent
```

### Pattern 1: Dual-Flag Permission Mapping

**What:** Map high-level permission modes to Codex's two-flag system (--sandbox + --ask-for-approval)

**When to use:** When the CLI requires multiple flags to express a single permission concept

**Example:**
```typescript
// src/codeAgents/CodexAgent.ts

getPermissionModes(): PermissionMode[] {
    return [
        {
            id: 'acceptEdits',
            label: 'Accept Edits',
            flag: '--sandbox workspace-write --ask-for-approval on-failure'
        },
        {
            id: 'bypassPermissions',
            label: 'Bypass Permissions',
            flag: '--sandbox danger-full-access --ask-for-approval never'
        }
    ];
}

getPermissionFlag(mode: string): string {
    const permissionMode = this.getPermissionModes().find(m => m.id === mode);
    return permissionMode?.flag || '';
}

buildStartCommand(options: StartCommandOptions): string {
    const parts: string[] = [this.config.cliCommand];

    // Add permission flags (both --sandbox and --ask-for-approval)
    if (options.permissionMode) {
        const flag = this.getPermissionFlag(options.permissionMode);
        if (flag) {
            parts.push(flag); // Flag is pre-combined string
        }
    }

    // Add prompt with shell escaping
    if (options.prompt) {
        const escapedPrompt = this.escapeForSingleQuotes(options.prompt);
        parts.push(`'${escapedPrompt}'`);
    }

    return parts.join(' ');
}
```

**Why this pattern:**
- Encapsulates the complexity of dual-flag system
- UI shows user-friendly labels matching Claude terminology
- Permission mode ID ('acceptEdits') maps to multiple CLI flags
- Easy to add more modes (e.g., read-only) without changing callers

### Pattern 2: Session ID Capture via Filesystem Inspection

**What:** Read most recent session file from `~/.codex/sessions/` directory after terminal startup

**When to use:** When agent lacks hooks and terminal output capture isn't available

**Example:**
```typescript
// src/codeAgents/CodexAgent.ts or src/services/SessionService.ts

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Capture Codex session ID by reading most recent session file.
 * Codex stores session files in ~/.codex/sessions/ as JSONL files.
 *
 * Strategy:
 * 1. List files in ~/.codex/sessions/
 * 2. Find most recently modified file
 * 3. Read first line (JSONL format)
 * 4. Extract session ID from JSON
 *
 * @param timeoutMs Maximum time to wait for session file (default: 5000ms)
 * @returns Session ID string (UUID format) or null if capture fails
 */
async function captureCodexSessionId(timeoutMs: number = 5000): Promise<string | null> {
    const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');
    const startTime = Date.now();

    try {
        // Poll for new session file (Codex creates it on startup)
        while (Date.now() - startTime < timeoutMs) {
            const files = await fs.readdir(sessionsDir);

            // Get file stats to find most recent
            const fileStats = await Promise.all(
                files.map(async (file) => {
                    const filePath = path.join(sessionsDir, file);
                    const stat = await fs.stat(filePath);
                    return { file, mtime: stat.mtime };
                })
            );

            // Sort by modification time (newest first)
            fileStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

            if (fileStats.length > 0) {
                const latestFile = path.join(sessionsDir, fileStats[0].file);
                const content = await fs.readFile(latestFile, 'utf-8');

                // JSONL format: first line contains session metadata
                const firstLine = content.split('\n')[0];
                const data = JSON.parse(firstLine);

                // Extract session ID (format TBD - likely in a standard field)
                // This assumes session ID is in a field like "session_id" or "id"
                const sessionId = data.session_id || data.id;

                if (sessionId && typeof sessionId === 'string') {
                    // Validate UUID format to prevent injection
                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    if (uuidRegex.test(sessionId)) {
                        return sessionId;
                    }
                }
            }

            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        return null; // Timeout
    } catch (err) {
        console.error('Failed to capture Codex session ID:', err);
        return null;
    }
}
```

**Why this pattern:**
- Reliable: Doesn't depend on terminal output format or proposed APIs
- Race-condition aware: Polls with timeout to allow file creation
- Secure: Validates UUID format to prevent injection
- Testable: Can be unit tested with mock filesystem

**Alternative considered:**
- Using `codex status` command via child_process and parsing output
- Tradeoff: Requires spawning process, parsing text output, but avoids filesystem polling

### Pattern 3: Shell Escaping for Single Quotes

**What:** Escape user input for safe use in shell single quotes

**When to use:** When constructing shell commands with user-provided strings (prompts, paths)

**Example:**
```typescript
// Source: ClaudeCodeAgent.ts (established pattern in codebase)

private escapeForSingleQuotes(str: string): string {
    // Replace single quote with '\''
    // This closes the quote, adds an escaped quote, and reopens the quote
    return str.replace(/'/g, "'\\''");
}

// Usage in command building
buildStartCommand(options: StartCommandOptions): string {
    const parts: string[] = [this.config.cliCommand];

    if (options.prompt) {
        const escapedPrompt = this.escapeForSingleQuotes(options.prompt);
        parts.push(`'${escapedPrompt}'`);
    }

    return parts.join(' ');
}
```

**Why this pattern:**
- Industry standard: `'\\''` is the POSIX-compliant way to escape single quotes
- Already used: ClaudeCodeAgent uses this exact pattern
- Consistent: Same escaping approach across all agents
- Secure: Prevents command injection

**Source:** ClaudeCodeAgent implementation (lines 89-91)

### Anti-Patterns to Avoid

- **No config file generation**: Don't generate `.codex/config.toml` files in this phase — user decision defers this
- **No silent fallbacks**: Don't silently use `codex resume --last` when session ID capture fails — show error instead (user decision)
- **No output parsing**: Don't use VS Code's proposed `onDidWriteTerminalData` API — it's unstable and requires enableProposedApi flag
- **No assumption of global availability**: Don't assume Codex is installed — factory should validate CLI availability

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shell escaping | Custom regex/replacement logic | Established `'\\''` pattern from ClaudeCodeAgent | Industry standard, already proven in codebase |
| Session ID validation | Custom format checks | UUID regex pattern from ClaudeCodeAgent | Same format as Claude (UUID), prevents injection |
| Terminal output capture | Custom terminal monitoring | Filesystem inspection of `~/.codex/sessions/` | No official API available, filesystem is reliable |
| Permission mapping | Switch statements in callers | PermissionMode interface with flag property | Encapsulates dual-flag complexity, type-safe |

**Key insight:** The CodeAgent abstraction and ClaudeCodeAgent implementation provide proven patterns for all core functionality. CodexAgent should follow the same architectural approach with only CLI-specific differences (dual flags, filesystem session capture).

## Common Pitfalls

### Pitfall 1: Assuming Terminal Output Capture is Available

**What goes wrong:** Attempting to use VS Code's `onDidWriteTerminalData` API causes extension to fail or require unstable proposed APIs

**Why it happens:** The API is documented in VS Code types but is "forever proposed" — not publicly stable

**How to avoid:** Use filesystem inspection of `~/.codex/sessions/` directory instead

**Warning signs:** Extension requires `enableProposedApi` flag, terminal output capture returns undefined

**Source:** [GitHub Issue #83224](https://github.com/microsoft/vscode/issues/83224) shows onDidWriteTerminalData is still proposed as of 2026

### Pitfall 2: Silent Fallback to `--last` on Capture Failure

**What goes wrong:** User expects to resume specific session but gets most recent session instead (may be from different directory/context)

**Why it happens:** Temptation to provide "graceful degradation" when session ID capture fails

**How to avoid:** Follow user decision: strict error handling with message suggesting to start new session

**Warning signs:** Users report sessions resuming incorrectly, cross-directory session confusion

### Pitfall 3: Forgetting Dual-Flag Permission System

**What goes wrong:** Passing only `--sandbox` flag without `--ask-for-approval`, resulting in unexpected approval behavior

**Why it happens:** Claude uses single flag (`--permission-mode acceptEdits`), easy to assume same pattern

**How to avoid:** Store combined flag string in PermissionMode.flag property: `"--sandbox workspace-write --ask-for-approval on-failure"`

**Warning signs:** Permission mode set but Codex still prompts unexpectedly, or doesn't prompt when it should

### Pitfall 4: Config File Generation Premature Implementation

**What goes wrong:** Implementing TOML config file generation when user decided to defer it

**Why it happens:** Phase 2 added TOML support to SettingsFormatService, seems like natural next step

**How to avoid:** Remember user decision: "No config file generated — all settings passed as inline CLI flags"

**Warning signs:** Creating `.codex/config.toml` files in worktrees, using SettingsFormatService.writeTomlSettings()

### Pitfall 5: Missing Session ID Validation

**What goes wrong:** Session IDs from filesystem used directly in shell commands without validation, enabling command injection

**Why it happens:** Trust in filesystem content, forgetting session ID becomes part of shell command

**How to avoid:** Always validate session ID matches UUID format before using in buildResumeCommand()

**Warning signs:** No regex validation in parseSessionData() or buildResumeCommand()

**Source:** ClaudeCodeAgent.validateSessionId() provides reference implementation (lines 97-101)

## Code Examples

Verified patterns from existing codebase and official Codex documentation:

### Codex Start Command Construction

```typescript
// src/codeAgents/CodexAgent.ts

buildStartCommand(options: StartCommandOptions): string {
    const parts: string[] = [this.config.cliCommand]; // 'codex'

    // Add permission mode flags (both --sandbox and --ask-for-approval)
    if (options.permissionMode) {
        const flag = this.getPermissionFlag(options.permissionMode);
        if (flag) {
            parts.push(flag);
        }
    }

    // Add prompt with shell escaping (same as Claude)
    if (options.prompt) {
        const escapedPrompt = this.escapeForSingleQuotes(options.prompt);
        parts.push(`'${escapedPrompt}'`);
    }

    return parts.join(' ');
}

// Example output: "codex --sandbox workspace-write --ask-for-approval on-failure 'Implement user authentication'"
```

**Source:** Codex CLI [command reference](https://developers.openai.com/codex/cli/reference/) - flags are official and documented

### Codex Resume Command Construction

```typescript
// src/codeAgents/CodexAgent.ts

buildResumeCommand(sessionId: string, options: ResumeCommandOptions): string {
    // Validate session ID to prevent injection (same as Claude)
    this.validateSessionId(sessionId);

    const parts: string[] = [this.config.cliCommand]; // 'codex'

    // Codex resume format: "codex resume <SESSION_ID>"
    parts.push('resume', sessionId);

    return parts.join(' ');
}

// Example output: "codex resume 7f9f9a2e-1b3c-4c7a-9b0e-8d2f1e4b5c6a"
```

**Source:** Codex CLI [features documentation](https://developers.openai.com/codex/cli/features/) - resume command format

### Session ID Validation (Injection Prevention)

```typescript
// Source: ClaudeCodeAgent.ts lines 97-101

private validateSessionId(sessionId: string): void {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(sessionId)) {
        throw new Error(`Invalid session ID format: ${sessionId}. Expected UUID format.`);
    }
}
```

**Source:** ClaudeCodeAgent implementation - Codex uses same UUID format for session IDs

### Permission Mode Mapping

```typescript
// src/codeAgents/CodexAgent.ts

getPermissionModes(): PermissionMode[] {
    return [
        {
            id: 'acceptEdits',
            label: 'Accept Edits',
            flag: '--sandbox workspace-write --ask-for-approval on-failure'
        },
        {
            id: 'bypassPermissions',
            label: 'Bypass Permissions',
            flag: '--sandbox danger-full-access --ask-for-approval never'
        }
    ];
}
```

**Source:** User decision from CONTEXT.md + Codex [security documentation](https://developers.openai.com/codex/security/)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `--full-auto` shorthand | Explicit `--sandbox` + `--ask-for-approval` | Still current | Use explicit flags for clarity and control |
| Session ID from terminal prompt | Session ID from `~/.codex/sessions/` directory | No change needed | JSONL format in sessions directory is stable |
| Hardcoded permission modes | Agent-defined permission modes | Phase 2 (2026-02-10) | CodeAgent.getPermissionModes() abstracts per-agent modes |
| Single agent support | Multi-agent with factory | Phase 2 (2026-02-10) | Factory pattern enables agent selection |

**Deprecated/outdated:**
- **N/A for this phase** - Codex CLI is relatively new, no deprecated features found in research

**Current as of 2026-02:**
- `--sandbox` values: `read-only`, `workspace-write`, `danger-full-access`
- `--ask-for-approval` values: `untrusted`, `on-failure`, `on-request`, `never`
- Session resume: `codex resume [SESSION_ID]` or `codex resume --last`
- `/status` command shows session ID and config

## Open Questions

### 1. **Session File Field Name for Session ID**

**What we know:**
- Codex stores sessions in `~/.codex/sessions/` as JSONL files
- First line contains session metadata
- Format likely includes session ID field

**What's unclear:**
- Exact field name for session ID (`session_id`, `id`, `sessionId`, etc.)
- Whether first line always contains session ID or requires scanning
- Timing: how quickly is file created after `codex` command starts

**Recommendation:**
- Implement polling approach with 5-second timeout
- Try multiple field names (`session_id`, `id`, `sessionId`)
- Add debug logging to capture actual format when testing
- Document finding in code comments for future reference

**Confidence:** LOW (needs empirical verification)

### 2. **Session ID Capture Timing**

**What we know:**
- Codex creates session file on startup
- File is JSONL format updated throughout session

**What's unclear:**
- Exact timing of file creation relative to terminal startup
- Whether file exists but is empty initially
- Optimal polling interval and timeout

**Recommendation:**
- Start with 500ms polling interval, 5-second timeout
- Make configurable if needed based on testing
- Show clear error message on timeout (user decision: no silent fallback)

**Confidence:** MEDIUM (polling strategy is proven, just needs tuning)

### 3. **Resume Terminal Behavior Parity**

**What we know:**
- User decision: "Resume terminal behavior should match whatever Claude Code sessions do"
- Claude resume uses hooks to restore session state

**What's unclear:**
- Exact definition of "parity" — UX flow, terminal naming, status handling?
- Whether Codex resume has different UX that's acceptable

**Recommendation:**
- Test both Claude and Codex resume flows
- Match terminal naming pattern ("Codex: session-name")
- Match status file updates (active on open, idle on close)
- Document any unavoidable differences

**Confidence:** MEDIUM (high-level pattern clear, details need verification)

### 4. **Error Handling for Missing Codex CLI**

**What we know:**
- Factory should validate CLI availability (Phase 2 decision)
- `command -v codex` or similar check needed

**What's unclear:**
- Whether to check on factory creation or lazily on first use
- Error message wording and user guidance

**Recommendation:**
- Check on factory creation (fail fast)
- Return null from factory with VS Code warning notification
- Message: "Codex CLI not found. Install with: npm install -g codex-cli"
- Fall back to Claude as default agent

**Confidence:** HIGH (standard pattern)

## Sources

### Primary (HIGH confidence)

- [Codex CLI Command Reference](https://developers.openai.com/codex/cli/reference/) - Official flag documentation
- [Codex Security Documentation](https://developers.openai.com/codex/security/) - Sandbox and approval policy details
- [Codex CLI Features](https://developers.openai.com/codex/cli/features/) - Session resume and management
- [Codex Slash Commands](https://developers.openai.com/codex/cli/slash-commands/) - `/status` command documentation
- ClaudeCodeAgent.ts implementation - Reference patterns for shell escaping, UUID validation

### Secondary (MEDIUM confidence)

- [SmartScope: Codex CLI Approval Modes](https://smartscope.blog/en/generative-ai/chatgpt/codex-cli-approval-modes-no-approval/) - Flag combinations verified against official docs
- [Vincent Schmalbach: Codex CLI Flags](https://www.vincentschmalbach.com/how-codex-cli-flags-actually-work-full-auto-sandbox-and-bypass/) - Community verification of flag behavior
- [Inventive HQ: Resume Sessions](https://inventivehq.com/knowledge-base/openai/how-to-resume-sessions) - Resume command patterns

### Tertiary (LOW confidence - needs verification)

- [GitHub Issue #8923](https://github.com/openai/codex/issues/8923) - Feature request for programmatic session ID access (confirms filesystem approach is current workaround)
- [GitHub Issue #6360](https://github.com/openai/codex/issues/6360) - `/status` command behavior issues (multi-session scenarios)
- [VS Code API onDidWriteTerminalData](https://github.com/microsoft/vscode/issues/83224) - Proposed API status (confirms it's unstable)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Codex CLI is official OpenAI tool, flags are well-documented
- Architecture: MEDIUM - Patterns proven in ClaudeCodeAgent but Codex-specific session capture needs empirical testing
- Pitfalls: MEDIUM - Based on official docs and existing codebase, but some edge cases untested
- Session ID capture: LOW - Filesystem polling strategy is sound but exact JSONL format needs verification

**Research date:** 2026-02-10
**Valid until:** 30 days (March 2026) - Codex CLI is stable, but feature additions possible
