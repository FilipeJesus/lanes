import { LanesError } from './LanesError';

/**
 * Error thrown when user input fails validation.
 *
 * Provides structured information about which field failed validation
 * and the specific reason for the failure.
 */
export class ValidationError extends LanesError {
    public readonly kind = 'validation' as const;

    /**
     * The field name that failed validation (e.g., 'branchName', 'sessionName').
     */
    public readonly field: string;

    /**
     * The invalid value that was provided (truncated for security).
     */
    public readonly value: string;

    /**
     * The specific reason why validation failed.
     */
    public readonly reason: string;

    /**
     * Creates a new ValidationError.
     *
     * @param field - The field name that failed validation
     * @param value - The invalid value provided
     * @param reason - The specific validation failure reason
     */
    constructor(field: string, value: string, reason: string) {
        // Truncate value to prevent abuse in error messages
        const truncatedValue = value.length > 100 ? `${value.slice(0, 100)}...` : value;

        const message = `Validation failed for field "${field}": ${reason}`;
        const userMessage = `Invalid ${field}: "${truncatedValue}". ${reason}`;

        super(message, userMessage);

        this.name = 'ValidationError';
        this.field = field;
        this.value = truncatedValue;
        this.reason = reason;

        // Maintains proper stack trace (V8-only)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ValidationError);
        }
    }
}
