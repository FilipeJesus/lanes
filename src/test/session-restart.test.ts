import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { restartSession } from '../mcp/tools';

suite('Session Restart Tool', () => {
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

  test('restartSession creates restart request file', async () => {
    // Act
    const result = await restartSession(worktreePath);

    // Assert
    assert.strictEqual(result.success, true);
    assert.ok(result.message);

    // Verify the request file was created
    const repoRoot = path.dirname(path.dirname(worktreePath));
    const restartDir = path.join(repoRoot, '.lanes', 'restart-requests');
    assert.ok(fs.existsSync(restartDir));

    const files = fs.readdirSync(restartDir);
    assert.ok(files.length > 0);

    // Verify file contents
    const configPath = path.join(restartDir, files[0]);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.worktreePath, worktreePath);
    assert.ok(config.requestedAt);
  });

  test('restartSession fails for non-existent worktree', async () => {
    // Arrange - use a path with .worktrees structure that doesn't exist
    const nonExistentPath = path.join(tempDir, '.worktrees', 'non-existent-session');

    // Act
    const result = await restartSession(nonExistentPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('does not exist'));
  });

  test('restartSession fails for invalid path structure', async () => {
    // Arrange - use a path without .worktrees structure (path traversal protection)
    const invalidPath = path.join(tempDir, 'does-not-exist');

    // Act
    const result = await restartSession(invalidPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('Invalid worktree path structure'));
  });

  test('restartSession fails for path traversal attempts', async () => {
    // Arrange - use a path with .. (path traversal attempt)
    const invalidPath = path.join(tempDir, '.worktrees', '..');

    // Act
    const result = await restartSession(invalidPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('Invalid worktree path structure'));
  });
});
