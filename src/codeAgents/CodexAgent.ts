/**
 * CodexAgent - Stub implementation of CodeAgent for Codex CLI
 *
 * This is a Phase 2 infrastructure stub. Full implementation with command
 * building, session ID capture, and terminal tracking comes in Phase 3.
 *
 * All abstract methods are implemented with minimal valid returns to satisfy
 * the CodeAgent contract and enable factory instantiation.
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

/**
 * Codex CLI implementation of the CodeAgent interface (stub)
 *
 * Provides minimal implementations for all abstract methods.
 * Key differences from Claude:
 * - No hook system (getHookEvents returns empty array)
 * - No MCP support
 * - Uses TOML settings format (config.toml)
 * - Blue terminal icon (vs Claude's green)
 * - Simpler status states (active/idle only - no hooks for granular tracking)
 */
export class CodexAgent extends CodeAgent {
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

    // --- Local Settings ---

    getLocalSettingsFiles(): Array<{ dir: string; file: string }> {
        return [{ dir: '.codex', file: 'config.toml' }];
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

    // --- Command Building (stubs - Phase 3 implements full command building) ---

    buildStartCommand(_options: StartCommandOptions): string {
        return 'codex';
    }

    buildResumeCommand(_sessionId: string, _options: ResumeCommandOptions): string {
        return 'codex resume --last';
    }

    // --- Session/Status Parsing ---

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);

            // Session ID is required and must be a string
            if (!data.sessionId || typeof data.sessionId !== 'string') {
                return null;
            }

            // No UUID validation - Codex IDs may not be UUIDs
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

    // --- Permission Modes (stubs - Phase 3 maps to --sandbox and --ask-for-approval) ---

    getPermissionModes(): PermissionMode[] {
        return [
            { id: 'read-only', label: 'Read Only' },
            { id: 'workspace-write', label: 'Workspace Write' },
            { id: 'full-access', label: 'Full Access' }
        ];
    }

    validatePermissionMode(mode: string): boolean {
        return this.getPermissionModes().some(m => m.id === mode);
    }

    getPermissionFlag(_mode: string): string {
        // Stub - Phase 3 maps to --sandbox and --ask-for-approval flags
        return '';
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
}
