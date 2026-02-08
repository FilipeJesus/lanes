import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { initializeGlobalStorageContext } from '../../ClaudeSessionProvider';

suite('Local Settings Integration', () => {

	let tempDir: string;
	let baseRepoPath: string;
	let worktreesDir: string;
	let globalStorageDir: string;

	setup(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-local-settings-integration-'));
		baseRepoPath = tempDir;
		worktreesDir = path.join(tempDir, '.worktrees');
		fs.mkdirSync(worktreesDir, { recursive: true });
		globalStorageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-global-storage-'));

		// Initialize global storage context
		const mockUri = vscode.Uri.file(globalStorageDir);
		initializeGlobalStorageContext(mockUri, baseRepoPath);

		// Create .claude/settings.local.json in base repo
		const claudeDir = path.join(baseRepoPath, '.claude');
		fs.mkdirSync(claudeDir, { recursive: true });
		const settingsPath = path.join(claudeDir, 'settings.local.json');
		fs.writeFileSync(settingsPath, JSON.stringify({ env: { TEST_VAR: 'test-value' } }), 'utf-8');

		// Set propagation mode
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('localSettingsPropagation', 'copy', vscode.ConfigurationTarget.Global);
	});

	teardown(async () => {
		// Reset configuration
		const config = vscode.workspace.getConfiguration('lanes');
		await config.update('localSettingsPropagation', undefined, vscode.ConfigurationTarget.Global);

		fs.rmSync(tempDir, { recursive: true, force: true });
		fs.rmSync(globalStorageDir, { recursive: true, force: true });
	});

	test('should propagate settings.local.json to new worktree', async () => {
		// Arrange: Create a worktree directory manually
		const sessionName = 'test-local-settings';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Act: Call propagateLocalSettings
		const { propagateLocalSettings } = await import('../../localSettings.js');
		await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');

		// Assert
		const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
		assert.ok(fs.existsSync(targetPath), 'File should exist in worktree');
		const content = fs.readFileSync(targetPath, 'utf-8');
		assert.deepStrictEqual(JSON.parse(content), { env: { TEST_VAR: 'test-value' } });
	});

	test('should not propagate when source does not exist', async () => {
		// Arrange: Remove the source file
		const sourcePath = path.join(baseRepoPath, '.claude', 'settings.local.json');
		fs.unlinkSync(sourcePath);

		// Arrange: Create a worktree directory
		const sessionName = 'test-no-source';
		const worktreePath = path.join(worktreesDir, sessionName);
		fs.mkdirSync(worktreePath, { recursive: true });

		// Act: Call propagateLocalSettings
		const { propagateLocalSettings } = await import('../../localSettings.js');
		await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');

		// Assert
		const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
		assert.ok(!fs.existsSync(targetPath), 'File should not exist when source is missing');
	});
});
