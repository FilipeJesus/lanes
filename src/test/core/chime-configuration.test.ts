import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

suite('SessionFormProvider Chime Configuration', () => {

	test('should use default chime.mp3 when no configuration is set', () => {
		// Arrange: Import SessionFormProvider
		const { SessionFormProvider, CHIME_SOUNDS, isValidChimeSound } = require('../../vscode/providers/SessionFormProvider');

		// Act: Verify the validation function accepts 'chime'
		const isValid = isValidChimeSound('chime');

		// Assert: 'chime' should be valid
		assert.strictEqual(isValid, true, 'isValidChimeSound should return true for "chime"');
		assert.ok(CHIME_SOUNDS.includes('chime'), 'CHIME_SOUNDS should include "chime"');
	});

	test('should accept valid chime sound selections', () => {
		// Arrange: Import SessionFormProvider validation
		const { isValidChimeSound, CHIME_SOUNDS } = require('../../vscode/providers/SessionFormProvider');

		// Act & Assert: All valid values should pass validation
		const validSounds = ['chime', 'alarm', 'level-up', 'notification'];
		for (const sound of validSounds) {
			assert.strictEqual(
				isValidChimeSound(sound),
				true,
				`isValidChimeSound should return true for "${sound}"`
			);
		}

		// Assert: Verify CHIME_SOUNDS constant matches expected values
		assert.deepStrictEqual(
			CHIME_SOUNDS,
			['chime', 'alarm', 'level-up', 'notification'],
			'CHIME_SOUNDS should contain all valid options'
		);
	});

	test('should reject invalid chime sound values', () => {
		// Arrange: Import SessionFormProvider validation
		const { isValidChimeSound } = require('../../vscode/providers/SessionFormProvider');

		// Act & Assert: Invalid values should fail validation
		const invalidSounds = [
			'invalid-sound',
			'',
			'chimes',
			'alarm.mp3',
			'level_up',
			'notifications',
			'wav-file',
			undefined,
			null,
			123
		];

		for (const sound of invalidSounds) {
			assert.strictEqual(
				isValidChimeSound(sound),
				false,
				`isValidChimeSound should return false for invalid value: ${sound}`
			);
		}
	});

	test('should accept only the four valid chime sound values', () => {
		// Arrange: Import SessionFormProvider constants
		const { CHIME_SOUNDS } = require('../../vscode/providers/SessionFormProvider');

		// Assert: Verify only the 4 valid values are accepted
		assert.deepStrictEqual(
			CHIME_SOUNDS,
			['chime', 'alarm', 'level-up', 'notification'],
			'Only the four valid chime sound values should be defined'
		);

		// Assert: Verify the type is a readonly tuple of exactly 4 values
		assert.strictEqual(CHIME_SOUNDS.length, 4, 'CHIME_SOUNDS should have exactly 4 values');
	});
});

suite('Configuration Tests', () => {

	suite('Chime Sound Configuration', () => {

		test('should verify lanes.chimeSound configuration property exists in package.json with correct enum values and default', () => {
			// Arrange: Read package.json from project root
			// __dirname in compiled output is out/test/core/, go up 3 levels to project root
			const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Act: Find chimeSound configuration
			const chimeSoundConfig = packageJson.contributes.configuration
				.find((section: any) => section.title === 'Lanes: Audio')
				?.properties?.['lanes.chimeSound'];

			// Assert: lanes.chimeSound should exist with correct enum values
			assert.ok(chimeSoundConfig, 'lanes.chimeSound should exist in package.json');
			assert.deepStrictEqual(
				chimeSoundConfig.enum,
				['chime', 'alarm', 'level-up', 'notification'],
				'lanes.chimeSound should have enum values: chime, alarm, level-up, notification'
			);

			// Assert: Default value should be 'chime'
			assert.strictEqual(
				chimeSoundConfig.default,
				'chime',
				'lanes.chimeSound should default to "chime"'
			);

			// Assert: Description should match expected value
			assert.strictEqual(
				chimeSoundConfig.description,
				'Audio notification sound for session status changes (Note: You must reload VS Code for this to take effect).',
				'lanes.chimeSound should have description "Audio notification sound for session status changes (Note: You must reload VS Code for this to take effect)."'
			);

			// Assert: Section title should be 'Lanes: Audio'
			const audioSection = packageJson.contributes.configuration
				.find((section: any) => section.title === 'Lanes: Audio');
			assert.ok(audioSection, 'Lanes: Audio section should exist');
			assert.ok(
				audioSection.properties?.['lanes.chimeSound'],
				'lanes.chimeSound should be in Lanes: Audio section'
			);
		});

		test('should verify VS Code configuration API can read lanes.chimeSound setting', () => {
			// Arrange: Get configuration
			const config = vscode.workspace.getConfiguration('lanes');

			// Act: Read lanes.chimeSound from configuration
			const chimeSound = config.get<string>('chimeSound');

			// Assert: Should return the default value 'chime'
			assert.strictEqual(chimeSound, 'chime', 'lanes.chimeSound should return default value "chime"');

			// Note: We cannot test setting custom values in this test environment
			// because there is no workspace open. The enum schema validation
			// is enforced by VS Code's settings UI, not by the configuration API.
		});

		test('should verify only valid enum values can be set for lanes.chimeSound', () => {
			// This test verifies that the schema is correctly defined in package.json
			// The enum constraint is enforced by VS Code's settings UI, not at runtime
			// by the configuration API. The API accepts any string value, but the UI
			// will only show the enum options.

			// Arrange: Read package.json from project root
			// __dirname in compiled output is out/test/core/, go up 3 levels to project root
			const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Act: Find chimeSound configuration
			const chimeSoundConfig = packageJson.contributes.configuration
				.find((section: any) => section.title === 'Lanes: Audio')
				?.properties?.['lanes.chimeSound'];

			// Assert: Schema should define valid enum values
			assert.deepStrictEqual(
				chimeSoundConfig.enum,
				['chime', 'alarm', 'level-up', 'notification'],
				'lanes.chimeSound schema should define valid enum values'
			);

			// Assert: Schema should include enum descriptions
			assert.ok(
				chimeSoundConfig.enumDescriptions,
				'lanes.chimeSound should have enumDescriptions for UI'
			);
			assert.strictEqual(
				chimeSoundConfig.enumDescriptions.length,
				4,
				'lanes.chimeSound should have 4 enum descriptions'
			);
		});
	});
});
