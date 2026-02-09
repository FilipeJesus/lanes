import * as assert from 'assert';
import { validateBranchName } from '../../utils';

suite('validateBranchName', () => {

	suite('Valid branch names', () => {

		test('should accept simple alphanumeric names', () => {
			const result = validateBranchName('main');
			assert.strictEqual(result.valid, true);
			assert.strictEqual(result.error, undefined);
		});

		test('should accept names with hyphens', () => {
			const result = validateBranchName('feature-branch');
			assert.strictEqual(result.valid, true);
		});

		test('should accept names with underscores', () => {
			const result = validateBranchName('feature_branch');
			assert.strictEqual(result.valid, true);
		});

		test('should accept names with dots (not leading/trailing)', () => {
			const result = validateBranchName('release.v1.0');
			assert.strictEqual(result.valid, true);
		});

		test('should accept names with forward slashes', () => {
			const result = validateBranchName('feature/new-feature');
			assert.strictEqual(result.valid, true);
		});

		test('should accept complex valid branch names', () => {
			const result = validateBranchName('feature/user-login-v2');
			assert.strictEqual(result.valid, true);
		});

		test('should accept names with numbers', () => {
			const result = validateBranchName('branch123');
			assert.strictEqual(result.valid, true);
		});

		test('should accept remote branch format', () => {
			const result = validateBranchName('origin/main');
			assert.strictEqual(result.valid, true);
		});
	});

	suite('Invalid characters - ASCII control chars', () => {

		test('should reject branch with null byte', () => {
			const result = validateBranchName('branch\x00name');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid characters'));
		});

		test('should reject branch with other control characters', () => {
			const result = validateBranchName('branch\x1Bname');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with DEL character (0x7F)', () => {
			const result = validateBranchName('branch\x7Fname');
			assert.strictEqual(result.valid, false);
		});
	});

	suite('Invalid characters - special chars', () => {

		test('should reject branch with spaces', () => {
			const result = validateBranchName('feature branch');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid characters'));
		});

		test('should reject branch with tilde', () => {
			const result = validateBranchName('feature~test');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with caret', () => {
			const result = validateBranchName('feature^test');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with colon', () => {
			const result = validateBranchName('feature:test');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with question mark', () => {
			const result = validateBranchName('feature?test');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with asterisk', () => {
			const result = validateBranchName('feature*test');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with opening bracket', () => {
			const result = validateBranchName('feature[test');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch with backslash', () => {
			const result = validateBranchName('feature\\test');
			assert.strictEqual(result.valid, false);
		});
	});

	suite('Leading/trailing dots', () => {

		test('should reject branch starting with dot - bug case feature/.', () => {
			const result = validateBranchName('feature/.');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid characters'));
			assert.ok(result.error?.includes('feature/.'));
		});

		test('should reject branch starting with dot', () => {
			const result = validateBranchName('.hidden');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch ending with dot', () => {
			const result = validateBranchName('feature.');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch starting and ending with dot', () => {
			const result = validateBranchName('.feature.');
			assert.strictEqual(result.valid, false);
		});
	});

	suite('Double dot and double slash sequences', () => {

		test('should reject branch with double dot sequence', () => {
			const result = validateBranchName('feature..test');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid sequences'));
		});

		test('should reject branch with double slash sequence', () => {
			const result = validateBranchName('feature//test');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid sequences'));
		});

		test('should reject branch with both double dot and double slash', () => {
			const result = validateBranchName('feature..//test');
			assert.strictEqual(result.valid, false);
		});
	});

	suite('Brace sequences (reflog syntax)', () => {

		test('should reject branch with @{ sequence', () => {
			const result = validateBranchName('main@{1');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid characters'));
		});

		test('should reject branch with @{0} sequence', () => {
			const result = validateBranchName('main@{0}');
			assert.strictEqual(result.valid, false);
		});
	});

	suite('.lock suffix', () => {

		test('should reject branch ending with .lock', () => {
			const result = validateBranchName('feature.lock');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('invalid characters'));
		});

		test('should reject branch with .lock anywhere at the end', () => {
			const result = validateBranchName('test.lock');
			assert.strictEqual(result.valid, false);
		});

		test('should accept branch with .lock in the middle', () => {
			const result = validateBranchName('feature.lock.test');
			assert.strictEqual(result.valid, true);
		});
	});

	suite('Edge cases', () => {

		test('should reject empty branch name', () => {
			const result = validateBranchName('');
			assert.strictEqual(result.valid, false);
			assert.ok(result.error?.includes('cannot be empty'));
		});

		test('should reject branch name with only dots', () => {
			const result = validateBranchName('...');
			assert.strictEqual(result.valid, false);
		});

		test('should reject branch name with only slashes', () => {
			const result = validateBranchName('//');
			assert.strictEqual(result.valid, false);
		});

		test('should handle complex invalid branch name with multiple issues', () => {
			const result = validateBranchName('feature/./test~');
			assert.strictEqual(result.valid, false);
		});
	});

	suite('Error message clarity', () => {

		test('should include branch name in error message', () => {
			const result = validateBranchName('feature/.');
			assert.ok(result.error?.includes('feature/.'), `Error should include branch name: ${result.error}`);
		});

		test('should provide clear error message for invalid characters', () => {
			const result = validateBranchName('feature~test');
			assert.ok(result.error?.includes('invalid characters'));
		});

		test('should provide clear error message for invalid sequences', () => {
			const result = validateBranchName('feature..test');
			assert.ok(result.error?.includes('invalid sequences'));
		});
	});
});
