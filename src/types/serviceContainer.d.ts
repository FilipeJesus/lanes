import * as vscode from 'vscode';
import type { ClaudeSessionProvider } from '../ClaudeSessionProvider';
import type { SessionFormProvider } from '../SessionFormProvider';
import type { PreviousSessionProvider } from '../PreviousSessionProvider';
import type { WorkflowsProvider } from '../WorkflowsProvider';
import type { GitChangesPanel } from '../GitChangesPanel';
import type { CodeAgent } from '../codeAgents';

/**
 * Service container for dependency injection.
 * Passes all necessary dependencies to command registration functions.
 */
export interface ServiceContainer {
    // VS Code API
    output: vscode.OutputChannel;
    extensionContext: vscode.ExtensionContext;

    // Providers
    sessionProvider: ClaudeSessionProvider;
    sessionFormProvider: SessionFormProvider;
    previousSessionProvider: PreviousSessionProvider;
    workflowsProvider: WorkflowsProvider;
    gitChangesPanel: GitChangesPanel;

    // Paths
    workspaceRoot: string | undefined;
    baseRepoPath: string | undefined;
    extensionPath: string;

    // Code agent
    codeAgent: CodeAgent;
}

/**
 * Service container options without output channel.
 * Output channel is created separately and added to the full container.
 */
export type ServiceContainerOptions = Omit<ServiceContainer, 'output'>;

/**
 * Warned merge base branches set (shared for diff operations).
 * This tracks branches that have already shown merge-base warnings.
 */
export interface WarnedMergeBaseBranches {
    has(branch: string): boolean;
    add(branch: string): void;
}
