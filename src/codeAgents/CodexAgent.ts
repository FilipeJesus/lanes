/**
 * CodexAgent - Full implementation of CodeAgent for Codex CLI
 *
 * Provides command building, session management, and terminal tracking for Codex CLI.
 *
 * Key differences from Claude Code:
 * - No hook system (getHookEvents returns empty array)
 * - No MCP support
 * - Uses TOML settings format (config.toml)
 * - Blue terminal icon (vs Claude's green)
 * - Simpler status states (active/idle only - no hooks for granular tracking)
 * - Permission modes map to --sandbox and --ask-for-approval flags
 * - No config file generation (settingsPath/mcpConfigPath ignored)
 */

import {
    CodeAgent,
    SessionData,
    AgentStatus,
    PermissionMode,
    HookConfig,
    StartCommandOptions,
    ResumeCommandOptions
} from './CodeAgent';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Codex CLI implementation of the CodeAgent interface
 *
 * Implements full command building with dual-flag permission system:
 * - acceptEdits: --sandbox workspace-write --ask-for-approval on-failure
 * - bypassPermissions: --sandbox danger-full-access --ask-for-approval never
 */
export class CodexAgent extends CodeAgent {
    /**
     * UUID validation pattern for session IDs
     */
    private static readonly SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    /**
     * Create a new CodexAgent instance with Codex-specific configuration.
     *
     * Note: sessionFileExtension and statusFileExtension use .claude-session / .claude-status
     * per user decision - session file name stays the same for ALL agents.
     */
    constructor() {
        super({
            name: 'codex',
            displayName: 'Codex',
            cliCommand: 'codex',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'config.toml',
            defaultDataDir: '.codex'
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

    // --- Private Helper Methods ---

    /**
     * Escape string for safe use inside single quotes in shell command
     */
    private escapeForSingleQuotes(str: string): string {
        return str.replace(/'/g, "'\\''");
    }

    /**
     * Validate that session ID is a valid UUID format
     * @throws Error if session ID is not a valid UUID
     */
    private validateSessionId(sessionId: string): void {
        if (!CodexAgent.SESSION_ID_PATTERN.test(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}. Expected UUID format.`);
        }
    }

    // --- Local Settings ---

    getLocalSettingsFiles(): Array<{ dir: string; file: string }> {
        // No local settings propagation for Codex in this phase (user decision)
        return [];
    }

    // --- Terminal Configuration ---

    getTerminalName(sessionName: string): string {
        return `Codex: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return {
            id: 'robot',
            color: 'terminal.ansiBlue'
        };
    }

    // --- Command Building ---

    /**
     * Build Codex CLI start command with permission mode and optional prompt
     *
     * Format: codex [--sandbox <mode> --ask-for-approval <mode>] ['<prompt>']
     *
     * Note: Does NOT add --settings or --mcp-config flags (Codex doesn't support them)
     */
    buildStartCommand(options: StartCommandOptions): string {
        const parts: string[] = [this.config.cliCommand];

        // Add permission flags if provided (combined dual-flag string)
        if (options.permissionMode) {
            const flag = this.getPermissionFlag(options.permissionMode);
            if (flag) {
                parts.push(flag);
            }
        }

        // Add escaped prompt in single quotes if provided
        if (options.prompt) {
            const escapedPrompt = this.escapeForSingleQuotes(options.prompt);
            parts.push(`'${escapedPrompt}'`);
        }

        return parts.join(' ');
    }

    /**
     * Build Codex CLI resume command
     *
     * Format: codex resume <UUID>
     *
     * @throws Error if session ID is not a valid UUID
     */
    buildResumeCommand(sessionId: string, _options: ResumeCommandOptions): string {
        // Validate UUID format (throws on invalid - strict, no fallback)
        this.validateSessionId(sessionId);

        const parts: string[] = [this.config.cliCommand, 'resume', sessionId];

        // Note: options parameter accepted for interface compatibility,
        // but Codex doesn't use settingsPath/mcpConfigPath

        return parts.join(' ');
    }

    // --- Session/Status Parsing ---

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);

            // Session ID is required and must be a string
            if (!data.sessionId || typeof data.sessionId !== 'string') {
                return null;
            }

            // Validate UUID format - Codex uses UUID session IDs
            if (!CodexAgent.SESSION_ID_PATTERN.test(data.sessionId)) {
                return null;
            }

            return {
                sessionId: data.sessionId,
                timestamp: data.timestamp,
                agentName: this.config.name,
                workflow: data.workflow,
                isChimeEnabled: data.isChimeEnabled
            };
        } catch {
            return null;
        }
    }

    parseStatus(content: string): AgentStatus | null {
        try {
            const data = JSON.parse(content);

            // Status field is required
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
        // Hookless agents only have active/idle (no granular working/waiting_for_user)
        return ['active', 'idle'];
    }

    // --- Permission Modes ---

    /**
     * Get available permission modes for Codex CLI
     *
     * Returns exactly 2 modes using dual-flag system:
     * - acceptEdits: Workspace write with approval on failure
     * - bypassPermissions: Full access with no approval prompts
     */
    getPermissionModes(): PermissionMode[] {
        return [
            { id: 'acceptEdits', label: 'Accept Edits', flag: '--sandbox workspace-write --ask-for-approval on-failure' },
            { id: 'bypassPermissions', label: 'Bypass Permissions', flag: '--sandbox danger-full-access --ask-for-approval never' }
        ];
    }

    validatePermissionMode(mode: string): boolean {
        return this.getPermissionModes().some(m => m.id === mode);
    }

    /**
     * Get the combined permission flag string for a given mode
     * @returns Combined --sandbox and --ask-for-approval flags, or empty string if mode not found
     */
    getPermissionFlag(mode: string): string {
        const permissionMode = this.getPermissionModes().find(m => m.id === mode);
        return permissionMode?.flag || '';
    }

    // --- Hooks (Codex has no hook system) ---

    getHookEvents(): string[] {
        return [];
    }

    generateHooksConfig(
        _worktreePath: string,
        _sessionFilePath: string,
        _statusFilePath: string,
        _workflowPath?: string,
        _hookScriptPath?: string
    ): HookConfig[] {
        // Codex has no hook system - return empty array
        return [];
    }

    // --- MCP Support ---

    supportsMcp(): boolean {
        return false;
    }

    // --- Session ID Capture (Hookless Agent Support) ---

    /**
     * Capture Codex session ID by reading the most recently modified session file
     * from ~/.codex/sessions/. Polls with a 500ms interval until timeout.
     *
     * @param beforeTimestamp Only consider files modified after this time (to filter pre-existing sessions)
     * @param timeoutMs Maximum time to wait (default: 10000ms -- generous for slow starts)
     * @param pollIntervalMs Poll interval (default: 500ms)
     * @returns Session ID string (UUID format) or null if capture fails
     */
    static async captureSessionId(
        beforeTimestamp: Date,
        timeoutMs: number = 10000,
        pollIntervalMs: number = 500
    ): Promise<string | null> {
        const sessionsDir = path.join(os.homedir(), '.codex', 'sessions');
        const startTime = Date.now();

        try {
            while (Date.now() - startTime < timeoutMs) {
                try {
                    // Check if sessions directory exists
                    const files = await fs.readdir(sessionsDir);

                    // Find files modified after beforeTimestamp
                    const candidates: Array<{ file: string; mtime: number }> = [];

                    for (const file of files) {
                        try {
                            const filePath = path.join(sessionsDir, file);
                            const stats = await fs.stat(filePath);

                            // Only consider files modified after the timestamp
                            if (stats.mtime > beforeTimestamp) {
                                candidates.push({ file, mtime: stats.mtime.getTime() });
                            }
                        } catch {
                            // Skip files that can't be stat'd
                            continue;
                        }
                    }

                    // Sort by mtime descending (newest first)
                    candidates.sort((a, b) => b.mtime - a.mtime);

                    // Try to extract session ID from the newest file
                    if (candidates.length > 0) {
                        const newestFile = candidates[0].file;
                        const filePath = path.join(sessionsDir, newestFile);

                        try {
                            const content = await fs.readFile(filePath, 'utf-8');
                            // JSONL format - parse first line only
                            const firstLine = content.split('\n')[0];
                            if (!firstLine) {
                                // Empty file, wait and retry
                                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                                continue;
                            }

                            const data = JSON.parse(firstLine);

                            // Try multiple field names for session ID
                            const possibleSessionId = data.session_id || data.id || data.sessionId;

                            if (possibleSessionId && typeof possibleSessionId === 'string') {
                                // Validate UUID format
                                if (CodexAgent.SESSION_ID_PATTERN.test(possibleSessionId)) {
                                    return possibleSessionId;
                                }
                            }
                        } catch {
                            // Failed to parse file, wait and retry
                            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                            continue;
                        }
                    }
                } catch (err) {
                    // Sessions directory might not exist yet, wait and retry
                    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
                    continue;
                }

                // No valid session found yet, wait and retry
                await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
            }

            // Timeout reached
            return null;
        } catch (err) {
            console.error('Lanes: Error capturing Codex session ID:', err);
            return null;
        }
    }
}
