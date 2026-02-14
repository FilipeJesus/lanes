/**
 * CortexCodeAgent - Implementation of CodeAgent for Snowflake Cortex Code
 *
 * This module provides Cortex-specific implementations for all code agent
 * behaviors. Cortex Code is a fork of Claude Code with Snowflake branding
 * and slight configuration differences.
 */

import * as path from 'path';
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
 * - No MCP support (Cortex Code does not support non-global MCP servers)
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
            defaultDataDir: '.cortex',
            logoSvg: '<svg viewBox="0 0 64 64" fill="currentColor"><path d="M9.86 15.298l13.008 7.8a3.72 3.72 0 0 0 4.589-.601 4.01 4.01 0 0 0 1.227-2.908V3.956a3.81 3.81 0 0 0-1.861-3.42 3.81 3.81 0 0 0-3.893 0 3.81 3.81 0 0 0-1.861 3.42v8.896l-7.387-4.43a3.79 3.79 0 0 0-2.922-.4c-.986.265-1.818.94-2.3 1.844-1.057 1.9-.44 4.28 1.4 5.422m31.27 7.8l13.008-7.8c1.84-1.143 2.458-3.533 1.4-5.424a3.75 3.75 0 0 0-5.22-1.452l-7.3 4.37v-8.84a3.81 3.81 0 1 0-7.615 0v15.323a4.08 4.08 0 0 0 .494 2.367c.482.903 1.314 1.57 2.3 1.844a3.71 3.71 0 0 0 2.922-.4M29.552 31.97c.013-.25.108-.5.272-.68l1.52-1.58a1.06 1.06 0 0 1 .658-.282h.057a1.05 1.05 0 0 1 .656.282l1.52 1.58a1.12 1.12 0 0 1 .272.681v.06a1.13 1.13 0 0 1-.272.683l-1.52 1.58a1.04 1.04 0 0 1-.656.284h-.057c-.246-.014-.48-.115-.658-.284l-1.52-1.58a1.13 1.13 0 0 1-.272-.683zm-4.604-.65v1.364a1.54 1.54 0 0 0 .372.93l5.16 5.357a1.42 1.42 0 0 0 .895.386h1.312a1.42 1.42 0 0 0 .895-.386l5.16-5.357a1.54 1.54 0 0 0 .372-.93V31.32a1.54 1.54 0 0 0-.372-.93l-5.16-5.357a1.42 1.42 0 0 0-.895-.386h-1.312a1.42 1.42 0 0 0-.895.386L25.32 30.4a1.55 1.55 0 0 0-.372.93M3.13 27.62l7.365 4.417L3.13 36.45a4.06 4.06 0 0 0-1.399 5.424 3.75 3.75 0 0 0 2.3 1.844c.986.274 2.042.133 2.922-.392l13.008-7.8c1.2-.762 1.9-2.078 1.9-3.492a4.16 4.16 0 0 0-1.9-3.492l-13.008-7.8a3.79 3.79 0 0 0-2.922-.4c-.986.265-1.818.94-2.3 1.844-1.057 1.9-.44 4.278 1.4 5.422m38.995 4.442a4 4 0 0 0 1.91 3.477l13 7.8c.88.524 1.934.666 2.92.392s1.817-.94 2.3-1.843a4.05 4.05 0 0 0-1.4-5.424L53.5 32.038l7.365-4.417c1.84-1.143 2.457-3.53 1.4-5.422a3.74 3.74 0 0 0-2.3-1.844c-.987-.274-2.042-.134-2.92.4l-13 7.8a4 4 0 0 0-1.91 3.507M25.48 40.508a3.7 3.7 0 0 0-2.611.464l-13.008 7.8c-1.84 1.143-2.456 3.53-1.4 5.422.483.903 1.314 1.57 2.3 1.843a3.75 3.75 0 0 0 2.922-.392l7.387-4.43v8.83a3.81 3.81 0 1 0 7.614 0V44.4a3.91 3.91 0 0 0-3.205-3.903m28.66 8.276l-13.008-7.8a3.75 3.75 0 0 0-2.922-.392 3.74 3.74 0 0 0-2.3 1.843 4.09 4.09 0 0 0-.494 2.37v15.25a3.81 3.81 0 1 0 7.614 0V51.28l7.287 4.37a3.79 3.79 0 0 0 2.922.4c.986-.265 1.818-.94 2.3-1.844 1.057-1.9.44-4.28-1.4-5.422"/></svg>'
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

        // Cortex loads settings from well-known project paths (.cortex/settings.local.json),
        // not via a CLI flag. Settings path is not passed on the command line.

        // Add permission mode flag
        if (options.permissionMode) {
            const flag = this.getPermissionFlag(options.permissionMode);
            if (flag) {
                parts.push(flag);
            }
        }

        // Cortex CLI does not support positional prompt arguments.
        // Prompts are delivered via terminal stdin (see supportsPositionalPrompt).

        return parts.join(' ');
    }

    buildResumeCommand(sessionId: string, _options: ResumeCommandOptions): string {
        // Validate session ID to prevent command injection
        this.validateSessionId(sessionId);

        const parts: string[] = [this.config.cliCommand];

        // Cortex loads settings from well-known project paths (.cortex/settings.local.json),
        // not via a CLI flag.

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
                // Cortex Code does not support matchers on non-tool hook events
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
                // Cortex Code does not support matchers on non-tool hook events
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

    // --- Prompt Passing ---

    supportsPositionalPrompt(): boolean {
        return false;
    }

    // --- Settings Delivery ---

    getProjectSettingsPath(worktreePath: string): string {
        // Cortex Code auto-loads settings from well-known project paths.
        // .cortex/settings.local.json has highest project-level priority.
        return path.join(worktreePath, '.cortex', 'settings.local.json');
    }

    // --- MCP Support ---

    supportsMcp(): boolean {
        return false;
    }

    getMcpConfig(_worktreePath: string, _workflowPath: string, _repoRoot: string): McpConfig | null {
        return null;
    }
}
