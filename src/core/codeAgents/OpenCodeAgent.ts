/**
 * OpenCodeAgent - Implementation of CodeAgent for OpenCode CLI
 *
 * This module provides OpenCode-specific implementations for command building,
 * session management, and MCP configuration delivery.
 *
 * OpenCode CLI: https://opencode.ai
 */

import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import {
    CodeAgent,
    CapturedSession,
    SessionData,
    AgentStatus,
    PermissionMode,
    HookConfig,
    StartCommandOptions,
    ResumeCommandOptions,
    McpConfig,
    McpConfigDelivery
} from './CodeAgent';

const execFileAsync = promisify(execFile);

/**
 * OpenCode CLI implementation of the CodeAgent interface
 *
 * Notes:
 * - OpenCode uses a plugin system instead of JSON hooks (hookless agent).
 * - MCP configuration is delivered via opencode.json (project-level settings).
 * - OpenCode config format uses `mcp` key (not `mcpServers`) with array-based command format.
 * - Permission modes are handled through config files, not CLI flags.
 */
export class OpenCodeAgent extends CodeAgent {
    /**
     * OpenCode session IDs use a `ses_` prefix followed by alphanumeric characters.
     * Example: ses_3a3dc35efffeDUYQRmDO8b77Vi
     */
    private static readonly SESSION_ID_PATTERN = /^ses_[A-Za-z0-9]+$/;

    constructor() {
        super({
            name: 'opencode',
            displayName: 'OpenCode',
            cliCommand: 'opencode',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'opencode.json',
            defaultDataDir: '.opencode',
            // Simple terminal/code icon
            logoSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>'
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
        // OpenCode doesn't have a separate local settings file pattern like Claude
        return [];
    }

    // --- Terminal Configuration ---

    getTerminalName(sessionName: string): string {
        return `OpenCode: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return {
            id: 'robot',
            color: 'terminal.ansiMagenta'
        };
    }

    // --- Command Building ---

    /**
     * Validate that a session ID matches OpenCode's ses_ format
     * @throws Error if session ID is not valid
     */
    private validateSessionId(sessionId: string): void {
        if (!OpenCodeAgent.SESSION_ID_PATTERN.test(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}. Expected OpenCode ses_ format.`);
        }
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts: string[] = [this.config.cliCommand];

        // OpenCode uses --prompt flag (positional arg is a project directory)
        if (options.prompt) {
            parts.push('--prompt', this.formatPromptForShell(options.prompt));
        }

        return parts.join(' ');
    }

    buildResumeCommand(sessionId: string, _options: ResumeCommandOptions): string {
        // Validate session ID to prevent command injection
        this.validateSessionId(sessionId);

        const parts: string[] = [this.config.cliCommand, '--session', sessionId];
        return parts.join(' ');
    }

    // --- Session/Status Parsing ---

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);

            // Session ID is required
            if (!data.sessionId || typeof data.sessionId !== 'string') {
                return null;
            }

            // Validate session ID format to prevent command injection
            if (!OpenCodeAgent.SESSION_ID_PATTERN.test(data.sessionId)) {
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
        // Hookless agents with polling support have granular status via session log watching
        return ['active', 'idle', 'working', 'waiting_for_user'];
    }

    // --- Permission Modes ---

    getPermissionModes(): PermissionMode[] {
        // OpenCode handles permissions through config files, not CLI flags
        // We still define the modes for UI purposes
        return [
            { id: 'acceptEdits', label: 'Accept Edits' },
            { id: 'bypassPermissions', label: 'Bypass Permissions' }
        ];
    }

    validatePermissionMode(mode: string): boolean {
        return this.getPermissionModes().some(m => m.id === mode);
    }

    getPermissionFlag(_mode: string): string {
        return '';
    }

    getPermissionSettings(mode: string): Record<string, unknown> {
        return {
            permission: mode === 'bypassPermissions'
                ? 'allow'
                : { '*': 'ask', edit: 'allow' }
        };
    }

    // --- Hooks ---

    getHookEvents(): string[] {
        // OpenCode uses a plugin system, not JSON hooks
        // Return empty array to indicate this is a hookless agent
        return [];
    }

    generateHooksConfig(
        _worktreePath: string,
        _sessionFilePath: string,
        _statusFilePath: string,
        _workflowPath?: string,
        _hookScriptPath?: string
    ): HookConfig[] {
        // OpenCode is a hookless agent - uses plugin system instead
        return [];
    }

    // --- Settings Delivery ---

    getProjectSettingsPath(worktreePath: string): string {
        return path.join(worktreePath, 'opencode.json');
    }

    // --- MCP Support ---

    supportsMcp(): boolean {
        return true;
    }

    getMcpConfigDelivery(): McpConfigDelivery {
        // OpenCode uses settings file for MCP config
        return 'settings';
    }

    getMcpConfig(worktreePath: string, workflowPath: string, repoRoot: string): McpConfig | null {
        const mcpServerPath = path.join(__dirname, 'mcp', 'server.js');

        return {
            mcpServers: {
                'lanes-workflow': {
                    command: process.versions.electron ? 'node' : process.execPath,
                    args: [mcpServerPath, '--worktree', worktreePath, '--workflow-path', workflowPath, '--repo-root', repoRoot]
                }
            }
        };
    }

    /**
     * Transform standard McpConfig into OpenCode's native format.
     *
     * OpenCode expects:
     * - `mcp` key (not `mcpServers`)
     * - `command` as an array (not separate command + args)
     * - `type: "local"` field required
     */
    formatMcpForSettings(mcpConfig: McpConfig): Record<string, unknown> {
        const mcp: Record<string, unknown> = {};
        for (const [name, server] of Object.entries(mcpConfig.mcpServers)) {
            mcp[name] = {
                type: 'local',
                command: [server.command, ...server.args]
            };
        }
        return { mcp };
    }

    // --- Session ID Capture (Hookless Agent) ---

    async captureSessionIdForWorktree(
        beforeTimestamp: Date,
        worktreePath: string
    ): Promise<CapturedSession | null> {
        const startedAt = beforeTimestamp.getTime();
        const timeoutAt = Date.now() + 15_000;
        while (Date.now() < timeoutAt) {
            try {
                const { stdout } = await execFileAsync(
                    this.config.cliCommand,
                    ['session', 'list', '--max-count', '10', '--format', 'json'],
                    { cwd: worktreePath, timeout: 2_000 }
                );
                const sessions = JSON.parse(stdout) as Array<{
                    id?: string;
                    directory?: string;
                    created?: number;
                    updated?: number;
                }>;
                const session = sessions.find(item =>
                    item.id && OpenCodeAgent.SESSION_ID_PATTERN.test(item.id)
                    && path.resolve(item.directory || '') === path.resolve(worktreePath)
                    && Math.max(item.created || 0, item.updated || 0) >= startedAt
                );
                if (session?.id) {
                    return { sessionId: session.id };
                }
            } catch {
                // Retry while OpenCode creates the session.
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return null;
    }

    // --- Prompt Improvement (Non-interactive) ---

    buildPromptImproveCommand(prompt: string): { command: string; args: string[] } | null {
        // Use opencode run for non-interactive prompt processing
        const metaPrompt = `You are a prompt engineer. The user wants to send the following text as a starting prompt to an AI coding assistant session. Your job is to improve and restructure this prompt to be clearer, more specific, and better organized. Keep the same intent but make it more effective. Reply with the improved prompt only — no preamble, no explanation, no surrounding quotes, no "Here is the improved prompt:" prefix.

Original prompt:
${prompt}`;

        return {
            command: this.config.cliCommand,
            args: ['run', metaPrompt]
        };
    }
}
