/**
 * Configuration schema validators for Lanes extension settings.
 *
 * This module provides runtime validation for VS Code configuration values.
 * While VS Code validates against the schema in package.json for UI edits,
 * users can edit settings.json directly with arbitrary values. These validators
 * ensure config values are safe at runtime.
 *
 * Each validator matches a configuration property defined in package.json
 * under "contributes.configuration.properties".
 */

import * as path from 'path';
import type { ValidationResult } from '../utils';

/**
 * Invalid characters for Windows file paths.
 * These characters cannot appear in file/folder names on Windows.
 * Source: https://docs.microsoft.com/en-us/windows/win32/fileio/naming-a-file
 */
const INVALID_WINDOWS_CHARS = /[<>:"|?*\x00-\x1F]/;

/**
 * Validates the lanes.worktreesFolder configuration value.
 *
 * Requirements (from package.json and ClaudeSessionProvider.ts):
 * - Must be a string
 * - Cannot be empty
 * - Cannot have leading/trailing whitespace
 * - Cannot contain path traversal (..)
 * - Cannot be an absolute path
 * - Cannot contain invalid Windows characters
 *
 * @param value The configuration value to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateWorktreesFolder(value: unknown): ValidationResult {
    // Type check
    if (typeof value !== 'string') {
        return { valid: false, error: 'worktreesFolder must be a string' };
    }

    const trimmed = value.trim();

    // Empty check
    if (trimmed.length === 0) {
        return { valid: false, error: 'worktreesFolder cannot be empty' };
    }

    // Whitespace padding check
    if (trimmed !== value) {
        return { valid: false, error: 'worktreesFolder cannot have leading or trailing whitespace' };
    }

    // Security: Reject path traversal
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: 'worktreesFolder cannot contain ".." (path traversal not allowed)'
        };
    }

    // Security: Reject absolute paths
    if (path.isAbsolute(trimmed)) {
        return {
            valid: false,
            error: 'Absolute paths are not allowed for worktreesFolder'
        };
    }

    // Reject invalid Windows filename characters
    if (INVALID_WINDOWS_CHARS.test(trimmed)) {
        return {
            valid: false,
            error: 'worktreesFolder contains invalid characters (< > : " | ? * are not allowed)'
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.promptsFolder configuration value.
 *
 * Requirements (from package.json and ClaudeSessionProvider.ts):
 * - Must be a string
 * - Empty string is VALID (means use global storage)
 * - Cannot contain path traversal (..)
 * - Cannot be an absolute path (relative paths only)
 *
 * @param value The configuration value to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validatePromptsFolder(value: unknown): ValidationResult {
    // Type check
    if (typeof value !== 'string') {
        return { valid: false, error: 'promptsFolder must be a string' };
    }

    const trimmed = value.trim();

    // Empty string is valid - means use global storage
    if (trimmed.length === 0) {
        return { valid: true };
    }

    // Security: Reject path traversal even for custom paths
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: 'promptsFolder cannot contain ".." (path traversal not allowed)'
        };
    }

    // Security: Reject absolute paths (only relative paths allowed)
    if (path.isAbsolute(trimmed)) {
        return {
            valid: false,
            error: 'Absolute paths are not allowed for promptsFolder (use relative paths only)'
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.localSettingsPropagation configuration value.
 *
 * Requirements (from package.json):
 * - Must be one of: 'copy', 'symlink', 'disabled'
 *
 * @param value The configuration value to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateLocalSettingsPropagation(value: unknown): ValidationResult {
    const VALID_VALUES = ['copy', 'symlink', 'disabled'] as const;

    // Type check
    if (typeof value !== 'string') {
        return {
            valid: false,
            error: `localSettingsPropagation must be one of: ${VALID_VALUES.join(', ')}`
        };
    }

    // Allowlist check
    if (!VALID_VALUES.includes(value as typeof VALID_VALUES[number])) {
        return {
            valid: false,
            error: `localSettingsPropagation must be one of: ${VALID_VALUES.join(', ')}`
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.customWorkflowsFolder configuration value.
 *
 * Requirements (from package.json):
 * - Must be a string
 * - Empty string is allowed (uses default .lanes/workflows)
 * - Cannot contain path traversal (..)
 * - Cannot be an absolute path (relative paths only)
 *
 * @param value The configuration value to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateCustomWorkflowsFolder(value: unknown): ValidationResult {
    // Type check
    if (typeof value !== 'string') {
        return { valid: false, error: 'customWorkflowsFolder must be a string' };
    }

    const trimmed = value.trim();

    // Empty string is valid - uses default location
    if (trimmed.length === 0) {
        return { valid: true };
    }

    // Security: Reject path traversal
    if (trimmed.includes('..')) {
        return {
            valid: false,
            error: 'customWorkflowsFolder cannot contain ".." (path traversal not allowed)'
        };
    }

    // Security: Reject absolute paths (relative to workspace root only)
    if (path.isAbsolute(trimmed)) {
        return {
            valid: false,
            error: 'Absolute paths are not allowed for customWorkflowsFolder (use relative paths only)'
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.chimeSound configuration value.
 *
 * Requirements (from package.json):
 * - Must be one of: 'chime', 'alarm', 'level-up', 'notification'
 *
 * @param value The configuration value to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateChimeSound(value: unknown): ValidationResult {
    const VALID_VALUES = ['chime', 'alarm', 'level-up', 'notification'] as const;

    // Type check
    if (typeof value !== 'string') {
        return {
            valid: false,
            error: `chimeSound must be one of: ${VALID_VALUES.join(', ')}`
        };
    }

    // Allowlist check
    if (!VALID_VALUES.includes(value as typeof VALID_VALUES[number])) {
        return {
            valid: false,
            error: `chimeSound must be one of: ${VALID_VALUES.join(', ')}`
        };
    }

    return { valid: true };
}

/**
 * Validates the lanes.comparisonRef configuration value.
 *
 * Requirements (from package.json):
 * - Must be a string
 * - Empty string is valid (auto-detect branch)
 * - No specific format constraints (Git ref validation happens separately)
 *
 * @param value The configuration value to validate
 * @returns ValidationResult indicating validity with optional error message
 */
export function validateComparisonRef(value: unknown): ValidationResult {
    // Type check (empty string is valid for auto-detection)
    if (typeof value !== 'string') {
        return { valid: false, error: 'comparisonRef must be a string' };
    }

    // Empty string is valid - means auto-detect
    if (value.trim().length === 0) {
        return { valid: true };
    }

    // Basic validation - reject obvious injection attempts
    if (value.includes('\x00')) {
        return { valid: false, error: 'comparisonRef contains invalid characters' };
    }

    return { valid: true };
}
