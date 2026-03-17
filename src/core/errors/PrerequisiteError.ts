/**
 * Error thrown when a required system dependency is missing.
 *
 * Used to surface actionable setup issues without misclassifying them as
 * internal server errors.
 */
export class PrerequisiteError extends Error {
    public readonly missing: string[];

    constructor(message: string, missing: string[]) {
        super(message);
        this.name = 'PrerequisiteError';
        this.missing = missing;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, PrerequisiteError);
        }
    }
}
