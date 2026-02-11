/**
 * CortexCodeAgent - Implementation of CodeAgent for Snowflake Cortex Code
 *
 * This module provides Cortex-specific implementations for all code agent
 * behaviors. Cortex Code is a fork of Claude Code with Snowflake branding
 * and slight configuration differences.
 */

import {
    CodeAgent,
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
 * Cortex Code implementation of the CodeAgent interface
 *
 * Provides all Cortex-specific behavior including:
 * - Permission mode handling (acceptEdits, bypassPermissions)
 * - Hook configuration for session tracking and status updates
 * - Same hook events and structure as Claude (since Cortex is a fork)
 * - No MCP support (per user requirements)
 */
export class CortexCodeAgent extends CodeAgent {
    /**
     * Create a new CortexCodeAgent instance with Cortex-specific configuration
     */
    constructor() {
        super({
            name: 'cortex',
            displayName: 'Cortex Code',
            cliCommand: 'cortex',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'cortex-settings.json',
            defaultDataDir: '.cortex'
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
        // No local settings propagation for Cortex Code
        return [];
    }

    // --- Terminal Configuration ---

    getTerminalName(sessionName: string): string {
        return `Cortex: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return {
            id: 'robot',
            color: 'terminal.ansiCyan'
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
        if (!CortexCodeAgent.SESSION_ID_PATTERN.test(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}. Expected UUID format.`);
        }
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts: string[] = [this.config.cliCommand];

        // Add config file (Cortex uses --config, not --settings)
        if (options.settingsPath) {
            parts.push(`--config "${options.settingsPath}"`);
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

        // Add config file (Cortex uses --config, not --settings)
        if (options.settingsPath) {
            parts.push(`--config "${options.settingsPath}"`);
        }

        // Add resume flag with session ID (already validated)
        parts.push(`--resume ${sessionId}`);

        return parts.join(' ');
    }

    // --- Session/Status Parsing ---

    /**
     * Pattern for validating session ID format (UUID)
     * Cortex session IDs are UUIDs (same as Claude), so we validate against that format
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
            if (!CortexCodeAgent.SESSION_ID_PATTERN.test(data.sessionId)) {
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
            { id: 'acceptEdits', label: 'Accept Edits' },
            { id: 'bypassPermissions', label: 'Bypass Permissions', flag: '--bypass' },
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
        _worktreePath: string,
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

    // --- MCP Support ---

    supportsMcp(): boolean {
        return false;
    }

    getMcpConfig(_worktreePath: string, _workflowPath: string, _repoRoot: string): McpConfig | null {
        return null;
    }
}
