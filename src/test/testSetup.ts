/**
 * Shared test utilities for Claude Lanes extension tests.
 *
 * This module provides common setup and teardown utilities that can be
 * reused across different test suites.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Re-export common imports for convenience
export { path, fs, os };

/**
 * Result of creating a temporary test directory.
 */
export interface TempDirResult {
    /** The root temporary directory path */
    tempDir: string;
    /** The .worktrees subdirectory path */
    worktreesDir: string;
}

/**
 * Creates a temporary directory structure for testing.
 *
 * Creates a unique temp directory with a `.worktrees` subdirectory,
 * which mimics the Claude Lanes extension's directory structure.
 *
 * @returns Object containing paths to tempDir and worktreesDir
 *
 * @example
 * ```typescript
 * let dirs: TempDirResult;
 *
 * setup(() => {
 *     dirs = createTempDir();
 * });
 *
 * teardown(() => {
 *     cleanupTempDir(dirs.tempDir);
 * });
 * ```
 */
export function createTempDir(): TempDirResult {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-test-'));
    const worktreesDir = path.join(tempDir, '.worktrees');
    return { tempDir, worktreesDir };
}

/**
 * Cleans up a temporary directory created by `createTempDir()`.
 *
 * Recursively removes the directory and all its contents.
 * Uses `force: true` to ignore errors if the directory doesn't exist.
 *
 * @param tempDir - The temporary directory path to remove
 */
export function cleanupTempDir(tempDir: string): void {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
