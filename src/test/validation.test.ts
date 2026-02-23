/**
 * Security tests for input validation.
 *
 * This test suite verifies that the validation module properly rejects
 * malicious inputs including path traversal attempts, null bytes, and
 * other security-relevant patterns.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import {
    validateSessionName,
    validateRelativePath,
    validateConfigString,
    validateWorktreesFolder,
    validatePromptsFolder,
    validateLocalSettingsPropagation,
    validateCustomWorkflowsFolder,
    validateChimeSound,
    validateComparisonRef,
    safeResolve,
    sanitizeForDisplay,
    isPathWithinBase,
    normalizePath
} from '../core/validation';

// Helper to get test workspace path
function getTestWorkspacePath(): string {
    // In test environment, use a temp path
    return '/tmp/test-workspace';
}

suite('Validation Module - Session Name Validation', () => {

    test('rejects empty session name', () => {
        const result = validateSessionName('');
        assert.strictEqual(result.valid, false, 'Should reject empty name');
        assert.ok(result.error?.includes('empty'), 'Error should mention empty');
    });

    test('rejects whitespace-only session name', () => {
        const result = validateSessionName('   ');
        assert.strictEqual(result.valid, false, 'Should reject whitespace-only name');
    });

    test('rejects session name containing .. (path traversal)', () => {
        const result = validateSessionName('../etc/passwd');
        assert.strictEqual(result.valid, false, 'Should reject path traversal');
        assert.ok(result.error?.includes('..'), 'Error should mention ..');
    });

    test('rejects session name with .. in middle', () => {
        const result = validateSessionName('feature/../test');
        assert.strictEqual(result.valid, false, 'Should reject .. in middle');
    });

    test('rejects session name with .. at end', () => {
        const result = validateSessionName('feature..');
        assert.strictEqual(result.valid, false, 'Should reject .. at end');
    });

    test('rejects session name containing null byte', () => {
        const result = validateSessionName('test\x00name');
        assert.strictEqual(result.valid, false, 'Should reject null byte');
        assert.ok(result.error?.includes('null'), 'Error should mention null byte');
    });

    test('rejects session name over 200 characters', () => {
        const longName = 'a'.repeat(201);
        const result = validateSessionName(longName);
        assert.strictEqual(result.valid, false, 'Should reject overly long names');
        assert.ok(result.error?.includes('200'), 'Error should mention length limit');
    });

    test('accepts valid session name with hyphens', () => {
        const result = validateSessionName('fix-login-bug');
        assert.strictEqual(result.valid, true, 'Should accept hyphens');
        assert.strictEqual(result.error, undefined);
    });

    test('accepts valid session name with underscores', () => {
        const result = validateSessionName('feature_login_fix');
        assert.strictEqual(result.valid, true, 'Should accept underscores');
        assert.strictEqual(result.error, undefined);
    });

    test('accepts valid session name with slashes', () => {
        const result = validateSessionName('feature/sub-feature');
        assert.strictEqual(result.valid, true, 'Should accept slashes for nested structure');
        assert.strictEqual(result.error, undefined);
    });

    test('accepts valid session name with dots (but not ..)', () => {
        const result = validateSessionName('feature.v2.fix');
        assert.strictEqual(result.valid, true, 'Should accept dots');
        assert.strictEqual(result.error, undefined);
    });

    test('trims whitespace before validation', () => {
        const result = validateSessionName('  fix-login  ');
        assert.strictEqual(result.valid, true, 'Should trim and accept');
    });
});

suite('Validation Module - Relative Path Validation', () => {

    test('rejects empty path', () => {
        const result = validateRelativePath('');
        assert.strictEqual(result.valid, false, 'Should reject empty path');
    });

    test('rejects .. when traversal not allowed', () => {
        const result = validateRelativePath('../parent');
        assert.strictEqual(result.valid, false, 'Should reject .. by default');
    });

    test('allows .. when traversal explicitly allowed', () => {
        const result = validateRelativePath('../parent', { allowTraversal: true });
        assert.strictEqual(result.valid, true, 'Should allow .. with option');
    });

    test('rejects Unix absolute paths by default', () => {
        const result = validateRelativePath('/etc/passwd');
        assert.strictEqual(result.valid, false, 'Should reject Unix absolute paths');
    });

    test('rejects Windows absolute paths by default', () => {
        const result = validateRelativePath('C:\\Windows\\System32');
        assert.strictEqual(result.valid, false, 'Should reject Windows absolute paths');
    });

    test('allows absolute paths when explicitly allowed', () => {
        const result = validateRelativePath('/etc/passwd', { allowAbsolute: true });
        assert.strictEqual(result.valid, true, 'Should allow absolute paths with option');
    });

    test('accepts valid relative path', () => {
        const result = validateRelativePath('src/features');
        assert.strictEqual(result.valid, true, 'Should accept valid relative paths');
    });
});

suite('Validation Module - Config String Validation', () => {

    test('rejects non-string values', () => {
        const result = validateConfigString(123, 'testField');
        assert.strictEqual(result.valid, false, 'Should reject numbers');
    });

    test('rejects empty string', () => {
        const result = validateConfigString('', 'testField');
        assert.strictEqual(result.valid, false, 'Should reject empty string');
    });

    test('rejects string with leading whitespace', () => {
        const result = validateConfigString('  value', 'testField');
        assert.strictEqual(result.valid, false, 'Should reject leading whitespace');
    });

    test('rejects string with trailing whitespace', () => {
        const result = validateConfigString('value  ', 'testField');
        assert.strictEqual(result.valid, false, 'Should reject trailing whitespace');
    });

    test('accepts valid config string', () => {
        const result = validateConfigString('valid-value', 'testField');
        assert.strictEqual(result.valid, true, 'Should accept valid string');
    });
});

suite('Validation Module - Worktrees Folder Validation', () => {

    test('rejects empty string', () => {
        const result = validateWorktreesFolder('');
        assert.strictEqual(result.valid, false, 'Should reject empty string');
    });

    test('rejects path traversal', () => {
        const result = validateWorktreesFolder('../worktrees');
        assert.strictEqual(result.valid, false, 'Should reject path traversal');
    });

    test('rejects absolute paths', () => {
        const result = validateWorktreesFolder('/tmp/worktrees');
        assert.strictEqual(result.valid, false, 'Should reject absolute paths');
    });

    test('rejects invalid Windows characters', () => {
        const result = validateWorktreesFolder('test<folder>');
        assert.strictEqual(result.valid, false, 'Should reject invalid Windows chars');
    });

    test('rejects whitespace padding', () => {
        const result = validateWorktreesFolder('  worktrees  ');
        assert.strictEqual(result.valid, false, 'Should reject whitespace padding');
    });

    test('accepts valid folder name', () => {
        const result = validateWorktreesFolder('.worktrees');
        assert.strictEqual(result.valid, true, 'Should accept valid folder name');
    });
});

suite('Validation Module - Prompts Folder Validation', () => {

    test('accepts empty string (global storage)', () => {
        const result = validatePromptsFolder('');
        assert.strictEqual(result.valid, true, 'Empty string should be valid');
    });

    test('rejects path traversal', () => {
        const result = validatePromptsFolder('../prompts');
        assert.strictEqual(result.valid, false, 'Should reject path traversal');
    });

    test('rejects absolute paths', () => {
        const result = validatePromptsFolder('/tmp/prompts');
        assert.strictEqual(result.valid, false, 'Should reject absolute paths');
    });

    test('accepts valid relative path', () => {
        const result = validatePromptsFolder('.prompts');
        assert.strictEqual(result.valid, true, 'Should accept valid relative path');
    });
});

suite('Validation Module - Local Settings Propagation Validation', () => {

    test('accepts "copy"', () => {
        const result = validateLocalSettingsPropagation('copy');
        assert.strictEqual(result.valid, true, 'Should accept copy');
    });

    test('accepts "symlink"', () => {
        const result = validateLocalSettingsPropagation('symlink');
        assert.strictEqual(result.valid, true, 'Should accept symlink');
    });

    test('accepts "disabled"', () => {
        const result = validateLocalSettingsPropagation('disabled');
        assert.strictEqual(result.valid, true, 'Should accept disabled');
    });

    test('rejects invalid values', () => {
        const result = validateLocalSettingsPropagation('invalid');
        assert.strictEqual(result.valid, false, 'Should reject invalid value');
        assert.ok(result.error?.includes('copy'), 'Error should list valid values');
    });

    test('rejects non-string values', () => {
        const result = validateLocalSettingsPropagation(123);
        assert.strictEqual(result.valid, false, 'Should reject non-string');
    });
});

suite('Validation Module - Custom Workflows Folder Validation', () => {

    test('accepts empty string', () => {
        const result = validateCustomWorkflowsFolder('');
        assert.strictEqual(result.valid, true, 'Empty string should be valid');
    });

    test('rejects path traversal', () => {
        const result = validateCustomWorkflowsFolder('../workflows');
        assert.strictEqual(result.valid, false, 'Should reject path traversal');
    });

    test('rejects absolute paths', () => {
        const result = validateCustomWorkflowsFolder('/tmp/workflows');
        assert.strictEqual(result.valid, false, 'Should reject absolute paths');
    });

    test('accepts valid relative path', () => {
        const result = validateCustomWorkflowsFolder('.lanes/workflows');
        assert.strictEqual(result.valid, true, 'Should accept valid relative path');
    });
});

suite('Validation Module - Chime Sound Validation', () => {

    test('accepts all valid chime sounds', () => {
        const sounds = ['chime', 'alarm', 'level-up', 'notification'];
        for (const sound of sounds) {
            const result = validateChimeSound(sound);
            assert.strictEqual(result.valid, true, `Should accept ${sound}`);
        }
    });

    test('rejects invalid chime sounds', () => {
        const result = validateChimeSound('invalid-sound');
        assert.strictEqual(result.valid, false, 'Should reject invalid sound');
    });
});

suite('Validation Module - Comparison Ref Validation', () => {

    test('accepts empty string (auto-detect)', () => {
        const result = validateComparisonRef('');
        assert.strictEqual(result.valid, true, 'Empty string should be valid');
    });

    test('accepts valid branch names', () => {
        const result = validateComparisonRef('main');
        assert.strictEqual(result.valid, true, 'Should accept valid branch');
    });

    test('rejects null bytes', () => {
        const result = validateComparisonRef('main\x00');
        assert.strictEqual(result.valid, false, 'Should reject null byte');
    });
});

suite('Path Sanitizer - Safe Resolve', () => {

    const basePath = '/home/user/project';

    test('returns null for ../../../etc/passwd', () => {
        const result = safeResolve(basePath, '../../../etc/passwd');
        assert.strictEqual(result, null, 'Should detect traversal and return null');
    });

    test('returns null for ../sibling', () => {
        const result = safeResolve(basePath, '../sibling');
        assert.strictEqual(result, null, 'Should detect sibling traversal');
    });

    test('returns null for absolute path escaping base', () => {
        const result = safeResolve(basePath, '/etc/passwd');
        assert.strictEqual(result, null, 'Should detect absolute path escape');
    });

    test('returns normalized path for safe relative path', () => {
        const result = safeResolve(basePath, 'src/file.txt');
        assert.ok(result !== null, 'Should allow safe relative path');
        assert.ok(result!.startsWith(basePath), 'Result should be within base');
    });

    test('handles complex traversal attempts', () => {
        const result = safeResolve(basePath, 'src/../../etc/passwd');
        assert.strictEqual(result, null, 'Should detect complex traversal');
    });

    test('normalizes redundant path segments', () => {
        const result = safeResolve(basePath, 'src//subdir/../file.txt');
        assert.ok(result !== null, 'Should handle redundant segments');
        assert.ok(result!.includes('src/file.txt'), 'Should normalize correctly');
    });

    test('handles dot segments within base', () => {
        const result = safeResolve(basePath, './src/file.txt');
        assert.ok(result !== null, 'Should handle leading ./');
        assert.ok(result!.startsWith(basePath), 'Result should be within base');
    });
});

suite('Path Sanitizer - Sanitize For Display', () => {

    test('trims whitespace', () => {
        const result = sanitizeForDisplay('  Fix Login  ');
        assert.strictEqual(result, 'Fix-Login', 'Should trim whitespace');
    });

    test('replaces spaces with hyphens', () => {
        const result = sanitizeForDisplay('Fix Login Bug');
        assert.strictEqual(result, 'Fix-Login-Bug', 'Should replace spaces');
    });

    test('removes invalid characters', () => {
        const result = sanitizeForDisplay('Fix@Login#Bug$');
        assert.strictEqual(result, 'FixLoginBug', 'Should remove invalid chars');
    });

    test('keeps valid characters', () => {
        const result = sanitizeForDisplay('feature_v2.fix');
        assert.strictEqual(result, 'feature_v2.fix', 'Should keep word chars, dots, underscores');
    });

    test('truncates to 50 characters', () => {
        const longInput = 'a'.repeat(100);
        const result = sanitizeForDisplay(longInput);
        assert.strictEqual(result.length, 50, 'Should truncate to 50 chars');
    });

    test('handles empty input', () => {
        const result = sanitizeForDisplay('');
        assert.strictEqual(result, '', 'Should handle empty input');
    });

    test('handles null input', () => {
        const result = sanitizeForDisplay((null as unknown) as string);
        assert.strictEqual(result, '', 'Should handle null input');
    });
});

suite('Path Sanitizer - Is Path Within Base', () => {

    test('returns true for path within base', () => {
        const result = isPathWithinBase('/home/user/project', '/home/user/project/src');
        assert.strictEqual(result, true, 'Should detect path within base');
    });

    test('returns false for path outside base', () => {
        const result = isPathWithinBase('/home/user/project', '/home/user/other');
        assert.strictEqual(result, false, 'Should detect path outside base');
    });

    test('returns false for traversal escape', () => {
        const result = isPathWithinBase('/home/user/project', '/home/user/project/../other');
        assert.strictEqual(result, false, 'Should detect traversal after normalization');
    });

    test('returns true for exact base match', () => {
        const result = isPathWithinBase('/home/user/project', '/home/user/project');
        assert.strictEqual(result, true, 'Should match exact base');
    });
});

suite('Path Sanitizer - Normalize Path', () => {

    test('normalizes forward slashes', () => {
        const result = normalizePath('src//subdir/file.txt');
        assert.ok(!result.includes('//'), 'Should remove duplicate slashes');
    });

    test('handles . segments', () => {
        const result = normalizePath('src/./file.txt');
        assert.ok(!result.includes('/./'), 'Should normalize . segments');
    });

    test('handles .. segments when safe', () => {
        const result = normalizePath('src/subdir/../file.txt');
        assert.ok(!result.includes('..'), 'Should normalize .. segments');
    });
});
