import * as vscode from 'vscode';
import type { AgentSessionProvider } from '../vscode/providers/AgentSessionProvider';
import type { SessionFormProvider } from '../vscode/providers/SessionFormProvider';
import type { PreviousSessionProvider } from '../vscode/providers/PreviousSessionProvider';
import type { WorkflowsProvider } from '../vscode/providers/WorkflowsProvider';
import type { CodeAgent } from '../core/codeAgents';
import type { DaemonClient } from '../daemon/client';
import type { WorkspaceSupportState } from '../vscode/workspaceSupport';

/**
 * Service container for dependency injection.
 * Passes all necessary dependencies to command registration functions.
 */
export interface ServiceContainer {
    // VS Code API
    extensionContext: vscode.ExtensionContext;

    // Providers
    sessionProvider: AgentSessionProvider;
    sessionFormProvider: SessionFormProvider;
    previousSessionProvider: PreviousSessionProvider;
    workflowsProvider: WorkflowsProvider;

    // Paths
    workspaceRoot: string | undefined;
    baseRepoPath: string | undefined;
    workspaceSupport: WorkspaceSupportState;
    extensionPath: string;

    // Code agent
    codeAgent: CodeAgent;

    // Whether daemon mode is configured on for this window.
    daemonModeEnabled: boolean;

    // Optional daemon client (present only when lanes.useDaemon is true and daemon is reachable)
    daemonClient?: DaemonClient;
}

/**
 * Service container options type (same as ServiceContainer).
 */
export type ServiceContainerOptions = ServiceContainer;

/**
 * Warned merge base branches set (shared for diff operations).
 * This tracks branches that have already shown merge-base warnings.
 */
export interface WarnedMergeBaseBranches {
    has(branch: string): boolean;
    add(branch: string): void;
}
