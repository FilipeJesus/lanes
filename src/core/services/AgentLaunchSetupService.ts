/**
 * Backward-compatible wrapper for AgentLaunchService.
 *
 * All functionality has been consolidated into AgentLaunchService.
 * This module re-exports the public API so existing consumers and tests
 * continue to work (including sinon stubs).
 */

import {
    prepareAgentLaunchContext as _prepareAgentLaunchContext,
    buildAgentLaunchCommand as _buildAgentLaunchCommand,
    normalizeMcpConfig as _normalizeMcpConfig,
} from './AgentLaunchService';

// Re-export types
export type {
    LaunchContext,
    LaunchMode,
    LaunchCommandResult,
    LaunchCommandInput,
} from './AgentLaunchService';

export type { PrepareAgentLaunchOptions as LaunchContextInput } from './AgentLaunchService';

// Re-export functions as writable properties (required for sinon stubs in tests)
export const prepareAgentLaunchContext = _prepareAgentLaunchContext;
export const buildAgentLaunchCommand = _buildAgentLaunchCommand;
export const normalizeMcpConfig = _normalizeMcpConfig;
