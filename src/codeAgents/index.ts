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
    McpConfig,
    McpConfigDelivery,
    AgentFeature,
    CapturedSession
} from './CodeAgent';

// Export the abstract base class
export { CodeAgent } from './CodeAgent';

// Export concrete implementations
export { ClaudeCodeAgent } from './ClaudeCodeAgent';
export { CodexAgent } from './CodexAgent';
export { CortexCodeAgent } from './CortexCodeAgent';
export { GeminiAgent } from './GeminiAgent';
export { OpenCodeAgent } from './OpenCodeAgent';

// Export factory functions and constants
export { getAgent, getAvailableAgents, getDefaultAgent, isCliAvailable, validateAndGetAgent, DEFAULT_AGENT_NAME } from './factory';
