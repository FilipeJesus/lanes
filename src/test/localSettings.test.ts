import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { propagateLocalSettings, LocalSettingsPropagationMode } from '../core/localSettings';

suite('Local Settings Propagation', () => {
    let tempDir: string;
    let baseRepoPath: string;
    let worktreePath: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-local-settings-test-'));
        baseRepoPath = path.join(tempDir, 'repo');
        worktreePath = path.join(tempDir, 'repo', '.worktrees', 'test-session');
        fs.mkdirSync(worktreePath, { recursive: true });
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('should copy settings.local.json when mode is "copy"', async () => {
        // Arrange: Create .claude/settings.local.json in base repo
        const claudeDir = path.join(baseRepoPath, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const settingsPath = path.join(claudeDir, 'settings.local.json');
        fs.writeFileSync(settingsPath, JSON.stringify({ test: 'value' }), 'utf-8');

        // Act
        await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');

        // Assert
        const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
        assert.ok(fs.existsSync(targetPath), 'File should be copied');
        const content = fs.readFileSync(targetPath, 'utf-8');
        assert.deepStrictEqual(JSON.parse(content), { test: 'value' });
    });

    test('should create symlink when mode is "symlink"', async () => {
        // Arrange: Create .claude/settings.local.json in base repo
        const claudeDir = path.join(baseRepoPath, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const settingsPath = path.join(claudeDir, 'settings.local.json');
        fs.writeFileSync(settingsPath, JSON.stringify({ test: 'value' }), 'utf-8');

        // Act
        await propagateLocalSettings(baseRepoPath, worktreePath, 'symlink');

        // Assert
        const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
        assert.ok(fs.existsSync(targetPath), 'Symlink should exist');
        const stats = fs.lstatSync(targetPath);
        assert.ok(stats.isSymbolicLink(), 'Should be a symbolic link');
    });

    test('should do nothing when mode is "disabled"', async () => {
        // Arrange: Create .claude/settings.local.json in base repo
        const claudeDir = path.join(baseRepoPath, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const settingsPath = path.join(claudeDir, 'settings.local.json');
        fs.writeFileSync(settingsPath, JSON.stringify({ test: 'value' }), 'utf-8');

        // Act
        await propagateLocalSettings(baseRepoPath, worktreePath, 'disabled');

        // Assert
        const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
        assert.ok(!fs.existsSync(targetPath), 'File should not exist');
    });

    test('should handle missing source file gracefully', async () => {
        // Arrange: No source file

        // Act & Assert: Should not throw
        await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');
    });

    test('should handle existing .claude directory in worktree', async () => {
        // Arrange: Create .claude/settings.local.json in base repo
        const claudeDir = path.join(baseRepoPath, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const settingsPath = path.join(claudeDir, 'settings.local.json');
        fs.writeFileSync(settingsPath, JSON.stringify({ test: 'value' }), 'utf-8');

        // Arrange: Create .claude directory in worktree
        const worktreeClaudeDir = path.join(worktreePath, '.claude');
        fs.mkdirSync(worktreeClaudeDir, { recursive: true });

        // Act
        await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');

        // Assert
        const targetPath = path.join(worktreePath, '.claude', 'settings.local.json');
        assert.ok(fs.existsSync(targetPath), 'File should be copied');
    });

    test('should overwrite existing target file when mode is "copy"', async () => {
        // Arrange: Create source and existing target
        const claudeDir = path.join(baseRepoPath, '.claude');
        fs.mkdirSync(claudeDir, { recursive: true });
        const settingsPath = path.join(claudeDir, 'settings.local.json');
        fs.writeFileSync(settingsPath, JSON.stringify({ new: 'value' }), 'utf-8');

        const worktreeClaudeDir = path.join(worktreePath, '.claude');
        fs.mkdirSync(worktreeClaudeDir, { recursive: true });
        const targetPath = path.join(worktreeClaudeDir, 'settings.local.json');
        fs.writeFileSync(targetPath, JSON.stringify({ old: 'value' }), 'utf-8');

        // Act
        await propagateLocalSettings(baseRepoPath, worktreePath, 'copy');

        // Assert
        const content = fs.readFileSync(targetPath, 'utf-8');
        assert.deepStrictEqual(JSON.parse(content), { new: 'value' });
    });
});
