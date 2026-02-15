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
    McpConfig,
    AgentFeature
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
            displayName: 'Claude Code',
            cliCommand: 'claude',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'claude-settings.json',
            defaultDataDir: '.claude',
            logoSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><line x1="12" y1="10.5" x2="12" y2="2" stroke-width="2.4" transform="rotate(0 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3" stroke-width="2.4" transform="rotate(33 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3.5" stroke-width="2.2" transform="rotate(62 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2.5" stroke-width="2.4" transform="rotate(98 12 12)"/><line x1="12" y1="10.5" x2="12" y2="4" stroke-width="2.2" transform="rotate(130 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2" stroke-width="2.4" transform="rotate(163 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3.5" stroke-width="2.2" transform="rotate(195 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2.5" stroke-width="2.4" transform="rotate(228 12 12)"/><line x1="12" y1="10.5" x2="12" y2="4" stroke-width="2.2" transform="rotate(260 12 12)"/><line x1="12" y1="10.5" x2="12" y2="2" stroke-width="2.4" transform="rotate(292 12 12)"/><line x1="12" y1="10.5" x2="12" y2="3" stroke-width="2.2" transform="rotate(325 12 12)"/></svg>'
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

    // --- Local Settings ---

    getLocalSettingsFiles(): Array<{ dir: string; file: string }> {
        return [{ dir: '.claude', file: 'settings.local.json' }];
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
        if (options.permissionMode) {
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
                agentName: this.config.name,
                isChimeEnabled: data.isChimeEnabled
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
            { id: 'acceptEdits', label: 'Accept Edits', flag: '--permission-mode acceptEdits' },
            { id: 'bypassPermissions', label: 'Bypass Permissions', flag: '--dangerously-skip-permissions' },
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
        return ['SessionStart', 'Stop', 'UserPromptSubmit', 'Notification', 'PreToolUse', 'PostToolUse'];
    }

    generateHooksConfig(
        worktreePath: string,
        sessionFilePath: string,
        statusFilePath: string,
        workflowPath?: string,
        hookScriptPath?: string
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

        // Build SessionStart hooks array
        const sessionStartCommands: HookCommand[] = [sessionIdCapture];

        // Add workflow status hook if workflow is active
        if (workflowPath) {
            const workflowStatusCheck: HookCommand = {
                type: 'command',
                command: `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<system-reminder>\\nLanes Workflow Engine is active.\\nTo ensure context synchronization, you MUST run the workflow_status tool immediately.\\nDo not proceed with user requests until the workflow state is confirmed.\\n</system-reminder>"}}'`
            };
            sessionStartCommands.push(workflowStatusCheck);
        }

        // Build the hooks array
        const hooks: HookConfig[] = [
            {
                event: 'SessionStart',
                matcher: 'startup|resume|clear|compact',
                commands: sessionStartCommands
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

        // Add PostToolUse hook for artefact registration if script is available
        if (hookScriptPath) {
            hooks.push({
                event: 'PostToolUse',
                matcher: 'Write',
                commands: [{
                    type: 'command',
                    command: `"${hookScriptPath}"`
                }]
            });
        }

        return hooks;
    }

    // --- Feature Support ---

    supportsFeature(feature: AgentFeature): boolean {
        return feature === 'insights';
    }

    // --- Prompt Improvement ---

    buildPromptImproveCommand(prompt: string): { command: string; args: string[] } | null {
        const metaPrompt = `You are a prompt engineer. The user wants to send the following text as a starting prompt to an AI coding assistant session. Your job is to improve and restructure this prompt to be clearer, more specific, and better organized. Keep the same intent but make it more effective. Reply with the improved prompt only — no preamble, no explanation, no surrounding quotes, no "Here is the improved prompt:" prefix. When applicable, structure as summary, requirements, and acceptance criteria.

Original prompt:
${prompt}`;
        return { command: this.config.cliCommand, args: ['--model', 'haiku', '--print', metaPrompt] };
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
