import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import sinon from 'sinon';
import * as gitService from '../../gitService';

suite('Git Diff Command Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;
	let execGitStub: sinon.SinonStub;
	let originalExecGit: typeof gitService.execGit;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-git-diff-command-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');

		// Save original execGit before stubbing
		originalExecGit = gitService.execGit.bind(gitService);

		// Set up git stubs for mocking to prevent parent directory traversal
		execGitStub = sinon.stub(gitService, 'execGit');

		// Configure stub behavior for different git commands
		execGitStub.callsFake(async (args: string[], cwd: string, options?: gitService.ExecGitOptions) => {
			// Mock worktree list command - return empty output for non-git directories
			if (args[0] === 'worktree' && args[1] === 'list' && args.includes('--porcelain')) {
				// Check if this is a real git repo by looking for .git directory
				const gitDir = path.join(cwd, '.git');
				try {
					fs.statSync(gitDir);
					// This is a real git repo, use real git
					return await originalExecGit(args, cwd, options);
				} catch {
					// Not a git repo, return empty output
					return '';
				}
			}

			// Mock rev-parse for non-git directories
			if (args.includes('rev-parse')) {
				const gitDir = path.join(cwd, '.git');
				try {
					fs.statSync(gitDir);
					// This is a real git repo, use real git
					return await originalExecGit(args, cwd, options);
				} catch {
					// Not a git repo, throw error
					throw new Error('not a git repository');
				}
			}

			// For other commands, use real git
			return await originalExecGit(args, cwd, options);
		});
	});

	// Clean up after each test
	teardown(() => {
		// Restore stubs
		if (execGitStub) {
			execGitStub.restore();
		}
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('Git Changes Button', () => {

		test('should verify showGitChanges command is registered in package.json', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has contributes.commands section
			assert.ok(
				packageJson.contributes?.commands,
				'package.json should have contributes.commands section'
			);

			// Assert: claudeWorktrees.showGitChanges command exists
			const commands = packageJson.contributes.commands;
			const showGitChangesCmd = commands.find(
				(cmd: { command: string }) => cmd.command === 'claudeWorktrees.showGitChanges'
			);

			assert.ok(
				showGitChangesCmd,
				'package.json should have claudeWorktrees.showGitChanges command'
			);
			assert.strictEqual(
				showGitChangesCmd.title,
				'Show Git Changes',
				'showGitChanges command should have title "Show Git Changes"'
			);
			assert.strictEqual(
				showGitChangesCmd.icon,
				'$(git-compare)',
				'showGitChanges command should have git-compare icon'
			);
		});

		test('should verify showGitChanges command appears in view/item/context menu for sessionItem', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: package.json has menus.view/item/context section
			const menuItems = packageJson.contributes?.menus?.['view/item/context'];
			assert.ok(
				menuItems,
				'package.json should have contributes.menus.view/item/context section'
			);

			// Assert: showGitChanges menu item exists with correct when clause
			const showGitChangesMenuItem = menuItems.find(
				(item: { command: string }) => item.command === 'claudeWorktrees.showGitChanges'
			);

			assert.ok(
				showGitChangesMenuItem,
				'showGitChanges should be in view/item/context menu'
			);
			assert.ok(
				showGitChangesMenuItem.when.includes('sessionItem'),
				'showGitChanges menu item should only appear for sessionItem context'
			);
			assert.strictEqual(
				showGitChangesMenuItem.group,
				'inline@1',
				'showGitChanges should be in inline group at position 1 (after openInNewWindow)'
			);
		});
	});

	suite('Git Changes Command', () => {

		test('should have showGitChanges command registered after activation', async () => {
			// Trigger extension activation by executing one of its commands
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			const commands = await vscode.commands.getCommands(true);

			assert.ok(
				commands.includes('claudeWorktrees.showGitChanges'),
				'showGitChanges command should be registered after extension activation'
			);
		});
	});
});
