/**
 * CLI utility functions shared across commands.
 */

import * as path from 'path';
import { execGit, initializeGitPath } from '../core/gitService';
import { fileExists } from '../core/services/FileService';
import * as SettingsService from '../core/services/SettingsService';
import { CliConfigProvider } from './adapters/CliConfigProvider';
import { CliGitPathResolver } from './adapters/CliGitPathResolver';
import { setConfigCallbacks, initializeGlobalStorageContext } from '../core/session/SessionDataService';

/**
 * Resolve the base repo root from the current working directory.
 * Handles being run from inside a worktree.
 */
export async function resolveRepoRoot(): Promise<string> {
    const cwd = process.cwd();

    // Find the git toplevel (handles running from subdirectories)
    let toplevel: string;
    if (await fileExists(path.join(cwd, '.git'))) {
        toplevel = cwd;
    } else {
        try {
            const result = await execGit(['rev-parse', '--show-toplevel'], cwd);
            toplevel = result.trim();
        } catch {
            throw new Error('Not a git repository. Run from inside a git repo or run "git init" first.');
        }
    }

    // Always resolve to base repo root (handles worktree paths)
    return SettingsService.getBaseRepoPath(toplevel);
}

/**
 * Resolve the package root directory (parent of `out/` where the bundled CLI lives).
 * Used to locate built-in assets like workflow templates.
 */
export function getPackageRoot(): string {
    return path.resolve(__dirname, '..');
}

/**
 * Initialize the CLI environment: git path, config, session data service.
 * Returns the config provider and repo root for use by commands.
 */
export async function initCli(): Promise<{ config: CliConfigProvider; repoRoot: string }> {
    // Resolve git path
    const gitResolver = new CliGitPathResolver();
    const gitPath = await gitResolver.resolveGitPath();
    initializeGitPath(gitPath);

    // Resolve repo root
    const repoRoot = await resolveRepoRoot();

    // Load config
    const config = new CliConfigProvider(repoRoot);
    await config.load();

    // Wire up SessionDataService config callbacks
    setConfigCallbacks({
        getWorktreesFolder: () => config.get('lanes', 'worktreesFolder', '.worktrees'),
        getPromptsFolder: () => config.get('lanes', 'promptsFolder', ''),
    });

    // Initialize storage context (CLI uses repo-local paths)
    initializeGlobalStorageContext(
        path.join(repoRoot, '.lanes'),
        repoRoot,
        undefined  // Agent set per-command
    );

    return { config, repoRoot };
}

// Re-export from core for backward compatibility
export { getBranchesInWorktrees } from '../core/services/BrokenWorktreeService';

/**
 * Print an error message and exit with code 1.
 */
export function exitWithError(message: string): never {
    console.error(`Error: ${message}`);
    process.exit(1);
}
