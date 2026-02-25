/**
 * Path security utilities for Lanes extension.
 *
 * This module provides safe path resolution and sanitization functions
 * to prevent path traversal attacks and ensure file system operations
 * stay within expected boundaries.
 *
 * Security properties:
 * - safeResolve() guarantees the result is within basePath
 * - sanitizeForDisplay() produces safe strings for UI display (NOT for security)
 */

import * as path from 'path';

/**
 * Maximum length for display strings.
 */
const MAX_DISPLAY_LENGTH = 50;

/**
 * Pattern for characters allowed in display strings.
 * Keeps word characters, hyphens, periods, and forward slashes.
 */
const DISPLAY_CHAR_PATTERN = /[^\w\-./]/g;

/**
 * Resolves a relative path against a base path, ensuring no traversal.
 *
 * Security properties:
 * - Normalizes both paths to handle '.' and '..' segments
 * - Verifies the resolved path is within the base path
 * - Returns null if traversal would escape the base directory
 *
 * Use this function before any file system operations with user-provided paths.
 *
 * @param basePath The base directory path (must be absolute or will be resolved)
 * @param relativePath The relative path from basePath (user-provided)
 * @returns Normalized safe path, or null if traversal detected
 *
 * @example
 * ```ts
 * const safe = safeResolve('/home/user/project', '../etc/passwd');
 * // Returns null - traversal detected
 *
 * const safe2 = safeResolve('/home/user/project', 'src/file.txt');
 * // Returns '/home/user/project/src/file.txt'
 * ```
 */
export function safeResolve(basePath: string, relativePath: string): string | null {
    // Resolve the combined path
    const resolved = path.resolve(basePath, relativePath);

    // Normalize both paths for consistent comparison
    // This handles platform-specific path separators and redundant segments
    const normalizedResolved = path.normalize(resolved);
    const normalizedBase = path.normalize(basePath);

    // Check if the resolved path starts with the base path
    // This ensures no path traversal can escape the base directory
    if (!normalizedResolved.startsWith(normalizedBase)) {
        // Path traversal detected - would escape base directory
        return null;
    }

    return normalizedResolved;
}

/**
 * Sanitizes a user-provided string for display purposes.
 *
 * WARNING: This function is for display purposes ONLY. It does NOT
 * provide security guarantees. Always validate input before using it
 * in file system operations.
 *
 * Transformations:
 * - Trims whitespace
 * - Replaces spaces with hyphens
 * - Removes invalid characters (keeps [\w\-./])
 * - Truncates to 50 characters
 *
 * @param input The raw input string from user
 * @returns Sanitized string safe for display
 *
 * @example
 * ```ts
 * sanitizeForDisplay('Fix Login Bug');
 * // Returns 'Fix-Login-Bug'
 *
 * sanitizeForDisplay('feature/super-long-name-that-exceeds-limit');
 * // Returns truncated to 50 chars
 * ```
 */
export function sanitizeForDisplay(input: string): string {
    if (!input) {
        return '';
    }

    return input
        .trim()                          // Remove leading/trailing whitespace
        .replace(/\s+/g, '-')            // Replace spaces with hyphens
        .replace(DISPLAY_CHAR_PATTERN, '') // Remove invalid characters
        .substring(0, MAX_DISPLAY_LENGTH); // Truncate to max length
}

/**
 * Validates that a path is within a base directory.
 *
 * This is a read-only check that doesn't modify the paths.
 * Useful for validation before performing operations.
 *
 * @param basePath The base directory path
 * @param targetPath The path to check
 * @returns true if targetPath is within basePath, false otherwise
 */
export function isPathWithinBase(basePath: string, targetPath: string): boolean {
    const normalizedBase = path.normalize(basePath);
    const normalizedTarget = path.normalize(targetPath);

    return normalizedTarget.startsWith(normalizedBase);
}

/**
 * Normalizes a path for consistent comparison.
 *
 * Handles platform-specific differences:
 * - Converts backslashes to forward slashes on Windows
 * - Resolves '.' and '..' segments
 * - Removes redundant separators
 *
 * @param inputPath The path to normalize
 * @returns Normalized path string
 */
export function normalizePath(inputPath: string): string {
    return path.normalize(inputPath);
}
