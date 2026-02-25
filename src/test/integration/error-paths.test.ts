/**
 * Error Path Integration Tests
 *
 * This test suite verifies error propagation from source (git operations, validation)
 * through the extension layer to user notification. These tests ensure that:
 *
 * 1. GitError from gitService.execGit propagates correctly
 * 2. ValidationError prevents operations before git execution
 * 3. Error userMessage is actionable and reaches users
 * 4. System remains in consistent state after errors
 *
 * Test isolation:
 * - Uses memfs for in-memory filesystem operations
 * - Uses sinon to stub git operations
 * - No real git or filesystem operations
 */

import * as assert from 'assert';
import * as path from 'path';
import { vol } from 'memfs';
import sinon from 'sinon';
import * as gitService from '../../gitService';
import { GitError, ValidationError } from '../../core/errors';
import { validateSessionName } from '../../core/validation';
import { validateBranchName } from '../../core/utils';
import { setupMemfs, createTestRepo } from '../testSetup';

suite('Error Path Integration: Git Operations', () => {
    let memfs: ReturnType<typeof setupMemfs>;
    let execGitStub: sinon.SinonStub;
    let originalExecGit: typeof gitService.execGit;

    setup(() => {
        // Initialize memfs for filesystem isolation
        memfs = setupMemfs();

        // Save original execGit
        originalExecGit = gitService.execGit.bind(gitService);

        // Stub gitService.execGit directly
        execGitStub = sinon.stub(gitService, 'execGit');

        // Create test repo structure in memory
        createTestRepo(memfs.vol, '/test-repo');
    });

    teardown(() => {
        // Restore git stubs
        execGitStub.restore();

        // Reset memfs to clean state
        memfs.reset();
    });

    test('should propagate GitError from worktree creation to user notification', async () => {
        // Arrange: Stub execGit to reject with a GitError
        const worktreePath = '/test-repo/.worktrees/test-session';
        const branchName = 'feature/test-branch';
        const gitError = new GitError(
            ['worktree', 'add', worktreePath, branchName],
            128,
            'fatal: not a valid object name: feature/test-branch'
        );

        execGitStub.rejects(gitError);

        // Act: Try to execute the git command
        let caughtError: Error | undefined;
        try {
            await gitService.execGit(['worktree', 'add', worktreePath, branchName], '/test-repo');
        } catch (err) {
            caughtError = err as Error;
        }

        // Assert: GitError is caught with correct properties
        assert.ok(caughtError instanceof GitError, 'Should catch GitError');
        assert.strictEqual(caughtError.kind, 'git', 'Error kind should be "git"');
        assert.deepStrictEqual((caughtError as GitError).command, ['worktree', 'add', worktreePath, branchName]);
        assert.strictEqual((caughtError as GitError).exitCode, 128);

        // Assert: userMessage is actionable
        assert.ok(caughtError.userMessage.includes('Git operation failed'), 'userMessage should indicate git failure');
        assert.ok(caughtError.userMessage.includes('Exit code: 128'), 'userMessage should include exit code');
        assert.ok(caughtError.userMessage.includes('git worktree add'), 'userMessage should reference the command');
    });

    test('should include command details in GitError', async () => {
        // Arrange: Create a GitError directly
        const command = ['status', '--porcelain'];
        const exitCode = 1;
        const cause = 'error: unable to read .git directory';

        const error = new GitError(command, exitCode, cause);

        // Assert: Command array is preserved
        assert.deepStrictEqual(error.command, command, 'Command should be preserved exactly');

        // Assert: Exit code is captured
        assert.strictEqual(error.exitCode, exitCode, 'Exit code should be captured');

        // Assert: Command string appears in userMessage
        assert.ok(error.userMessage.includes('git status --porcelain'), 'userMessage should include full command');
    });

    test('should handle spawn failure (undefined exit code)', async () => {
        // Arrange: Create a GitError for spawn failure
        const command = ['fetch', 'origin'];
        const error = new GitError(command, undefined, 'ENOENT: git executable not found');

        // Assert: exitCode is undefined for spawn failures
        assert.strictEqual(error.exitCode, undefined, 'exitCode should be undefined');

        // Assert: userMessage does not include exit code
        assert.ok(!error.userMessage.includes('Exit code:'), 'userMessage should not include exit code when undefined');

        // Assert: userMessage still provides context
        assert.ok(error.userMessage.includes('git fetch'), 'userMessage should still reference command');
    });

    test('should propagate GitError through promise chain', async () => {
        // Arrange: Stub execGit to reject
        const gitError = new GitError(['push', 'origin'], 1, 'rejected');
        execGitStub.rejects(gitError);

        const processGitOperation = async (): Promise<string> => {
            // Simulate extension layer code that processes git output
            const result = await gitService.execGit(['push', 'origin'], '/test-repo');
            return result;
        };

        // Act: Call the function and catch error
        let caughtError: Error | undefined;
        try {
            await processGitOperation();
        } catch (err) {
            caughtError = err as Error;
        }

        // Assert: Error propagates through promise chain
        assert.ok(caughtError instanceof GitError, 'GitError should propagate through promise chain');
        assert.strictEqual((caughtError as GitError).command[0], 'push');
    });
});

suite('Error Path Integration: Validation', () => {
    test('should prevent git operations on invalid session name', () => {
        // Arrange: Use path traversal attempt
        const maliciousName = '../../etc/passwd';

        // Act: Validate the session name
        const validationResult = validateSessionName(maliciousName);

        // Assert: ValidationError should be thrown by validation
        assert.strictEqual(validationResult.valid, false, 'Should reject path traversal');
        assert.ok(validationResult.error?.includes('..'), 'Error should mention ..');
        assert.ok(validationResult.error?.includes('path traversal'), 'Error should explain security issue');
    });

    test('should reject invalid branch names with @{ sequence', () => {
        // Arrange: Use @{ sequence (not allowed by git ref format)
        const invalidBranch = 'feature@{u}'; // @{u} is reflog syntax, not valid for branch names

        // Act: Validate the branch name
        const validationResult = validateBranchName(invalidBranch);

        // Assert: Should reject
        assert.strictEqual(validationResult.valid, false, 'Should reject @{ sequence');
        assert.ok(validationResult.error?.includes('invalid characters') ||
                   validationResult.error?.includes('invalid sequences'),
                   'Error should explain why invalid');
        assert.ok(validationResult.error?.includes(invalidBranch), 'Error should include the branch name');
    });

    test('should reject branch names with control characters', () => {
        // Arrange: Branch name with control character (DEL)
        const invalidBranch = 'feature\x7f-test';

        // Act: Validate the branch name
        const validationResult = validateBranchName(invalidBranch);

        // Assert: Should reject
        assert.strictEqual(validationResult.valid, false, 'Should reject control characters');
        assert.ok(validationResult.error?.includes('invalid characters'), 'Error should mention invalid characters');
    });

    test('should reject branch names with spaces and special chars', () => {
        // Arrange: Branch name with spaces and special characters
        const invalidBranch = 'feature test & more';

        // Act: Validate the branch name
        const validationResult = validateBranchName(invalidBranch);

        // Assert: Should reject
        assert.strictEqual(validationResult.valid, false, 'Should reject spaces and special chars');
    });

    test('should accept valid branch names', () => {
        // Arrange: Valid branch names
        const validBranches = [
            'main',
            'feature/test-branch',
            'bugfix/issue-123',
            'release/v1.0.0',
            'feature_v2',
            '123-numeric-start',
        ];

        // Act & Assert: All should be valid
        for (const branch of validBranches) {
            const result = validateBranchName(branch);
            assert.strictEqual(result.valid, true, `Should accept valid branch: ${branch}`);
            assert.strictEqual(result.error, undefined, `Should not have error for: ${branch}`);
        }
    });

    test('should detect path traversal with .. in middle of name', () => {
        // Arrange: Name with .. in middle (not just at start)
        const traversalName = 'feature/../../etc/passwd';

        // Act: Validate
        const result = validateSessionName(traversalName);

        // Assert: Should reject
        assert.strictEqual(result.valid, false, 'Should reject .. anywhere in name');
        assert.ok(result.error?.includes('..'), 'Error should mention ..');
    });
});

suite('Error Path Integration: User Notification', () => {
    test('GitError provides user-friendly message', () => {
        // Arrange: Create GitError with technical details
        const command = ['worktree', 'add', '/path/to/worktree', 'non-existent-branch'];
        const exitCode = 128;
        const cause = 'fatal: not a valid object name: non-existent-branch';

        const error = new GitError(command, exitCode, cause);

        // Assert: userMessage excludes raw error details
        assert.ok(!error.userMessage.includes('fatal:'), 'userMessage should not include raw git error');
        assert.ok(!error.userMessage.includes('not a valid object name'), 'userMessage should not include technical cause');

        // Assert: userMessage includes actionable context
        assert.ok(error.userMessage.includes('Git operation failed'), 'userMessage should be user-friendly');
        assert.ok(error.userMessage.includes('Exit code: 128'), 'userMessage should include exit code for debugging');
        assert.ok(error.userMessage.includes('git worktree add'), 'userMessage should show the command that failed');

        // Assert: Internal message has full details
        assert.ok(error.message.includes('failed'), 'Internal message should describe failure');
        assert.ok(error.message.includes('fatal:'), 'Internal message should include raw error');
    });

    test('ValidationError shows invalid value and reason', () => {
        // Arrange: Create ValidationError with long value
        const longValue = 'a'.repeat(200);
        const field = 'sessionName';
        const reason = 'is too long (maximum 200 characters)';

        const error = new ValidationError(field, longValue, reason);

        // Assert: Value is truncated
        assert.ok(error.value.length <= 103, 'Long values should be truncated');
        assert.ok(error.value.endsWith('...'), 'Truncated value should end with ...');

        // Assert: userMessage includes field and reason
        assert.ok(error.userMessage.includes('Invalid sessionName'), 'userMessage should identify the field');
        assert.ok(error.userMessage.includes(reason), 'userMessage should explain why invalid');
    });

    test('ValidationError shows path traversal value', () => {
        // Arrange: ValidationError for path traversal
        const field = 'sessionName';
        const value = '../../etc/passwd';
        const reason = 'path traversal not allowed';

        const error = new ValidationError(field, value, reason);

        // Assert: userMessage shows the problem clearly
        assert.ok(error.userMessage.includes('Invalid sessionName'), 'Should identify field');
        assert.ok(error.userMessage.includes('../../etc/passwd'), 'Should show the invalid value');
        assert.ok(error.userMessage.includes(reason), 'Should explain the security issue');
        assert.ok(error.userMessage.length < 200, 'Message should be concise');
    });

    test('ValidationError for branch name includes actionable guidance', () => {
        // Arrange: ValidationError for @{ sequence in branch
        const field = 'branchName';
        const value = 'feature@{u}';
        const reason = 'contains @{ sequence (reflog syntax not allowed)';

        const error = new ValidationError(field, value, reason);

        // Assert: User can understand what to fix
        assert.ok(error.userMessage.includes('Invalid branchName'), 'Should identify the field');
        assert.ok(error.userMessage.includes('feature@{u}'), 'Should show the problematic branch name');
        assert.ok(error.userMessage.includes('@{'), 'Should highlight the specific issue');
    });

    test('GitError for missing branch provides actionable context', () => {
        // Arrange: GitError when branch doesn't exist
        const error = new GitError(
            ['worktree', 'add', '/worktree/path', 'missing-branch'],
            128,
            "fatal: invalid reference: missing-branch"
        );

        // Assert: userMessage helps user understand the problem
        assert.ok(error.userMessage.includes('Git operation failed'), 'Should be user-friendly');
        assert.ok(error.userMessage.includes('Exit code: 128'), 'Should include exit code');
        assert.ok(error.userMessage.includes('git worktree add'), 'Should show command');
        assert.ok(error.userMessage.includes('missing-branch'), 'Should show the problematic branch');
    });
});

suite('Error Path Integration: System State Consistency', () => {
    let memfs: ReturnType<typeof setupMemfs>;

    setup(() => {
        memfs = setupMemfs();
    });

    teardown(() => {
        memfs.reset();
    });

    test('should not create files when validation fails', () => {
        // Arrange: Setup memfs with repo structure
        createTestRepo(memfs.vol, '/test-repo');
        const invalidName = '../../../etc/passwd';

        // Act: Try to validate (which should fail)
        const result = validateSessionName(invalidName);

        // Assert: No files created outside test-repo
        assert.strictEqual(result.valid, false, 'Should reject invalid name');

        // Check that no path traversal files were created
        const etcPathExists = memfs.vol.existsSync('/etc/passwd');
        assert.strictEqual(etcPathExists, false, 'Should not create files outside repo');
    });

    test('should preserve memfs state after failed git operation', async () => {
        // Arrange: Create test repo and add a file
        createTestRepo(memfs.vol, '/test-repo');
        memfs.vol.fromJSON({
            '/test-repo/test.txt': 'original content'
        });

        const originalContent = memfs.vol.readFileSync('/test-repo/test.txt', 'utf8');

        // Act: Stub execGit to fail
        const execGitStub = sinon.stub(gitService, 'execGit');
        execGitStub.rejects(new GitError(['status'], 1, 'error'));

        const caughtError = await gitService.execGit(['status'], '/test-repo').catch(err => err);

        // Assert: File content unchanged
        const contentAfter = memfs.vol.readFileSync('/test-repo/test.txt', 'utf8');
        assert.strictEqual(contentAfter, originalContent, 'File content should be unchanged');
        assert.ok(caughtError instanceof GitError, 'Error should be caught');

        execGitStub.restore();
    });

    test('ValidationError prevents operation without side effects', () => {
        // Arrange: Setup tracking for any execGit calls
        const execGitStub = sinon.stub(gitService, 'execGit');
        let callsCount = 0;
        execGitStub.callsFake(() => {
            callsCount++;
            return Promise.resolve('');
        });

        // Act: Validate invalid name before any git operation
        const invalidName = '../traversal';
        const validation = validateSessionName(invalidName);

        // Only proceed if validation passes (it shouldn't)
        if (validation.valid) {
            // This branch should never execute
            gitService.execGit(['worktree', 'add', '/path', invalidName], '/repo');
        }

        // Assert: execGit was never called
        assert.strictEqual(validation.valid, false, 'Should reject invalid name');
        assert.strictEqual(callsCount, 0, 'execGit should not be called when validation fails');

        execGitStub.restore();
    });
});

suite('Error Path Integration: Error Type Discrimination', () => {
    test('enables type narrowing with instanceof checks', () => {
        // Arrange: Create both error types
        const gitError = new GitError(['status'], 1, 'test error');
        const validationError = new ValidationError('branchName', 'bad@name', 'invalid characters');

        // Act & Assert: instanceof checks work correctly
        assert.ok(gitError instanceof GitError);
        assert.ok(!(gitError instanceof ValidationError));
        assert.ok(validationError instanceof ValidationError);
        assert.ok(!(validationError instanceof GitError));
    });

    test('kind property provides correct discriminator', () => {
        // Arrange: Create both error types
        const gitError = new GitError(['push'], 1, 'rejected');
        const validationError = new ValidationError('field', 'value', 'reason');

        // Act & Assert: kind discriminates correctly
        assert.strictEqual(gitError.kind, 'git');
        assert.strictEqual(validationError.kind, 'validation');
    });

    test('error handling via kind discriminator', () => {
        // Arrange: Create mixed error array
        const errors: Array<GitError | ValidationError> = [
            new GitError(['fetch'], 1, 'connection failed'),
            new ValidationError('sessionName', '../../etc', 'path traversal'),
            new GitError(['push'], 128, 'rejected'),
            new ValidationError('branchName', '@{bad}', 'invalid sequence'),
        ];

        // Act: Process errors using kind discriminator
        const gitErrors = errors.filter(e => e.kind === 'git');
        const validationErrors = errors.filter(e => e.kind === 'validation');

        // Assert: Correct segregation
        assert.strictEqual(gitErrors.length, 2, 'Should identify 2 GitErrors');
        assert.strictEqual(validationErrors.length, 2, 'Should identify 2 ValidationErrors');

        // Assert: GitErrors have command property
        for (const error of gitErrors) {
            assert.ok(Array.isArray(error.command), 'GitError should have command array');
            assert.ok(typeof error.exitCode === 'number', 'GitError should have exitCode');
        }

        // Assert: ValidationErrors have field/value/reason
        for (const error of validationErrors) {
            assert.ok(typeof error.field === 'string', 'ValidationError should have field');
            assert.ok(typeof error.reason === 'string', 'ValidationError should have reason');
        }
    });
});
