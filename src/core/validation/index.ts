/**
 * Validation module barrel export.
 *
 * This module provides a centralized API for all validation functions
 * in the Lanes extension. Import from here to access validators,
 * path sanitizers, and configuration schema validators.
 *
 * @example
 * ```ts
 * import { validateSessionName, safeResolve } from './validation';
 *
 * const validation = validateSessionName(userInput);
 * if (!validation.valid) {
 *   throw new ValidationError('sessionName', userInput, validation.error);
 * }
 * ```
 */

// Re-export ValidationResult for convenience
export type { ValidationResult } from '../utils';

// Core validators
export {
    validateSessionName,
    validateRelativePath,
    validateConfigString,
    type ValidateRelativePathOptions
} from './validators';

// Configuration schema validators
export {
    validateWorktreesFolder,
    validatePromptsFolder,
    validateLocalSettingsPropagation,
    validateCustomWorkflowsFolder,
    validateChimeSound,
    validateComparisonRef
} from './schemas';

// Path security utilities
export {
    safeResolve,
    sanitizeForDisplay,
    isPathWithinBase,
    normalizePath
} from './pathSanitizer';
