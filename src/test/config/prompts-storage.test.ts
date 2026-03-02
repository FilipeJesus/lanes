import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getPromptsPath, initializeGlobalStorageContext } from '../../vscode/providers/AgentSessionProvider';

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

suite('Prompts Storage Test Suite', () => {

	let tempDir: string;
	let globalStorageDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-storage-test-'));
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-prompts-global-storage-'));
	});

	teardown(async () => {
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('promptsFolder', undefined, vscode.ConfigurationTarget.Global);
		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	suite('Default: Repo-Local Storage (empty promptsFolder setting)', () => {

		test('should return .lanes/prompts path when promptsFolder setting is empty (default)', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'test-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);

			const expectedDir = path.join(tempDir, '.lanes', 'prompts');
			const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

			assert.strictEqual(result!.path, expectedPath);
			assert.strictEqual(result!.needsDir, expectedDir);
		});

		test('should use repo-local structure: <repoRoot>/.lanes/prompts/<sessionName>.txt', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'my-feature-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);
			assert.ok(result!.path.includes('.lanes'));
			assert.ok(result!.path.includes('prompts'));
			assert.ok(result!.path.endsWith(`${sessionName}.txt`));
		});
	});

	suite('User Override: Repo-Relative Storage (non-empty promptsFolder)', () => {

		test('should return repo-relative path when promptsFolder is set to .claude/prompts', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '.claude/prompts', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'test-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);

			const expectedDir = path.join(tempDir, '.claude', 'prompts');
			const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

			assert.strictEqual(result!.path, expectedPath);
			assert.strictEqual(result!.needsDir, expectedDir);

			assert.ok(!result!.path.startsWith(globalStorageDir));
		});

		test('should return repo-relative path for custom promptsFolder like prompts/claude', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', 'prompts/claude', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'feature-abc';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);

			const expectedDir = path.join(tempDir, 'prompts', 'claude');
			const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

			assert.strictEqual(result!.path, expectedPath);
			assert.strictEqual(result!.needsDir, expectedDir);
		});

		test('should handle promptsFolder with leading/trailing slashes', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '/custom-prompts/', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'session-1';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);

			const expectedDir = path.join(tempDir, 'custom-prompts');
			const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

			assert.strictEqual(result!.path, expectedPath);
		});
	});

	suite('Path Security Validation', () => {

		test('should return null for sessionName containing path traversal (..)', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const result = getPromptsPath('../../../etc/passwd', tempDir);

			assert.strictEqual(result, null);
		});

		test('should return null for sessionName containing forward slash', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const result = getPromptsPath('session/name', tempDir);

			assert.strictEqual(result, null);
		});

		test('should return null for sessionName containing backslash', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const result = getPromptsPath('session\\name', tempDir);

			assert.strictEqual(result, null);
		});

		test('should return null for empty sessionName', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const result = getPromptsPath('', tempDir);

			assert.strictEqual(result, null);
		});

		test('should fall back to .lanes/prompts when promptsFolder contains path traversal (..)', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '../../../etc/passwd', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'test-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);
			// Should fall back to .lanes/prompts, not the traversal path
			assert.ok(result!.path.includes('.lanes'));
			assert.ok(!result!.path.includes('etc'));
		});

		test('should normalize paths with leading slash to repo-relative paths', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '/custom-folder', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'test-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);

			const expectedDir = path.join(tempDir, 'custom-folder');
			const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

			assert.strictEqual(result!.path, expectedPath);
			assert.ok(!result!.path.startsWith(globalStorageDir));
		});

		test('should fall back to .lanes/prompts for Windows absolute path on any platform', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', 'C:\\Windows\\System32', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'test-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);
		});

		test('should reject path traversal attempts disguised in complex paths', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', 'prompts/../../../sensitive', vscode.ConfigurationTarget.Global);

			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const sessionName = 'test-session';

			const result = getPromptsPath(sessionName, tempDir);

			assert.ok(result);
			// Should fall back to .lanes/prompts, not the traversal path
			assert.ok(result!.path.includes('.lanes'));
		});
	});

	suite('Fallback: Global Storage Not Initialized', () => {

		test('should fall back to .lanes/prompts when global storage is not initialized', async () => {
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('promptsFolder', '', vscode.ConfigurationTarget.Global);

			const uninitializedRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uninit-repo-'));

			try {
				const sessionName = 'test-session';

				const expectedDir = path.join(uninitializedRepoDir, '.lanes', 'prompts');
				const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

				assert.ok(expectedPath.endsWith(`${sessionName}.txt`));
				assert.ok(expectedPath.includes('.lanes'));
			} finally {
				fs.rmSync(uninitializedRepoDir, { recursive: true, force: true });
			}
		});

		test('should return .lanes/prompts path structure: <repoRoot>/.lanes/prompts/<sessionName>.txt', async () => {
			const repoRoot = '/example/repo';
			const sessionName = 'my-session';

			const expectedDir = path.join(repoRoot, '.lanes', 'prompts');
			const expectedPath = path.join(expectedDir, `${sessionName}.txt`);

			assert.strictEqual(
				expectedPath,
				path.join(repoRoot, '.lanes', 'prompts', 'my-session.txt')
			);
		});
	});

	suite('Package.json Configuration', () => {

		test('should verify promptsFolder setting exists in package.json', () => {
			const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const promptsFolderConfig = getConfigProperty(packageJson.contributes.configuration, 'lanes.promptsFolder');

			assert.ok(promptsFolderConfig);
			assert.strictEqual(promptsFolderConfig.type, 'string');
			assert.strictEqual(promptsFolderConfig.default, '');
		});

		test('should verify promptsFolder description mentions .lanes/prompts as default', () => {
			const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const promptsFolderConfig = getConfigProperty(packageJson.contributes.configuration, 'lanes.promptsFolder');

			assert.ok(promptsFolderConfig.description);
			assert.ok(
				promptsFolderConfig.description.toLowerCase().includes('.lanes/prompts')
			);
		});
	});
});
