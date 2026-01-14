/**
 * ClaudeCodeAgent - Implementation of CodeAgent for Claude Code
 *
 * This module provides Claude-specific implementations for all code agent
 * behaviors including command building, session management, and MCP support.
 */

import * as path from 'path';
import {
    CodeAgent,
    CodeAgentConfig,
    SessionData,
    AgentStatus,
    PermissionMode,
    HookConfig,
    HookCommand,
    StartCommandOptions,
    ResumeCommandOptions,
    McpConfig
} from './CodeAgent';

/**
 * Claude Code implementation of the CodeAgent interface
 *
 * Provides all Claude-specific behavior including:
 * - Permission mode handling (acceptEdits, bypassPermissions, dontAsk, etc.)
 * - Hook configuration for session tracking and status updates
 * - MCP server integration for workflow support
 */
export class ClaudeCodeAgent extends CodeAgent {
    /**
     * Create a new ClaudeCodeAgent instance with Claude-specific configuration
     */
    constructor() {
        super({
            name: 'claude',
            displayName: 'Claude',
            cliCommand: 'claude',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'claude-settings.json',
            defaultDataDir: '.claude'
        });
    }

    // --- File Naming ---

    getSessionFileName(): string {
        return this.config.sessionFileExtension;
    }

    getStatusFileName(): string {
        return this.config.statusFileExtension;
    }

    getSettingsFileName(): string {
        return this.config.settingsFileName;
    }

    getDataDirectory(): string {
        return this.config.defaultDataDir;
    }

    // --- Terminal Configuration ---

    getTerminalName(sessionName: string): string {
        return `Claude: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return {
            id: 'robot',
            color: 'terminal.ansiGreen'
        };
    }

    // --- Command Building ---

    /**
     * Escape a string for safe use in shell single quotes
     * Replaces single quotes with the shell escape sequence '\''
     */
    private escapeForSingleQuotes(str: string): string {
        return str.replace(/'/g, "'\\''");
    }

    /**
     * Validate that a session ID is in valid UUID format
     * @throws Error if session ID is not a valid UUID
     */
    private validateSessionId(sessionId: string): void {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}. Expected UUID format.`);
        }
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts: string[] = [this.config.cliCommand];

        // Add MCP config first (must come before --settings due to Claude's argument parsing)
        if (options.mcpConfigPath) {
            parts.push(`--mcp-config "${options.mcpConfigPath}"`);
        }

        // Add settings file
        if (options.settingsPath) {
            parts.push(`--settings "${options.settingsPath}"`);
        }

        // Add permission mode flag
        if (options.permissionMode && options.permissionMode !== 'default') {
            const flag = this.getPermissionFlag(options.permissionMode);
            if (flag) {
                parts.push(flag);
            }
        }

        // Add prompt last (if provided)
        // Use single quotes with proper escaping to prevent shell injection
        if (options.prompt) {
            const escapedPrompt = this.escapeForSingleQuotes(options.prompt);
            parts.push(`'${escapedPrompt}'`);
        }

        return parts.join(' ');
    }

    buildResumeCommand(sessionId: string, options: ResumeCommandOptions): string {
        // Validate session ID to prevent command injection
        this.validateSessionId(sessionId);

        const parts: string[] = [this.config.cliCommand];

        // Add MCP config first (must come before --settings)
        if (options.mcpConfigPath) {
            parts.push(`--mcp-config "${options.mcpConfigPath}"`);
        }

        // Add settings file
        if (options.settingsPath) {
            parts.push(`--settings "${options.settingsPath}"`);
        }

        // Add resume flag with session ID (already validated)
        parts.push(`--resume ${sessionId}`);

        return parts.join(' ');
    }

    // --- Session/Status Parsing ---

    /**
     * Pattern for validating session ID format (UUID)
     * Claude session IDs are UUIDs, so we validate against that format
     * This also prevents command injection when session ID is used in shell commands
     */
    private static readonly SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);

            // Session ID is required
            if (!data.sessionId || typeof data.sessionId !== 'string') {
                return null;
            }

            // Validate session ID format to prevent command injection
            // This is critical since session IDs are used in shell commands
            if (!ClaudeCodeAgent.SESSION_ID_PATTERN.test(data.sessionId)) {
                return null;
            }

            return {
                sessionId: data.sessionId,
                timestamp: data.timestamp,
                workflow: data.workflow,
                agentName: this.config.name
            };
        } catch {
            return null;
        }
    }

    parseStatus(content: string): AgentStatus | null {
        try {
            const data = JSON.parse(content);

            // Status is required
            if (!data.status || typeof data.status !== 'string') {
                return null;
            }

            return {
                status: data.status,
                timestamp: data.timestamp,
                message: data.message
            };
        } catch {
            return null;
        }
    }

    getValidStatusStates(): string[] {
        return ['working', 'waiting_for_user', 'idle', 'error'];
    }

    // --- Permission Modes ---

    getPermissionModes(): PermissionMode[] {
        return [
            { id: 'default', label: 'Default' },
            { id: 'acceptEdits', label: 'Accept Edits', flag: '--permission-mode acceptEdits' },
            { id: 'bypassPermissions', label: 'Bypass Permissions', flag: '--dangerously-skip-permissions' },
            { id: 'dontAsk', label: "Don't Ask", flag: '--permission-mode dontAsk' },
        ];
    }

    validatePermissionMode(mode: string): boolean {
        return this.getPermissionModes().some(m => m.id === mode);
    }

    getPermissionFlag(mode: string): string {
        const permissionMode = this.getPermissionModes().find(m => m.id === mode);
        return permissionMode?.flag || '';
    }

    // --- Hooks ---

    getHookEvents(): string[] {
        return ['SessionStart', 'Stop', 'UserPromptSubmit', 'Notification', 'PreToolUse'];
    }

    generateHooksConfig(
        worktreePath: string,
        sessionFilePath: string,
        statusFilePath: string
    ): HookConfig[] {
        // Status update hooks
        const statusWriteWaiting: HookCommand = {
            type: 'command',
            command: `echo '{"status":"waiting_for_user"}' > "${statusFilePath}"`
        };

        const statusWriteWorking: HookCommand = {
            type: 'command',
            command: `echo '{"status":"working"}' > "${statusFilePath}"`
        };

        // Session ID capture hook
        // Merges new session ID with existing file data to preserve workflow and other metadata
        const sessionIdCapture: HookCommand = {
            type: 'command',
            command: `old=$(cat "${sessionFilePath}" 2>/dev/null || echo '{}'); jq -r --argjson old "$old" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '$old + {sessionId: .session_id, timestamp: $ts}' > "${sessionFilePath}"`
        };

        return [
            {
                event: 'SessionStart',
                commands: [sessionIdCapture]
            },
            {
                event: 'Stop',
                commands: [statusWriteWaiting]
            },
            {
                event: 'UserPromptSubmit',
                commands: [statusWriteWorking]
            },
            {
                event: 'Notification',
                matcher: 'permission_prompt',
                commands: [statusWriteWaiting]
            },
            {
                event: 'PreToolUse',
                matcher: '.*',
                commands: [statusWriteWorking]
            }
        ];
    }

    // --- MCP Support ---

    supportsMcp(): boolean {
        return true;
    }

    getMcpConfig(worktreePath: string, workflowPath: string, repoRoot: string): McpConfig | null {
        // Get the path to the MCP server (relative to the extension's out directory)
        // This will be resolved at runtime by the caller
        const mcpServerPath = path.join(__dirname, 'mcp', 'server.js');

        return {
            mcpServers: {
                'lanes-workflow': {
                    command: 'node',
                    args: [mcpServerPath, '--worktree', worktreePath, '--workflow-path', workflowPath, '--repo-root', repoRoot]
                }
            }
        };
    }
}
