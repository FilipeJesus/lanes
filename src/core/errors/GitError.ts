import { LanesError } from './LanesError';

/**
 * Error thrown when a Git operation fails.
 *
 * Provides context about the failed Git command including
 * the command arguments, exit code, and underlying cause.
 */
export class GitError extends LanesError {
    public readonly kind = 'git' as const;

    /**
     * The Git command arguments that failed (e.g., ['worktree', 'add', 'path']).
     * Used for debugging - may be excluded from user messages for security.
     */
    public readonly command: string[];

    /**
     * The Git process exit code.
     * Common codes: 1 (general error), 128 (fatal error), 129-255 (other).
     */
    public readonly exitCode?: number;

    /**
     * Creates a new GitError.
     *
     * @param command - The Git command arguments that failed
     * @param exitCode - The process exit code (undefined if process failed to spawn)
     * @param cause - The underlying error message or cause
     */
    constructor(command: string[], exitCode: number | undefined, cause: string) {
        // Build internal message with full details
        const commandStr = command.join(' ');
        const exitCodeStr = exitCode !== undefined ? ` (exit code: ${exitCode})` : '';
        const message = `Git command "${commandStr}" failed${exitCodeStr}: ${cause}`;

        // Build user-friendly message without sensitive data
        const exitCodeMsg = exitCode !== undefined ? `Exit code: ${exitCode}. ` : '';
        const userMessage = `Git operation failed. ${exitCodeMsg}Command: git ${commandStr}`;

        super(message, userMessage);

        this.name = 'GitError';
        this.command = command;
        this.exitCode = exitCode;

        // Maintains proper stack trace (V8-only)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, GitError);
        }
    }
}
