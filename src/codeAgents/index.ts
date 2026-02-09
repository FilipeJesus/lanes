/**
 * Code Agents Module
 *
 * This module provides an abstraction layer for different code agents (Claude, OpenCode, etc.)
 * allowing the extension to support multiple AI code assistants with agent-specific behaviors.
 */

// Export all interfaces
export type {
    CodeAgentConfig,
    SessionData,
    AgentStatus,
    PermissionMode,
    HookCommand,
    HookConfig,
    StartCommandOptions,
    ResumeCommandOptions,
    McpServerConfig,
    McpConfig
} from './CodeAgent';

// Export the abstract base class
export { CodeAgent } from './CodeAgent';

// Export concrete implementations
export { ClaudeCodeAgent } from './ClaudeCodeAgent';
