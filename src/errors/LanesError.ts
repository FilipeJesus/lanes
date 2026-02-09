/**
 * Base error class for all Lanes extension errors.
 *
 * Provides a discriminated union pattern for type-safe error handling.
 * The `kind` property enables TypeScript to narrow error types in catch blocks.
 *
 * Error kinds:
 * - 'git': Git operation failures (see GitError)
 * - 'validation': User input validation failures (see ValidationError)
 * - 'filesystem': File system operation failures (reserved for Phase 3)
 * - 'config': Configuration errors (reserved for Phase 4)
 */
export abstract class LanesError extends Error {
    /**
     * Error discriminator for type narrowing.
     * Use instanceof checks combined with kind property for precise error handling.
     */
    public abstract readonly kind: 'git' | 'validation' | 'filesystem' | 'config';

    /**
     * User-friendly error message suitable for display in VS Code UI.
     * This message avoids technical jargon and sensitive data.
     */
    public readonly userMessage: string;

    /**
     * @param message - Internal error message (may include technical details)
     * @param userMessage - Optional user-friendly message (defaults to message)
     */
    constructor(message: string, userMessage?: string) {
        super(message);
        this.name = 'LanesError';
        this.userMessage = userMessage ?? message;

        // Maintains proper stack trace (V8-only)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, LanesError);
        }
    }
}
