import * as vscode from 'vscode';
import type { ClaudeSessionProvider } from '../ClaudeSessionProvider';
import type { SessionFormProvider } from '../SessionFormProvider';
import type { PreviousSessionProvider } from '../PreviousSessionProvider';
import type { WorkflowsProvider } from '../WorkflowsProvider';
import type { CodeAgent } from '../codeAgents';

/**
 * Service container for dependency injection.
 * Passes all necessary dependencies to command registration functions.
 */
export interface ServiceContainer {
    // VS Code API
    extensionContext: vscode.ExtensionContext;

    // Providers
    sessionProvider: ClaudeSessionProvider;
    sessionFormProvider: SessionFormProvider;
    previousSessionProvider: PreviousSessionProvider;
    workflowsProvider: WorkflowsProvider;

    // Paths
    workspaceRoot: string | undefined;
    baseRepoPath: string | undefined;
    extensionPath: string;

    // Code agent
    codeAgent: CodeAgent;
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
