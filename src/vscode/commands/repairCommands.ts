import * as vscode from 'vscode';
import type { ServiceContainer } from '../../types/serviceContainer';
import * as BrokenWorktreeService from '../../core/services/BrokenWorktreeService';
import { getWorktreesFolder } from '../providers/AgentSessionProvider';

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

        const brokenWorktrees = await BrokenWorktreeService.detectBrokenWorktrees(baseRepoPath, getWorktreesFolder());

        if (brokenWorktrees.length === 0) {
            vscode.window.showInformationMessage('No broken worktrees found.');
            return;
        }

        const sessionNames = brokenWorktrees.map(w => w.sessionName).join(', ');
        const count = brokenWorktrees.length;
        const plural = count > 1 ? 's' : '';

        const answer = await vscode.window.showWarningMessage(
            `Found ${count} broken worktree${plural}: ${sessionNames}. This can happen after a container rebuild. Would you like to repair them?`,
            'Repair',
            'Ignore'
        );

        if (answer !== 'Repair') {
            return;
        }

        const result = await BrokenWorktreeService.repairBrokenWorktrees(baseRepoPath, brokenWorktrees);

        if (result.failures.length === 0) {
            vscode.window.showInformationMessage(
                `Successfully repaired ${result.successCount} worktree${result.successCount > 1 ? 's' : ''}.`
            );
        } else if (result.successCount > 0) {
            vscode.window.showWarningMessage(
                `Repaired ${result.successCount} worktree${result.successCount > 1 ? 's' : ''}, but ${result.failures.length} failed. Check the console for details.`
            );
            console.error('Lanes: Failed to repair some worktrees:', result.failures.map(f => `${f.sessionName}: ${f.error}`));
        } else {
            vscode.window.showErrorMessage(
                `Failed to repair worktrees. Check the console for details.`
            );
            console.error('Lanes: Failed to repair worktrees:', result.failures.map(f => `${f.sessionName}: ${f.error}`));
        }
    });

    // Register all disposables
    context.subscriptions.push(repairBrokenWorktreesDisposable);
}
