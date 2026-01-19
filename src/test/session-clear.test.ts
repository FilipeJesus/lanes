import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { clearSession } from '../mcp/tools';

suite('Session Clear Tool', () => {
  let tempDir: string;
  let worktreePath: string;

  setup(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
    worktreePath = path.join(tempDir, '.worktrees', 'test-session');
    fs.mkdirSync(worktreePath, { recursive: true });
  });

  teardown(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('clearSession creates clear request file', async () => {
    // Act
    const result = await clearSession(worktreePath);

    // Assert
    assert.strictEqual(result.success, true);
    assert.ok(result.message);

    // Verify the request file was created
    const repoRoot = path.dirname(path.dirname(worktreePath));
    const clearDir = path.join(repoRoot, '.lanes', 'clear-requests');
    assert.ok(fs.existsSync(clearDir));

    const files = fs.readdirSync(clearDir);
    assert.ok(files.length > 0);

    // Verify file contents
    const configPath = path.join(clearDir, files[0]);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.worktreePath, worktreePath);
    assert.ok(config.requestedAt);
  });

  test('clearSession fails for non-existent worktree', async () => {
    // Arrange - use a path with .worktrees structure that doesn't exist
    const nonExistentPath = path.join(tempDir, '.worktrees', 'non-existent-session');

    // Act
    const result = await clearSession(nonExistentPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('does not exist'));
  });

  test('clearSession fails for invalid path structure', async () => {
    // Arrange - use a path without .worktrees structure (path traversal protection)
    const invalidPath = path.join(tempDir, 'does-not-exist');

    // Act
    const result = await clearSession(invalidPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('Invalid worktree path structure'));
  });

  test('clearSession fails for path traversal attempts', async () => {
    // Arrange - use a path with .. (path traversal attempt)
    const invalidPath = path.join(tempDir, '.worktrees', '..');

    // Act
    const result = await clearSession(invalidPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('Invalid worktree path structure'));
  });
});
