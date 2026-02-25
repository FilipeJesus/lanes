/**
 * Git Service - VS Code adapter layer
 *
 * Delegates to core/gitService for the actual implementation.
 * Also provides the VS Code-specific initializeGitPath that uses VscodeGitPathResolver.
 *
 * NOTE: Uses wrapper functions (not re-exports) to ensure sinon stubs in tests
 * can intercept calls from other modules that import from this file.
 */

import * as coreGitService from './core/gitService';
import { VscodeGitPathResolver } from './vscode/adapters/VscodeGitPathResolver';

export type { ExecGitOptions } from './core/gitService';

/**
 * Initialize the git service by attempting to get the git path from VS Code's Git Extension.
 * Falls back to 'git' if the extension is not available.
 * Should be called during extension activation.
 */
export async function initializeGitPath(): Promise<void> {
    const resolver = new VscodeGitPathResolver();
    const resolvedPath = await resolver.resolveGitPath();
    coreGitService.initializeGitPath(resolvedPath);
}

/**
 * Get the current git executable path.
 */
export function getGitPath(): string {
    return coreGitService.getGitPath();
}

/**
 * Execute a git command using spawn (no shell).
 */
export function execGit(args: string[], cwd: string, options?: coreGitService.ExecGitOptions): Promise<string> {
    return coreGitService.execGit(args, cwd, options);
}
