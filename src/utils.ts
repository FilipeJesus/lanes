/**
 * Shared utilities for Lanes extension.
 *
 * This module contains pure functions that don't depend on VS Code APIs,
 * so they can be used both in the extension and in standalone contexts (e.g., MCP server).
 */

/**
 * Sanitize a session name to be a valid git branch name.
 * Git branch naming rules:
 * - Allowed: letters, numbers, hyphens, underscores, dots, forward slashes
 * - Cannot start with '-', '.', or '/'
 * - Cannot end with '.', '/', or '.lock'
 * - Cannot contain '..' or '//'
 *
 * @param name The raw session name from user input
 * @returns Sanitized name safe for git branches, or empty string if nothing valid remains
 */
export function sanitizeSessionName(name: string): string {
    if (!name) {
        return '';
    }

    let result = name;

    // Step 1: Replace spaces with hyphens
    result = result.replace(/\s+/g, '-');

    // Step 2: Replace invalid characters (not in [a-zA-Z0-9_\-./]) with hyphens
    // This also handles consecutive invalid chars by replacing them all with hyphens
    result = result.replace(/[^a-zA-Z0-9_\-./]+/g, '-');

    // Step 3: Replace consecutive hyphens with single hyphen
    result = result.replace(/-+/g, '-');

    // Step 4: Replace consecutive dots with single dot
    result = result.replace(/\.+/g, '.');

    // Step 5: Replace consecutive slashes with single slash
    result = result.replace(/\/+/g, '/');

    // Step 6: Remove leading hyphens, dots, or slashes
    result = result.replace(/^[-./]+/, '');

    // Step 7: Remove trailing dots or slashes
    result = result.replace(/[./]+$/, '');

    // Step 8: Remove .lock suffix (only at the end)
    if (result.endsWith('.lock')) {
        result = result.slice(0, -5);
    }

    // Step 9: After removing .lock, we might have trailing dots/slashes again
    result = result.replace(/[./]+$/, '');

    // Step 10: Clean up leading chars again (in case .lock removal exposed them)
    result = result.replace(/^[-./]+/, '');

    // Step 11: Remove leading/trailing hyphens that may have been created
    result = result.replace(/^-+/, '').replace(/-+$/, '');

    // Step 12: Final security check - reject any path traversal attempts (..)
    if (result.includes('..')) {
        return '';
    }

    return result;
}

/**
 * Helper to get error message from unknown error type.
 *
 * @param err Unknown error value
 * @returns Error message string
 */
export function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Get the default worktrees folder name.
 *
 * @returns The default worktrees folder name
 */
export const DEFAULT_WORKTREES_FOLDER = '.worktrees';
