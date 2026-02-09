/**
 * Shared utilities for Lanes extension.
 *
 * This module contains pure functions that don't depend on VS Code APIs,
 * so they can be used both in the extension and in standalone contexts (e.g., MCP server).
 */

/**
 * Result of branch name validation.
 */
export interface ValidationResult {
    valid: boolean;
    error?: string;
}

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

/**
 * Validate a branch name against Git's branch naming rules.
 *
 * Git branch naming rules (from git-check-ref-format):
 * - Cannot contain ASCII control chars (bytes < 0x20, 0x7F DEL)
 * - Cannot contain spaces, ~, ^, :, ?, *, [, \
 * - Cannot start or end with dot
 * - Cannot contain .. or // sequences
 * - Cannot contain @{ sequences
 * - Cannot end with .lock
 *
 * This is VALIDATION (not sanitization) - rejects invalid input rather than transforming it.
 * The existing sanitizeSessionName is for display names, but branch names must be
 * validated before Git operations.
 *
 * @param branch The branch name to validate
 * @returns ValidationResult with valid flag and optional error message
 */
export function validateBranchName(branch: string): ValidationResult {
    if (!branch) {
        return { valid: false, error: 'Branch name cannot be empty' };
    }

    // Check for ASCII control characters (including DEL 0x7F)
    const INVALID_CHARS_REGEX = /[\x00-\x1F\x7F ~^:?*[\]\\]/;
    if (INVALID_CHARS_REGEX.test(branch)) {
        return {
            valid: false,
            error: `Branch '${branch}' contains invalid characters. Worktrees cannot be created from this branch.`
        };
    }

    // Check for leading or trailing dots
    const LEADING_TRAILING_DOT_REGEX = /^\.|\.$/;
    if (LEADING_TRAILING_DOT_REGEX.test(branch)) {
        return {
            valid: false,
            error: `Branch '${branch}' contains invalid characters. Worktrees cannot be created from this branch.`
        };
    }

    // Check for .. or // sequences
    const DOT_SEQUENCE_REGEX = /\.\.|\/\//;
    if (DOT_SEQUENCE_REGEX.test(branch)) {
        return {
            valid: false,
            error: `Branch '${branch}' contains invalid sequences. Worktrees cannot be created from this branch.`
        };
    }

    // Check for @{ sequences (used for git reflog syntax)
    const BRACE_SEQUENCE_REGEX = /@\{/;
    if (BRACE_SEQUENCE_REGEX.test(branch)) {
        return {
            valid: false,
            error: `Branch '${branch}' contains invalid characters. Worktrees cannot be created from this branch.`
        };
    }

    // Check for .lock suffix
    const LOCK_SUFFIX_REGEX = /\.lock$/;
    if (LOCK_SUFFIX_REGEX.test(branch)) {
        return {
            valid: false,
            error: `Branch '${branch}' contains invalid characters. Worktrees cannot be created from this branch.`
        };
    }

    return { valid: true };
}
