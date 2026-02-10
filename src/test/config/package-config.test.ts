import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Helper function to get a configuration property from the package.json configuration array.
 */
function getConfigProperty(config: any[], key: string): any {
	for (const section of config) {
		if (section.properties?.[key]) {
			return section.properties[key];
		}
	}
	return undefined;
}

/**
 * Helper function to find a configuration section by its title.
 */
function getConfigSection(config: any[], title: string): any {
	return config.find((section: any) => section.title === title);
}

suite('Package.json Configuration Test Suite', () => {

	let packageJson: any;
	let config: any;

	setup(() => {
		const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
		packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
		config = packageJson.contributes.configuration;
	});

	suite('Configuration Structure', () => {

		test('should verify configuration is an array with 6 sections', () => {
			assert.ok(Array.isArray(config));
			assert.strictEqual(config.length, 6);
		});

		test('should verify each configuration section has the correct title', () => {
			const expectedTitles = [
				'Lanes: General',
				'Lanes: Git',
				'Lanes: Advanced',
				'Lanes: Workflows',
				'Lanes: Audio',
				'Lanes: Terminal'
			];

			const actualTitles = config.map((section: any) => section.title);

			assert.deepStrictEqual(actualTitles, expectedTitles);
		});
	});

	suite('General Section', () => {

		test('should verify General section contains correct settings', () => {
			const generalSection = getConfigSection(config, 'Lanes: General');

			assert.ok(generalSection);
			assert.ok(generalSection.properties?.['lanes.worktreesFolder']);
			assert.ok(generalSection.properties?.['lanes.promptsFolder']);

			assert.strictEqual(generalSection.properties['lanes.worktreesFolder'].order, 1);
			assert.strictEqual(generalSection.properties['lanes.promptsFolder'].order, 2);
		});
	});

	suite('Git Section', () => {

		test('should verify Git section contains correct settings', () => {
			const gitSection = getConfigSection(config, 'Lanes: Git');

			assert.ok(gitSection);
			assert.ok(gitSection.properties?.['lanes.baseBranch']);
			assert.ok(gitSection.properties?.['lanes.includeUncommittedChanges']);

			assert.strictEqual(gitSection.properties['lanes.baseBranch'].order, 1);
			assert.strictEqual(gitSection.properties['lanes.includeUncommittedChanges'].order, 2);
		});
	});

	suite('Advanced Section', () => {

		test('should verify Advanced section contains correct settings', () => {
			const advancedSection = getConfigSection(config, 'Lanes: Advanced');

			assert.ok(advancedSection);

			const expectedSettings = [
				'lanes.useGlobalStorage',
				'lanes.localSettingsPropagation'
			];

			for (const setting of expectedSettings) {
				assert.ok(advancedSection.properties?.[setting]);
			}

			assert.ok(!advancedSection.properties?.['lanes.claudeSessionPath']);
			assert.ok(!advancedSection.properties?.['lanes.claudeStatusPath']);

			assert.strictEqual(advancedSection.properties['lanes.useGlobalStorage'].order, 1);
			assert.strictEqual(advancedSection.properties['lanes.localSettingsPropagation'].order, 2);
		});
	});

	suite('Workflows Section', () => {

		test('should verify Workflows section contains correct settings', () => {
			const workflowsSection = getConfigSection(config, 'Lanes: Workflows');

			assert.ok(workflowsSection);

			const expectedSettings = [
				'lanes.workflowsEnabled',
				'lanes.customWorkflowsFolder'
			];

			for (const setting of expectedSettings) {
				assert.ok(workflowsSection.properties?.[setting]);
			}

			assert.strictEqual(workflowsSection.properties['lanes.workflowsEnabled'].order, 1);
			assert.strictEqual(workflowsSection.properties['lanes.customWorkflowsFolder'].order, 2);

			assert.strictEqual(workflowsSection.properties['lanes.workflowsEnabled'].type, 'boolean');
			assert.strictEqual(workflowsSection.properties['lanes.workflowsEnabled'].default, true);

			assert.strictEqual(workflowsSection.properties['lanes.customWorkflowsFolder'].type, 'string');
			assert.strictEqual(workflowsSection.properties['lanes.customWorkflowsFolder'].default, '.lanes/workflows');
		});
	});

	suite('Audio Section', () => {

		test('should verify Audio section contains correct settings', () => {
			const audioSection = getConfigSection(config, 'Lanes: Audio');

			assert.ok(audioSection);
			assert.ok(audioSection.properties?.['lanes.chimeSound']);

			assert.strictEqual(audioSection.properties['lanes.chimeSound'].order, 1);

			assert.strictEqual(audioSection.properties['lanes.chimeSound'].type, 'string');
			assert.deepStrictEqual(
				audioSection.properties['lanes.chimeSound'].enum,
				['chime', 'alarm', 'level-up', 'notification']
			);
			assert.strictEqual(audioSection.properties['lanes.chimeSound'].default, 'chime');
			assert.strictEqual(
				audioSection.properties['lanes.chimeSound'].description,
				'Audio notification sound for session status changes (Note: You must reload VS Code for this to take effect).'
			);

			assert.ok(audioSection.properties['lanes.chimeSound'].enumDescriptions);
			assert.strictEqual(audioSection.properties['lanes.chimeSound'].enumDescriptions.length, 4);
		});
	});

	suite('Terminal Section', () => {

		test('should verify Terminal section contains correct settings', () => {
			const terminalSection = getConfigSection(config, 'Lanes: Terminal');

			assert.ok(terminalSection);
			assert.ok(terminalSection.properties?.['lanes.terminalMode']);

			assert.strictEqual(terminalSection.properties['lanes.terminalMode'].order, 1);

			assert.strictEqual(terminalSection.properties['lanes.terminalMode'].type, 'string');
			assert.deepStrictEqual(
				terminalSection.properties['lanes.terminalMode'].enum,
				['vscode', 'tmux']
			);
			assert.strictEqual(terminalSection.properties['lanes.terminalMode'].default, 'vscode');
			assert.ok(terminalSection.properties['lanes.terminalMode'].description);
			assert.ok(terminalSection.properties['lanes.terminalMode'].description.length > 20);
		});
	});

	suite('Configuration Defaults', () => {

		test('should verify all setting default values are preserved', () => {
			const worktreesFolder = getConfigProperty(config, 'lanes.worktreesFolder');
			assert.strictEqual(worktreesFolder.default, '.worktrees');

			const promptsFolder = getConfigProperty(config, 'lanes.promptsFolder');
			assert.strictEqual(promptsFolder.default, '');

			const baseBranch = getConfigProperty(config, 'lanes.baseBranch');
			assert.strictEqual(baseBranch.default, '');

			const includeUncommittedChanges = getConfigProperty(config, 'lanes.includeUncommittedChanges');
			assert.strictEqual(includeUncommittedChanges.default, true);

			const useGlobalStorage = getConfigProperty(config, 'lanes.useGlobalStorage');
			assert.strictEqual(useGlobalStorage.default, true);
		});
	});

	suite('Configuration Descriptions', () => {

		test('should verify settings have user-friendly descriptions', () => {
			const expectedDescriptions: { [key: string]: string } = {
				'lanes.worktreesFolder': 'Folder name where session worktrees are created (relative to repository root). Default: .worktrees',
				'lanes.promptsFolder': "Folder where session starting prompts are stored. Leave empty (default) to use VS Code's global storage (keeps repo clean). Set a path like '.lanes' for repo-relative storage.",
				'lanes.baseBranch': 'Branch to compare against when viewing changes. Leave empty for auto-detection (tries origin/main, origin/master, main, master)',
				'lanes.includeUncommittedChanges': 'Show uncommitted changes (staged and unstaged) when viewing session changes. Default: enabled',
				'lanes.useGlobalStorage': "Store session tracking files in VS Code's global storage. When enabled, files are stored in VS Code storage. When disabled, files are stored in .lanes/session_management/ at the repository root. Default: enabled"
			};

			for (const [key, expectedDescription] of Object.entries(expectedDescriptions)) {
				const setting = getConfigProperty(config, key);
				assert.ok(setting);
				assert.strictEqual(setting.description, expectedDescription);
			}
		});

		test('should verify useGlobalStorage has a meaningful description', () => {
			const globalStorageConfig = getConfigProperty(config, 'lanes.useGlobalStorage');

			assert.ok(globalStorageConfig.description);
			assert.ok(globalStorageConfig.description.length > 20);
			assert.ok(
				globalStorageConfig.description.toLowerCase().includes('global storage') ||
				globalStorageConfig.description.toLowerCase().includes('worktree')
			);
		});
	});
});
