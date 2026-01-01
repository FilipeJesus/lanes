import * as assert from 'assert';
import { sanitizeSessionName } from '../extension';

suite('sanitizeSessionName', () => {

	suite('Replaces spaces with hyphens', () => {

		test('should replace single spaces with hyphens', () => {
			const result = sanitizeSessionName('my session name');
			assert.strictEqual(result, 'my-session-name');
		});

		test('should replace spaces within path-like names', () => {
			const result = sanitizeSessionName('feature/add login');
			assert.strictEqual(result, 'feature/add-login');
		});

		test('should replace multiple consecutive spaces with single hyphen', () => {
			const result = sanitizeSessionName('multiple   spaces');
			assert.strictEqual(result, 'multiple-spaces');
		});
	});

	suite('Removes characters not in [a-zA-Z0-9_\\-./]', () => {

		test('should replace @ and ! with hyphens', () => {
			const result = sanitizeSessionName('hello@world!');
			assert.strictEqual(result, 'hello-world');
		});

		test('should replace #$% with single hyphen', () => {
			const result = sanitizeSessionName('test#$%name');
			assert.strictEqual(result, 'test-name');
		});

		test('should preserve valid names with underscores, hyphens and numbers', () => {
			const result = sanitizeSessionName('valid_name-123');
			assert.strictEqual(result, 'valid_name-123');
		});
	});

	suite('Replaces consecutive invalid chars with single hyphen', () => {

		test('should replace consecutive exclamation marks with single hyphen', () => {
			const result = sanitizeSessionName('hello!!!world');
			assert.strictEqual(result, 'hello-world');
		});

		test('should replace mixed spaces and special chars with single hyphen', () => {
			const result = sanitizeSessionName('test   @#$   name');
			assert.strictEqual(result, 'test-name');
		});
	});

	suite('Removes leading hyphen or dot', () => {

		test('should remove leading hyphen', () => {
			const result = sanitizeSessionName('-bad-name');
			assert.strictEqual(result, 'bad-name');
		});

		test('should remove leading dot', () => {
			const result = sanitizeSessionName('.hidden-name');
			assert.strictEqual(result, 'hidden-name');
		});

		test('should remove multiple leading dots', () => {
			const result = sanitizeSessionName('..bad-name');
			assert.strictEqual(result, 'bad-name');
		});

		test('should remove multiple leading hyphens', () => {
			const result = sanitizeSessionName('---test');
			assert.strictEqual(result, 'test');
		});
	});

	suite('Removes trailing dot', () => {

		test('should remove single trailing dot', () => {
			const result = sanitizeSessionName('name.');
			assert.strictEqual(result, 'name');
		});

		test('should remove multiple trailing dots', () => {
			const result = sanitizeSessionName('name..');
			assert.strictEqual(result, 'name');
		});
	});

	suite('Replaces consecutive dots with single dot', () => {

		test('should replace double dots with single dot', () => {
			const result = sanitizeSessionName('name..part');
			assert.strictEqual(result, 'name.part');
		});

		test('should replace triple dots with single dot', () => {
			const result = sanitizeSessionName('a...b');
			assert.strictEqual(result, 'a.b');
		});
	});

	suite('Removes .lock suffix', () => {

		test('should remove .lock suffix', () => {
			const result = sanitizeSessionName('name.lock');
			assert.strictEqual(result, 'name');
		});

		test('should only remove trailing .lock, preserving .lock in middle', () => {
			const result = sanitizeSessionName('test.lock.lock');
			assert.strictEqual(result, 'test.lock');
		});
	});

	suite('Returns empty string if nothing valid remains', () => {

		test('should strip surrounding invalid chars but preserve valid content', () => {
			// ###invalid### -> -invalid- -> invalid (leading/trailing hyphens removed)
			const result = sanitizeSessionName('###invalid###');
			assert.strictEqual(result, 'invalid');
		});

		test('should return empty string for only @ symbols', () => {
			const result = sanitizeSessionName('@@@');
			assert.strictEqual(result, '');
		});

		test('should return empty string for empty input', () => {
			const result = sanitizeSessionName('');
			assert.strictEqual(result, '');
		});
	});

	suite('Preserves already valid names unchanged', () => {

		test('should preserve simple hyphenated name', () => {
			const result = sanitizeSessionName('valid-name');
			assert.strictEqual(result, 'valid-name');
		});

		test('should preserve path-like name with slash', () => {
			const result = sanitizeSessionName('feature/test');
			assert.strictEqual(result, 'feature/test');
		});

		test('should preserve name with underscores', () => {
			const result = sanitizeSessionName('name_with_underscores');
			assert.strictEqual(result, 'name_with_underscores');
		});
	});

	suite('Handles complex edge cases correctly', () => {

		test('should trim leading and trailing spaces and convert inner spaces', () => {
			const result = sanitizeSessionName('  leading and trailing  ');
			assert.strictEqual(result, 'leading-and-trailing');
		});

		test('should extract valid content from complex leading chars with .lock suffix', () => {
			// ..-.lock -> .-.lock (consecutive dots -> single dot) -> lock (leading .- removed)
			// Note: 'lock' without the leading dot is a valid result
			const result = sanitizeSessionName('..-.lock');
			assert.strictEqual(result, 'lock');
		});

		test('should preserve nested path structure', () => {
			const result = sanitizeSessionName('a/b/c');
			assert.strictEqual(result, 'a/b/c');
		});
	});

	suite('Handles slash edge cases', () => {

		test('should replace consecutive slashes with single slash', () => {
			const result = sanitizeSessionName('feature//test');
			assert.strictEqual(result, 'feature/test');
		});

		test('should remove leading slash', () => {
			const result = sanitizeSessionName('/feature');
			assert.strictEqual(result, 'feature');
		});

		test('should remove trailing slash', () => {
			const result = sanitizeSessionName('feature/');
			assert.strictEqual(result, 'feature');
		});

		test('should return empty string for slash-only input', () => {
			const result = sanitizeSessionName('///');
			assert.strictEqual(result, '');
		});

		test('should handle mixed problematic slash patterns', () => {
			const result = sanitizeSessionName('//feature//test//');
			assert.strictEqual(result, 'feature/test');
		});
	});
});
