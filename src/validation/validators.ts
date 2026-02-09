/**
 * Core validator functions for Lanes extension.
 *
 * This module provides reusable validation functions that follow the ValidationResult
 * pattern established in src/utils.ts. All validators return ValidationResult objects
 * for consistent error handling.
 *
 * Security-first approach:
 * - Reject invalid input rather than silently sanitizing
 * - Provide clear error messages for users
 * - Check for path traversal, null bytes, and other malicious patterns
 */

import type { ValidationResult } from '../utils';

/**
 * Maximum length for session names.
 * Git refs have practical limits - this provides a safe boundary.
 */
const MAX_SESSION_NAME_LENGTH = 200;

/**
 * Validates a session name for security and Git compatibility.
 *
 * Security checks:
 * - Empty or whitespace-only names are rejected
 * - Path traversal sequences (..) are rejected
 * - Null bytes (\x00) are rejected
 * - Excessive length (>200 chars) is rejected
 *
 * Note: This is for validation, not sanitization. For display purposes,
 * use sanitizeSessionName from utils.ts.
 *
 * @param name The session name to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateSessionName(name: string): ValidationResult {
    // Check for empty or whitespace-only names
    if (!name || name.trim().length === 0) {
        return { valid: false, error: 'Session name cannot be empty' };
    }

    const trimmed = name.trim();

    // Security: Path traversal detection - reject any '..' sequences
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: 'Session name cannot contain ".." (path traversal not allowed)'
        };
    }

    // Security: Null byte detection - can be used for string truncation attacks
    if (trimmed.includes('\x00')) {
        return {
            valid: false,
            error: 'Session name contains invalid characters (null byte)'
        };
    }

    // Length limit - prevents issues with Git refs and filesystem
    if (trimmed.length > MAX_SESSION_NAME_LENGTH) {
        return {
            valid: false,
            error: `Session name is too long (maximum ${MAX_SESSION_NAME_LENGTH} characters)`
        };
    }

    return { valid: true };
}

/**
 * Options for validateRelativePath.
 */
export interface ValidateRelativePathOptions {
    /** Allow parent directory references (..) in the path. Default: false */
    allowTraversal?: boolean;
    /** Allow absolute paths. Default: false */
    allowAbsolute?: boolean;
}

/**
 * Validates a relative path to ensure it stays within expected bounds.
 *
 * Used for validating user-provided paths like workflow folders, prompts folders, etc.
 *
 * @param path The path to validate
 * @param options Optional validation settings
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateRelativePath(path: string, options: ValidateRelativePathOptions = {}): ValidationResult {
    const { allowTraversal = false, allowAbsolute = false } = options;

    // Check for empty paths
    if (!path || path.trim().length === 0) {
        return { valid: false, error: 'Path cannot be empty' };
    }

    const trimmed = path.trim();

    // Check for path traversal unless explicitly allowed
    if (!allowTraversal && trimmed.includes('..')) {
        return {
            valid: false,
            error: 'Path cannot contain ".." (parent directory references not allowed)'
        };
    }

    // Check for absolute paths unless explicitly allowed
    // Using a simple check for absolute paths that works cross-platform
    if (!allowAbsolute) {
        // Unix absolute paths start with /
        if (trimmed.startsWith('/')) {
            return {
                valid: false,
                error: 'Absolute paths are not allowed for this setting'
            };
        }
        // Windows absolute paths start with drive letter (e.g., C:) or UNC (\\)
        if (/^[a-zA-Z]:/.test(trimmed) || trimmed.startsWith('\\')) {
            return {
                valid: false,
                error: 'Absolute paths are not allowed for this setting'
            };
        }
    }

    return { valid: true };
}

/**
 * Validates a configuration string value.
 *
 * Generic validator for configuration values that should be non-empty strings
 * without leading/trailing whitespace.
 *
 * @param value The value to validate
 * @param fieldName The name of the field (for error messages)
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateConfigString(value: unknown, fieldName: string): ValidationResult {
    if (typeof value !== 'string') {
        return { valid: false, error: `${fieldName} must be a string` };
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
        return { valid: false, error: `${fieldName} cannot be empty` };
    }

    // Check for whitespace padding (value changed after trim)
    if (trimmed !== value) {
        return { valid: false, error: `${fieldName} cannot have leading or trailing whitespace` };
    }

    return { valid: true };
}
