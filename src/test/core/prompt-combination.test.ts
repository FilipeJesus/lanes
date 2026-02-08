import * as assert from 'assert';
import { combinePromptAndCriteria } from '../../extension';

suite('Extension Integration', () => {

	suite('Workflow Prompt Instructions', () => {

		test('combinePromptAndCriteria returns combined format when both provided', () => {
			// Arrange
			const prompt = 'Implement feature X';
			const criteria = 'Must pass all tests';

			// Act
			const result = combinePromptAndCriteria(prompt, criteria);

			// Assert
			assert.ok(result.includes('request:'), 'Should include request prefix');
			assert.ok(result.includes(prompt), 'Should include the prompt');
			assert.ok(result.includes('acceptance criteria:'), 'Should include acceptance criteria prefix');
			assert.ok(result.includes(criteria), 'Should include the criteria');
		});

		test('combinePromptAndCriteria returns prompt only when no criteria', () => {
			// Arrange
			const prompt = 'Implement feature X';

			// Act
			const result = combinePromptAndCriteria(prompt, '');

			// Assert
			assert.strictEqual(result, prompt, 'Should return just the prompt');
		});

		test('combinePromptAndCriteria returns criteria only when no prompt', () => {
			// Arrange
			const criteria = 'Must pass all tests';

			// Act
			const result = combinePromptAndCriteria('', criteria);

			// Assert
			assert.strictEqual(result, criteria, 'Should return just the criteria');
		});

		test('combinePromptAndCriteria returns empty string when neither provided', () => {
			// Act
			const result = combinePromptAndCriteria('', '');

			// Assert
			assert.strictEqual(result, '', 'Should return empty string');
		});

		test('combinePromptAndCriteria handles undefined values', () => {
			// Act
			const result = combinePromptAndCriteria(undefined, undefined);

			// Assert
			assert.strictEqual(result, '', 'Should return empty string for undefined');
		});

		test('combinePromptAndCriteria trims whitespace', () => {
			// Arrange
			const prompt = '  trimmed prompt  ';
			const criteria = '  trimmed criteria  ';

			// Act
			const result = combinePromptAndCriteria(prompt, criteria);

			// Assert
			assert.ok(!result.includes('  trimmed'), 'Should trim leading whitespace');
			assert.ok(!result.includes('trimmed  '), 'Should trim trailing whitespace');
		});
	});
});
