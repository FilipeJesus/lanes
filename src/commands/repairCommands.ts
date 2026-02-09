import * as vscode from 'vscode';
import type { ServiceContainer } from '../types/serviceContainer';
import * as BrokenWorktreeService from '../services/BrokenWorktreeService';

/**
 * Register all repair-related commands.
 * Repair commands handle detecting and fixing broken worktrees.
 *
 * @param context - VS Code extension context
 * @param services - Service container with all dependencies
 */
export function registerRepairCommands(
    context: vscode.ExtensionContext,
    services: ServiceContainer
): void {
    const { baseRepoPath } = services;

    // Command: Check for and repair broken worktrees
    const repairBrokenWorktreesDisposable = vscode.commands.registerCommand('lanes.repairBrokenWorktrees', async () => {
        if (!baseRepoPath) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        await BrokenWorktreeService.checkAndRepairBrokenWorktrees(baseRepoPath);
    });

    // Register all disposables
    context.subscriptions.push(repairBrokenWorktreesDisposable);
}
