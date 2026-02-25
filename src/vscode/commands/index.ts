import * as vscode from 'vscode';
import type { ServiceContainer } from '../../types/serviceContainer';
import { registerSessionCommands } from './sessionCommands';
import { registerWorkflowCommands } from './workflowCommands';
import { registerRepairCommands } from './repairCommands';

/**
 * Register all commands for the extension.
 * This is the main entry point for command registration, called from activate().
 *
 * @param context - VS Code extension context
 * @param services - Service container with all dependencies
 * @param refreshWorkflows - Callback to refresh workflow views
 */
export function registerAllCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer,
    refreshWorkflows: () => Promise<void>
): void {
    registerSessionCommands(context, services);
    registerWorkflowCommands(context, services, refreshWorkflows);
    registerRepairCommands(context, services);
}

/**
 * Re-export register functions for direct use if needed.
 */
export { registerSessionCommands } from './sessionCommands';
export { registerWorkflowCommands } from './workflowCommands';
export { registerRepairCommands } from './repairCommands';
