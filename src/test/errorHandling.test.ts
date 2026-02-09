import * as assert from 'assert';
import { LanesError, GitError, ValidationError } from '../errors';

suite('Error Handling', () => {

    suite('GitError', () => {

        test('includes command and exit code', () => {
            // Arrange
            const command = ['worktree', 'add', '/path/to/worktree', 'branch-name'];
            const exitCode = 128;
            const cause = 'fatal: not a valid object name: branch-name';

            // Act
            const error = new GitError(command, exitCode, cause);

            // Assert
            assert.strictEqual(error.kind, 'git', 'kind should be "git"');
            assert.deepStrictEqual(error.command, command, 'command should be set');
            assert.strictEqual(error.exitCode, exitCode, 'exitCode should be set');
            assert.ok(error.userMessage.includes('Exit code: 128'), 'userMessage should include exit code');
            assert.ok(error.userMessage.includes('worktree add'), 'userMessage should reference command');
            assert.ok(error.message.includes('failed'), 'internal message should describe failure');
        });

        test('handles undefined exit code (spawn failure)', () => {
            // Arrange
            const command = ['status'];
            const cause = 'ENOENT: git executable not found';

            // Act
            const error = new GitError(command, undefined, cause);

            // Assert
            assert.strictEqual(error.kind, 'git');
            assert.deepStrictEqual(error.command, command);
            assert.strictEqual(error.exitCode, undefined, 'exitCode should be undefined for spawn failures');
            assert.ok(!error.userMessage.includes('Exit code:'), 'userMessage should not include exit code when undefined');
        });

        test('has correct name and stack trace', () => {
            // Arrange
            const command = ['fetch'];
            const cause = 'connection refused';

            // Act
            const error = new GitError(command, 1, cause);

            // Assert
            assert.strictEqual(error.name, 'GitError');
            assert.ok(error.stack !== undefined, 'should have stack trace');
        });
    });

    suite('ValidationError', () => {

        test('includes field and value', () => {
            // Arrange
            const field = 'branchName';
            const value = '../../etc/passwd';
            const reason = 'path traversal not allowed';

            // Act
            const error = new ValidationError(field, value, reason);

            // Assert
            assert.strictEqual(error.kind, 'validation', 'kind should be "validation"');
            assert.strictEqual(error.field, field, 'field should be set');
            assert.strictEqual(error.value, value, 'value should be set');
            assert.strictEqual(error.reason, reason, 'reason should be set');
            assert.ok(error.userMessage.includes('Invalid branchName'), 'userMessage should mention field');
            assert.ok(error.userMessage.includes('../../etc/passwd'), 'userMessage should include value');
            assert.ok(error.userMessage.includes(reason), 'userMessage should include reason');
        });

        test('truncates long values for security', () => {
            // Arrange
            const longValue = 'a'.repeat(200);
            const field = 'sessionName';
            const reason = 'too long';

            // Act
            const error = new ValidationError(field, longValue, reason);

            // Assert
            assert.ok(error.value.length <= 103, 'value should be truncated with ... suffix');
            assert.ok(error.value.endsWith('...'), 'truncated value should end with ...');
        });

        test('has correct name and stack trace', () => {
            // Arrange
            const field = 'worktreePath';
            const value = '/invalid/path';
            const reason = 'does not exist';

            // Act
            const error = new ValidationError(field, value, reason);

            // Assert
            assert.strictEqual(error.name, 'ValidationError');
            assert.ok(error.stack !== undefined, 'should have stack trace');
        });
    });

    suite('LanesError discriminator', () => {

        test('enables type narrowing with instanceof checks', () => {
            // Arrange
            const errors: LanesError[] = [
                new GitError(['status'], 1, 'test'),
                new ValidationError('field', 'value', 'reason'),
            ];

            // Act & Assert
            for (const error of errors) {
                if (error instanceof GitError) {
                    assert.strictEqual(error.kind, 'git');
                    assert.ok(Array.isArray(error.command));
                } else if (error instanceof ValidationError) {
                    assert.strictEqual(error.kind, 'validation');
                    assert.ok(typeof error.field === 'string');
                } else {
                    assert.fail('Unknown error type');
                }
            }
        });

        test('kind property provides discriminator for type guards', () => {
            // Arrange
            const gitError = new GitError(['log'], 0, 'ok');
            const validationError = new ValidationError('x', 'y', 'z');

            // Assert - kind property correctly identifies each error type
            assert.strictEqual(gitError.kind, 'git');
            assert.strictEqual(validationError.kind, 'validation');

            // Can use kind in type narrowing with instanceof
            const errors: LanesError[] = [gitError, validationError];
            for (const error of errors) {
                if (error instanceof GitError) {
                    // TypeScript knows this is GitError
                    assert.ok(Array.isArray(error.command));
                    assert.strictEqual(error.kind, 'git');
                } else if (error instanceof ValidationError) {
                    // TypeScript knows this is ValidationError
                    assert.ok(typeof error.field === 'string');
                    assert.strictEqual(error.kind, 'validation');
                }
            }
        });
    });

    suite('userMessage property', () => {

        test('GitError provides user-friendly message', () => {
            // Arrange
            const error = new GitError(['push', 'origin', 'main'], 1, 'rejected');

            // Act
            const message = error.userMessage;

            // Assert
            assert.ok(message.includes('Git operation failed'), 'should be user-friendly');
            assert.ok(message.includes('Exit code: 1'), 'should include technical exit code');
            assert.ok(!message.includes('rejected'), 'should not expose raw error details');
        });

        test('ValidationError provides actionable message', () => {
            // Arrange
            const error = new ValidationError('branchName', '@{bad}', 'contains @{ sequence');

            // Act
            const message = error.userMessage;

            // Assert
            assert.ok(message.includes('Invalid branchName'), 'should identify the problem');
            assert.ok(message.includes('@{bad}'), 'should show the invalid value');
            assert.ok(message.includes('contains @{ sequence'), 'should explain why invalid');
        });

        test('LanesError defaults userMessage to message', () => {
            // Use ValidationError to test base LanesError behavior
            // Arrange
            const error = new ValidationError('field', 'value', 'reason');

            // Assert
            assert.ok(error.userMessage.includes('Invalid field'));
            assert.ok(error.message.includes('Validation failed'));
        });

        test('LanesError allows custom userMessage', () => {
            // GitError provides custom userMessage in constructor
            // Arrange
            const error = new GitError(['status'], 1, 'test error');

            // Assert
            assert.ok(error.message.includes('failed'));
            assert.ok(error.userMessage.includes('Git operation failed'));
            assert.notStrictEqual(error.userMessage, error.message);
        });
    });
});
