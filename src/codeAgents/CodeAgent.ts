/**
 * CodeAgent - Abstract base class for code agent implementations
 *
 * This module provides the foundational interfaces and abstract class
 * for implementing support for different CLI-based code agents
 * (Claude, OpenCode, Gemini CLI, Codex CLI, etc.)
 */

/**
 * Configuration for a code agent
 */
export interface CodeAgentConfig {
    /** Internal identifier (e.g., 'claude', 'opencode') */
    name: string;

    /** Display name shown to users (e.g., 'Claude', 'OpenCode') */
    displayName: string;

    /** CLI command to invoke the agent (e.g., 'claude', 'opencode') */
    cliCommand: string;

    /** File extension for session files (e.g., '.claude-session') */
    sessionFileExtension: string;

    /** File extension for status files (e.g., '.claude-status') */
    statusFileExtension: string;

    /** Filename for agent settings (e.g., 'claude-settings.json') */
    settingsFileName: string;

    /** Default data directory name (e.g., '.claude') */
    defaultDataDir: string;
}

/**
 * Agent-agnostic session data
 * Represents the session information stored by an agent
 */
export interface SessionData {
    /** Unique session identifier */
    sessionId: string;

    /** ISO timestamp of session creation/update */
    timestamp?: string;

    /** Workflow template name if using workflows */
    workflow?: string;

    /** Name of the agent that created this session */
    agentName: string;
}

/**
 * Agent-agnostic status information
 * Represents the current status of an agent session
 */
export interface AgentStatus {
    /** Status value (agent-specific, e.g., 'working', 'waiting_for_user', 'idle') */
    status: string;

    /** ISO timestamp of status update */
    timestamp?: string;

    /** Optional human-readable message */
    message?: string;
}

/**
 * Permission mode configuration
 * Defines an available permission mode for the agent
 */
export interface PermissionMode {
    /** Internal identifier (e.g., 'default', 'acceptEdits') */
    id: string;

    /** Display label for users (e.g., 'Default', 'Accept Edits') */
    label: string;

    /** Optional CLI flag to use (e.g., '--bypass-permissions') */
    flag?: string;
}

/**
 * Single hook command
 */
export interface HookCommand {
    /** Command type (currently only 'command' is supported) */
    type: 'command';

    /** Shell command to execute */
    command: string;
}

/**
 * Hook configuration for an event
 */
export interface HookConfig {
    /** Event name (e.g., 'SessionStart', 'StatusUpdate') */
    event: string;

    /** Optional matcher pattern for conditional hook execution */
    matcher?: string;

    /** Commands to execute for this event */
    commands: HookCommand[];
}

/**
 * Options for building a start command
 */
export interface StartCommandOptions {
    /** Permission mode to use (e.g., 'default', 'acceptEdits') */
    permissionMode?: string;

    /** Path to settings file */
    settingsPath?: string;

    /** Path to MCP config file */
    mcpConfigPath?: string;

    /** Initial prompt for the agent */
    prompt?: string;
}

/**
 * Options for building a resume command
 */
export interface ResumeCommandOptions {
    /** Path to settings file */
    settingsPath?: string;

    /** Path to MCP config file */
    mcpConfigPath?: string;
}

/**
 * MCP (Model Context Protocol) server configuration
 */
export interface McpServerConfig {
    /** Command to run the MCP server */
    command: string;

    /** Arguments for the command */
    args: string[];
}

/**
 * MCP configuration for an agent
 */
export interface McpConfig {
    /** Map of server name to server configuration */
    mcpServers: Record<string, McpServerConfig>;
}

/**
 * Abstract base class for code agents
 *
 * This class defines the contract that all code agent implementations must fulfill.
 * Each agent (Claude, OpenCode, etc.) extends this class and implements the
 * agent-specific behavior.
 *
 * @example
 * ```typescript
 * class ClaudeAgent extends CodeAgent {
 *   constructor() {
 *     super({
 *       name: 'claude',
 *       displayName: 'Claude',
 *       cliCommand: 'claude',
 *       sessionFileExtension: '.claude-session',
 *       statusFileExtension: '.claude-status',
 *       settingsFileName: 'claude-settings.json',
 *       defaultDataDir: '.claude'
 *     });
 *   }
 *
 *   // Implement all abstract methods...
 * }
 * ```
 */
export abstract class CodeAgent {
    /**
     * Create a new code agent
     * @param config Agent configuration
     * @throws Error if required configuration fields are missing or empty
     */
    constructor(protected readonly config: CodeAgentConfig) {
        // Validate required configuration fields
        if (!config.name || typeof config.name !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty name');
        }
        if (!config.displayName || typeof config.displayName !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty displayName');
        }
        if (!config.cliCommand || typeof config.cliCommand !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty cliCommand');
        }
        if (!config.sessionFileExtension || typeof config.sessionFileExtension !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty sessionFileExtension');
        }
        if (!config.statusFileExtension || typeof config.statusFileExtension !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty statusFileExtension');
        }
        if (!config.settingsFileName || typeof config.settingsFileName !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty settingsFileName');
        }
        if (!config.defaultDataDir || typeof config.defaultDataDir !== 'string') {
            throw new Error('CodeAgentConfig requires a non-empty defaultDataDir');
        }
    }

    // --- Config Getters ---

    /**
     * Get the agent's internal name
     */
    get name(): string {
        return this.config.name;
    }

    /**
     * Get the agent's display name
     */
    get displayName(): string {
        return this.config.displayName;
    }

    /**
     * Get the agent's CLI command
     */
    get cliCommand(): string {
        return this.config.cliCommand;
    }

    // --- File Naming ---

    /**
     * Get the session file name for this agent
     * @returns Session file name (e.g., '.claude-session')
     */
    abstract getSessionFileName(): string;

    /**
     * Get the status file name for this agent
     * @returns Status file name (e.g., '.claude-status')
     */
    abstract getStatusFileName(): string;

    /**
     * Get the settings file name for this agent
     * @returns Settings file name (e.g., 'claude-settings.json')
     */
    abstract getSettingsFileName(): string;

    /**
     * Get the default data directory for this agent
     * @returns Directory name (e.g., '.claude')
     */
    abstract getDataDirectory(): string;

    // --- Terminal Configuration ---

    /**
     * Get the terminal name for a session
     * @param sessionName The session name
     * @returns Terminal name to display
     */
    abstract getTerminalName(sessionName: string): string;

    /**
     * Get the terminal icon configuration
     * @returns Icon configuration with id and optional color
     */
    abstract getTerminalIcon(): { id: string; color?: string };

    // --- Command Building ---

    /**
     * Build the command to start a new agent session
     * @param options Command options
     * @returns Complete shell command string
     */
    abstract buildStartCommand(options: StartCommandOptions): string;

    /**
     * Build the command to resume an existing agent session
     * @param sessionId The session ID to resume
     * @param options Command options
     * @returns Complete shell command string
     */
    abstract buildResumeCommand(sessionId: string, options: ResumeCommandOptions): string;

    // --- Session/Status Parsing ---

    /**
     * Parse session data from file content
     * @param content Raw file content
     * @returns Parsed SessionData or null if invalid
     */
    abstract parseSessionData(content: string): SessionData | null;

    /**
     * Parse status from file content
     * @param content Raw file content
     * @returns Parsed AgentStatus or null if invalid
     */
    abstract parseStatus(content: string): AgentStatus | null;

    /**
     * Get the list of valid status states for this agent
     * @returns Array of valid status strings
     */
    abstract getValidStatusStates(): string[];

    // --- Permission Modes ---

    /**
     * Get available permission modes for this agent
     * @returns Array of permission mode configurations
     */
    abstract getPermissionModes(): PermissionMode[];

    /**
     * Validate that a permission mode is supported
     * @param mode The mode to validate
     * @returns true if valid, false otherwise
     */
    abstract validatePermissionMode(mode: string): boolean;

    /**
     * Get the CLI flag for a permission mode
     * @param mode The permission mode
     * @returns The CLI flag string
     */
    abstract getPermissionFlag(mode: string): string;

    // --- Hooks ---

    /**
     * Get the list of hook events supported by this agent
     * @returns Array of event names (e.g., ['SessionStart', 'StatusUpdate'])
     */
    abstract getHookEvents(): string[];

    /**
     * Generate hook configurations for a worktree
     * @param worktreePath Path to the worktree
     * @param sessionFilePath Path to the session file
     * @param statusFilePath Path to the status file
     * @returns Array of hook configurations
     */
    abstract generateHooksConfig(
        worktreePath: string,
        sessionFilePath: string,
        statusFilePath: string
    ): HookConfig[];

    // --- MCP Support (Optional) ---

    /**
     * Check if this agent supports MCP (Model Context Protocol)
     * @returns true if MCP is supported, false otherwise
     */
    supportsMcp(): boolean {
        return false;
    }

    /**
     * Get MCP configuration for a worktree
     * Override this method if supportsMcp() returns true
     * @param worktreePath Path to the worktree
     * @param workflowPath Path to the workflow YAML file
     * @param repoRoot Path to the repository root (for pending sessions directory)
     * @returns MCP configuration object, or null if MCP is not supported
     */
    getMcpConfig(_worktreePath: string, _workflowPath: string, _repoRoot: string): McpConfig | null {
        return null;
    }
}
