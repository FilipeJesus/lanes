/**
 * Core module barrel export.
 *
 * Re-exports the public API of the platform-agnostic core.
 * This module has zero VS Code dependencies.
 */

// Interfaces
export * from './interfaces';

// Session management
export * from './session';

// Services
export * from './services/FileService';
export * from './services/DiffService';
export * from './services/TmuxService';
export * from './services/SettingsService';
export * from './services/BrokenWorktreeService';
export * from './services/WorkflowService';
export * from './services/InsightsService';
export * from './services/InsightsAnalyzer';
export * from './services/SettingsFormatService';
export * from './services/McpAdapter';

// Code agents
export * from './codeAgents';

// Git
export { initializeGitPath, getGitPath, execGit } from './gitService';
export type { ExecGitOptions } from './gitService';

// Errors
export * from './errors';

// Validation
export * from './validation';

// Workflow
export * from './workflow';

// Utilities
export { getErrorMessage, type ValidationResult } from './utils';
export { AsyncQueue } from './AsyncQueue';
export { propagateLocalSettings, type LocalSettingsPropagationMode } from './localSettings';
