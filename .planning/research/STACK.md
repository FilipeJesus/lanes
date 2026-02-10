# Stack Research - Codex CLI Integration

**Domain:** VS Code extension supporting multiple CLI code agents
**Researched:** 2026-02-10
**Confidence:** MEDIUM

## Executive Summary

OpenAI Codex CLI is a lightweight coding agent that runs in the terminal, similar to Claude Code but with significant architectural and configuration differences. The integration requires implementing a CodexCodeAgent class that handles TOML-based configuration (vs Claude's JSON), different CLI flag patterns for permissions/sandbox modes, a different session management approach (rollout files + SQLite vs JSON status files), and a different MCP configuration format.

**Critical difference:** Codex does not support hook events like Claude Code's SessionStart, PostToolUse, etc. Session tracking and state management must be implemented through file system monitoring and SQLite database queries rather than event-driven hooks.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Codex CLI | Latest (0.39.x+) | CLI code agent | Official OpenAI coding agent with MCP support |
| TOML | Standard | Configuration format | Codex uses TOML for all configuration (not JSON) |
| Node.js fs | Native | File monitoring | Watch rollout files and SQLite DB for session state changes |
| better-sqlite3 | ^9.0.0 | SQLite access | Query Codex's session database for state information |
| @iarna/toml | ^2.2.5 | TOML parsing/writing | Generate and modify config.toml programmatically |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| chokidar | ^3.5.3 | File watching | Monitor ~/.codex/sessions/ for new rollout files |
| uuid | ^9.0.0 | Session ID validation | Validate UUID format for session IDs |
| jsonlines | ^0.1.1 | JSONL parsing | Parse rollout-*.jsonl session transcripts |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TOML Language Support | VS Code extension for TOML syntax | Helps when debugging config.toml generation |
| SQLite Viewer | VS Code extension | Inspect Codex's session database during development |

## Installation

```bash
# Core
npm install @iarna/toml uuid

# Supporting (for session monitoring)
npm install chokidar jsonlines better-sqlite3

# Dev dependencies
npm install -D @types/better-sqlite3
```

## Codex CLI Command Reference

### Start Command Structure

```bash
codex [OPTIONS] [PROMPT]
```

**Core flags:**
```bash
# Configuration
--config <KEY=VALUE>           # Override config key (TOML dot notation)
--profile <PROFILE_NAME>       # Load named profile from config.toml
-c <PATH>                      # Path to config.toml file

# Sandbox mode (what Codex can do technically)
--sandbox <MODE>               # read-only | workspace-write | danger-full-access
--full-auto                    # Shortcut for --sandbox workspace-write --ask-for-approval on-request
--dangerously-bypass-approvals-and-sandbox  # Skip all safety (alias: --yolo)

# Approval policy (when to ask before executing)
--ask-for-approval <POLICY>    # never | on-request | untrusted
-a <POLICY>                    # Shorthand for --ask-for-approval

# Initial prompt
--prompt <TEXT>                # Initial instruction
--prompt -                     # Read prompt from stdin

# MCP configuration
# No dedicated flag - MCP servers configured in config.toml only
```

**Example start commands:**
```bash
# Interactive with workspace-write and on-request approvals
codex --full-auto

# Non-interactive with specific prompt
codex --prompt "analyze this codebase"

# Using a profile with custom prompt
codex --profile production --prompt "fix the bug in login"

# Override specific config for this run
codex --config 'sandbox_workspace_write.network_access=true'
```

### Resume Command Structure

```bash
codex resume [OPTIONS] [SESSION_ID]
```

**Resume variations:**
```bash
codex resume                   # Launch picker of recent sessions
codex resume --last            # Resume most recent session from current directory
codex resume --all             # Show sessions from all directories
codex resume <SESSION_ID>      # Resume specific session (UUID format)
```

**Session ID format:** UUID (e.g., `7f9f9a2e-1b3c-4c7a-9b0e-426614174000`)

**Example resume commands:**
```bash
# Resume with picker
codex resume

# Resume last session
codex resume --last

# Resume specific session with profile
codex --profile deep-review resume 7f9f9a2e-1b3c-4c7a-9b0e-426614174000
```

## Config.toml Structure

### File Locations

| Location | Purpose | Trust Required |
|----------|---------|----------------|
| `~/.codex/config.toml` | User-level defaults | Always loaded |
| `.codex/config.toml` | Project-scoped overrides | Only loaded for trusted projects |

### Configuration Precedence

```
CLI flags > Project .codex/config.toml > User ~/.codex/config.toml > Defaults
```

### Complete TOML Structure

```toml
# Top-level settings
profile = "default"                    # Default profile to use
model = "gpt-5.3-codex"               # Default model
history_persistence = "save-all"       # save-all | none

# Sandbox configuration
[sandbox_workspace_write]
network_access = false                 # Allow network access in workspace-write mode
allowed_domains = []                   # Whitelist domains for network access

[sandbox_read_only]
network_access = false

[sandbox_danger_full_access]
network_access = true

# Approval policy
approval_policy = "on-request"         # never | on-request | untrusted

# Shell environment
[shell_environment_policy]
include_only = ["PATH", "HOME"]       # Only forward these env vars to shell commands

# MCP Servers Configuration
[mcp_servers."server-name"]
command = "node"                       # Command to start server
args = ["/path/to/server.js"]         # Arguments array
startup_timeout_sec = 30               # Timeout for server startup (default: 10)
tool_timeout_sec = 60                  # Timeout for tool execution (default: 60)
enabled = true                         # Enable/disable without deleting (default: true)
env_vars = ["API_KEY", "BASE_URL"]    # Environment variables to forward

# Optional: static environment variables for this MCP server
[mcp_servers."server-name".env]
BASE_URL = "https://api.example.com"

# Profile configuration
[profiles.production]
model = "gpt-5.3-codex"
approval_policy = "on-request"
sandbox_workspace_write.network_access = false

[profiles.deep-review]
model = "gpt-5.3-codex"
approval_policy = "never"
sandbox_workspace_write.network_access = true
```

### Generating config.toml Programmatically

```typescript
import TOML from '@iarna/toml';
import * as fs from 'fs';
import * as path from 'path';

interface CodexMcpServer {
  command: string;
  args: string[];
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled?: boolean;
  env_vars?: string[];
  env?: Record<string, string>;
}

interface CodexConfig {
  profile?: string;
  model?: string;
  history_persistence?: 'save-all' | 'none';
  approval_policy?: 'never' | 'on-request' | 'untrusted';
  mcp_servers?: Record<string, CodexMcpServer>;
  profiles?: Record<string, any>;
  sandbox_workspace_write?: {
    network_access?: boolean;
    allowed_domains?: string[];
  };
}

function generateCodexConfig(worktreePath: string, mcpServerPath: string): CodexConfig {
  return {
    approval_policy: 'on-request',
    mcp_servers: {
      'lanes-workflow': {
        command: 'node',
        args: [
          mcpServerPath,
          '--worktree', worktreePath,
          '--workflow-path', path.join(worktreePath, 'workflow-state.json'),
          '--repo-root', path.dirname(worktreePath)
        ],
        startup_timeout_sec: 30,
        enabled: true
      }
    }
  };
}

function writeCodexConfig(configPath: string, config: CodexConfig): void {
  const tomlString = TOML.stringify(config as any);
  fs.writeFileSync(configPath, tomlString, 'utf-8');
}

// Example usage
const config = generateCodexConfig('/path/to/worktree', '/path/to/mcp/server.js');
writeCodexConfig('/path/to/worktree/.codex/config.toml', config);
```

## Session Management

### Session ID Format and Capture

**Format:** UUID (RFC 4122)
- Pattern: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
- Example: `7f9f9a2e-1b3c-4c7a-9b0e-426614174000`

**Capture Methods:**

1. **From rollout files** (Recommended):
   - Location: `~/.codex/sessions/YYYY/MM/DD/rollout-<SESSION_ID>.jsonl`
   - Extract session ID from filename
   - Monitor directory for new files using chokidar

2. **From /status command output**:
   - User runs `/status` in Codex CLI
   - Parse output to extract session ID
   - Not reliable for programmatic capture

3. **From SQLite database**:
   - Location: `~/.codex/state.db` (or versioned: `state-v2.db`)
   - Query sessions table for active sessions
   - More complex but most reliable

**No native environment variable support** - As of early 2026, Codex does not expose `CODEX_SESSION_ID` or similar environment variables. Feature request exists but not implemented.

### Session State Tracking

Unlike Claude Code (which uses hooks), Codex requires **polling-based state detection**:

```typescript
import chokidar from 'chokidar';
import * as path from 'path';
import * as os from 'os';

interface CodexSessionState {
  sessionId: string;
  state: 'working' | 'waiting' | 'idle';
  lastActivity: Date;
}

class CodexSessionMonitor {
  private sessionStates = new Map<string, CodexSessionState>();
  private watcher: chokidar.FSWatcher | null = null;

  startMonitoring(workingDirectory: string): void {
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    const sessionsDir = path.join(codexHome, 'sessions');

    // Watch for new rollout files
    this.watcher = chokidar.watch(`${sessionsDir}/**/*.jsonl`, {
      persistent: true,
      ignoreInitial: false
    });

    this.watcher
      .on('add', (filePath) => this.handleNewSession(filePath))
      .on('change', (filePath) => this.handleSessionUpdate(filePath));
  }

  private handleNewSession(filePath: string): void {
    const sessionId = this.extractSessionIdFromPath(filePath);
    if (sessionId) {
      this.sessionStates.set(sessionId, {
        sessionId,
        state: 'working',
        lastActivity: new Date()
      });
    }
  }

  private handleSessionUpdate(filePath: string): void {
    const sessionId = this.extractSessionIdFromPath(filePath);
    if (sessionId) {
      const state = this.sessionStates.get(sessionId);
      if (state) {
        state.lastActivity = new Date();
        // Analyze last few lines of JSONL to determine state
        state.state = this.inferStateFromJSONL(filePath);
      }
    }
  }

  private extractSessionIdFromPath(filePath: string): string | null {
    const match = filePath.match(/rollout-([0-9a-f-]+)\.jsonl$/);
    return match ? match[1] : null;
  }

  private inferStateFromJSONL(filePath: string): 'working' | 'waiting' | 'idle' {
    // Read last few lines of JSONL file
    // Look for event_msg types to infer state
    // This is heuristic-based since Codex doesn't expose status directly
    return 'working'; // Simplified
  }

  stopMonitoring(): void {
    if (this.watcher) {
      this.watcher.close();
    }
  }
}
```

### Rollout File Format

**Location:** `~/.codex/sessions/YYYY/MM/DD/rollout-<SESSION_ID>.jsonl`

**Format:** JSON Lines (JSONL) - each line is a separate JSON object

**Key record types:**

1. **event_msg** - User input and system events
```json
{
  "type": "event_msg",
  "payload": {
    "type": "user_message",
    "message": "analyze this codebase",
    "images": []
  },
  "timestamp": "2026-02-10T12:34:56Z"
}
```

2. **response_item** - AI responses
```json
{
  "type": "response_item",
  "payload": {
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "input_text",
        "text": "I'll analyze the codebase..."
      }
    ]
  },
  "timestamp": "2026-02-10T12:34:57Z"
}
```

3. **token_count** - Usage statistics
```json
{
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "input": 1234,
    "cached_input": 567,
    "output": 890,
    "reasoning": 100,
    "total": 2791
  },
  "timestamp": "2026-02-10T12:35:00Z"
}
```

### SQLite Database Schema (Simplified)

**Location:** `~/.codex/state.db` or `~/.codex/state-v2.db`

**Key tables:**
- `sessions` - Active and archived sessions
- `rollouts` - Individual session runs
- `logs` - Per-session activity logs

**Query example:**
```typescript
import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';

interface SessionRecord {
  id: string;
  created_at: number;
  updated_at: number;
  archived: number;
}

function getActiveSessions(): SessionRecord[] {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const dbPath = path.join(codexHome, 'state.db');

  const db = new Database(dbPath, { readonly: true });

  const sessions = db.prepare(`
    SELECT id, created_at, updated_at, archived
    FROM sessions
    WHERE archived = 0
    ORDER BY updated_at DESC
  `).all() as SessionRecord[];

  db.close();
  return sessions;
}
```

## Permission Mode Mapping

### Claude Code → Codex Equivalents

| Claude Code | Codex CLI | Flag/Config |
|-------------|-----------|-------------|
| `--permission-mode acceptEdits` | `--ask-for-approval on-request --sandbox workspace-write` | `--full-auto` |
| `--dangerously-skip-permissions` | `--dangerously-bypass-approvals-and-sandbox` | `--yolo` |
| Default (ask each time) | `--ask-for-approval untrusted` | `approval_policy = "untrusted"` |

### Codex Permission Modes

```typescript
interface CodexPermissionMode {
  id: string;
  label: string;
  sandboxFlag: string;
  approvalFlag: string;
  configEquivalent: {
    approval_policy: 'never' | 'on-request' | 'untrusted';
    sandbox?: string;
  };
}

const CODEX_PERMISSION_MODES: CodexPermissionMode[] = [
  {
    id: 'fullAuto',
    label: 'Full Auto (Workspace Write, On-Request)',
    sandboxFlag: '--sandbox workspace-write',
    approvalFlag: '--ask-for-approval on-request',
    configEquivalent: {
      approval_policy: 'on-request',
      sandbox: 'workspace-write'
    }
  },
  {
    id: 'readOnly',
    label: 'Read Only',
    sandboxFlag: '--sandbox read-only',
    approvalFlag: '--ask-for-approval on-request',
    configEquivalent: {
      approval_policy: 'on-request',
      sandbox: 'read-only'
    }
  },
  {
    id: 'yolo',
    label: 'YOLO (Bypass All)',
    sandboxFlag: '--dangerously-bypass-approvals-and-sandbox',
    approvalFlag: '',
    configEquivalent: {
      approval_policy: 'never',
      sandbox: 'danger-full-access'
    }
  }
];
```

## MCP Integration Approach

### Key Differences from Claude Code

| Aspect | Claude Code | Codex CLI |
|--------|-------------|-----------|
| Config format | JSON (mcp-config.json) | TOML (config.toml under [mcp_servers]) |
| Config flag | `--mcp-config <path>` | No flag, uses config.toml only |
| Server definition | `mcpServers` object | `[mcp_servers."name"]` tables |
| Environment vars | `env` object | `env_vars` array + `[mcp_servers."name".env]` table |
| Project scope | Separate mcp-config.json | .codex/config.toml (trusted projects only) |

### Codex MCP Configuration Example

**Programmatic generation:**
```typescript
interface CodexMcpServerConfig {
  command: string;
  args: string[];
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled?: boolean;
  env_vars?: string[];
  env?: Record<string, string>;
}

function generateCodexMcpConfig(
  worktreePath: string,
  workflowPath: string,
  repoRoot: string,
  mcpServerPath: string
): Record<string, CodexMcpServerConfig> {
  return {
    'lanes-workflow': {
      command: 'node',
      args: [
        mcpServerPath,
        '--worktree', worktreePath,
        '--workflow-path', workflowPath,
        '--repo-root', repoRoot
      ],
      startup_timeout_sec: 30,
      tool_timeout_sec: 60,
      enabled: true
    }
  };
}

// Write to .codex/config.toml in worktree
function writeCodexMcpToConfig(
  worktreePath: string,
  mcpConfig: Record<string, CodexMcpServerConfig>
): void {
  const configPath = path.join(worktreePath, '.codex', 'config.toml');
  const existingConfig = fs.existsSync(configPath)
    ? TOML.parse(fs.readFileSync(configPath, 'utf-8'))
    : {};

  const mergedConfig = {
    ...existingConfig,
    mcp_servers: mcpConfig
  };

  fs.writeFileSync(configPath, TOML.stringify(mergedConfig as any), 'utf-8');
}
```

### CLI Command for MCP (Alternative)

Codex also provides a CLI command for adding MCP servers:

```bash
codex mcp add lanes-workflow \
  --env WORKTREE_PATH=/path/to/worktree \
  --env WORKFLOW_PATH=/path/to/workflow.json \
  -- node /path/to/mcp/server.js
```

However, **programmatic TOML generation is recommended** for Lanes integration to maintain consistency and allow version control of the configuration.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| TOML file generation | CLI mcp add command | Manual testing only, not for production |
| File system monitoring | HTTP polling endpoint | If Codex adds API support in future |
| Session ID from filename | SQLite database query | If more robust state tracking needed |
| chokidar | fs.watch | Never - chokidar is more reliable cross-platform |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Hook events (SessionStart, etc.) | Codex doesn't support hooks | File system monitoring + polling |
| JSON config files | Codex only reads TOML | TOML format with @iarna/toml |
| `CODEX_SESSION_ID` env var | Not implemented (as of 2026-02-10) | Parse from rollout filename |
| `--mcp-config` flag | Doesn't exist in Codex | Embed MCP config in config.toml |
| Synchronous session state | Codex doesn't provide real-time status | Polling/monitoring approach |

## Stack Patterns by Variant

**If implementing for Claude Code:**
- Use JSON for all configuration
- Leverage hook events for session tracking
- Session ID available immediately via SessionStart hook
- Status updates via hook events (UserPromptSubmit, Stop, etc.)

**If implementing for Codex CLI:**
- Use TOML for all configuration
- Implement file system monitoring for session detection
- Extract session ID from rollout filename
- Infer status from JSONL log analysis (heuristic-based)

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Codex CLI 0.39.x | @iarna/toml ^2.2.5 | Stable TOML format |
| Codex CLI 0.39.x | chokidar ^3.5.3 | File watching for session monitoring |
| Codex CLI 0.39.x | better-sqlite3 ^9.0.0 | Read Codex's SQLite database |
| Node.js 18+ | All dependencies | Minimum Node version for Codex CLI |

## Sources

- [Codex CLI](https://developers.openai.com/codex/cli/) — Official documentation (HIGH confidence)
- [Command line options](https://developers.openai.com/codex/cli/reference/) — Flag reference (HIGH confidence)
- [Configuration Reference](https://developers.openai.com/codex/config-reference/) — TOML structure (HIGH confidence)
- [Config basics](https://developers.openai.com/codex/config-basic/) — Configuration overview (HIGH confidence)
- [Model Context Protocol](https://developers.openai.com/codex/mcp/) — MCP integration (HIGH confidence)
- [GitHub - openai/codex](https://github.com/openai/codex) — Official repository (HIGH confidence)
- [codex/docs/config.md](https://github.com/openai/codex/blob/main/docs/config.md) — Configuration documentation (HIGH confidence)
- [Codex CLI vs Claude Code: Which Is Better? 2026 Benchmark](https://smartscope.blog/en/generative-ai/chatgpt/codex-vs-claude-code-2026-benchmark/) — Comparison analysis (MEDIUM confidence)
- [Codex MCP Configuration: TOML Setup Guide](https://vladimirsiedykh.com/blog/codex-mcp-config-toml-shared-configuration-cli-vscode-setup-2025) — TOML examples (MEDIUM confidence)
- [CircleCI MCP + Codex: the simplest config.toml setup](https://jpcaparas.medium.com/circleci-mcp-codex-the-simplest-config-toml-setup-bb3772101ce4) — Real-world example (MEDIUM confidence)
- [Feature request: expose current Codex session ID programmatically](https://github.com/openai/codex/issues/8923) — Session ID capture limitation (HIGH confidence)
- [How Codex CLI Flags Actually Work](https://www.vincentschmalbach.com/how-codex-cli-flags-actually-work-full-auto-sandbox-and-bypass/) — Flag behavior analysis (MEDIUM confidence)
- [Security](https://developers.openai.com/codex/security/) — Sandbox and approval policies (HIGH confidence)

---
*Stack research for: Codex CLI Integration into Lanes VS Code Extension*
*Researched: 2026-02-10*
*Confidence: MEDIUM (Official docs available, but some areas like session monitoring require experimentation)*
