/**
 * Shared test utilities for Lanes extension tests.
 *
 * This module provides common setup and teardown utilities that can be
 * reused across different test suites.
 *
 * Test mocking infrastructure:
 * - setupMemfs(): In-memory filesystem for isolated file operations
 * - setupGitStubs(): Sinon stubs for git operation mocking
 * - createTestRepo(): Creates in-memory git repository structure
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
 * which mimics the Lanes extension's directory structure.
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
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

// ============================================================================
// Test Mocking Infrastructure
// ============================================================================

import { fs as memfs, vol } from 'memfs';
import sinon from 'sinon';

// Re-export for convenience in test files
export { memfs, vol, sinon };

/**
 * Type for the memfs volume instance.
 * Using 'any' to avoid circular type references with the vol export.
 */
export type VolumeType = any;

/**
 * Result of setting up an in-memory filesystem.
 */
export interface MemfsSetupResult {
    /** The memfs volume instance */
    vol: VolumeType;
    /** Reset the volume to empty state */
    reset: () => void;
}

/**
 * Sets up an in-memory filesystem using memfs.
 *
 * Creates an isolated virtual filesystem for testing file operations
 * without touching the real filesystem. Useful for testing file
 * creation, deletion, and path manipulation in isolation.
 *
 * @returns MemfsSetupResult with vol instance and reset method
 *
 * @example
 * ```typescript
 * const memfs = setupMemfs();
 *
 * // Use vol.fromJSON() to create files
 * memfs.vol.fromJSON({
 *   '/test/file.txt': 'content',
 *   '/test/.git/config': '[core]\nrepositoryformatversion = 0'
 * });
 *
 * // Clean up after test
 * memfs.reset();
 * ```
 */
export function setupMemfs(): MemfsSetupResult {
    return {
        vol,
        reset: () => vol.reset(),
    };
}

/**
 * Git stub result for mocking git operations.
 */
export interface GitStubsResult {
    /** Sinon stub for execGit or similar git functions */
    execGit: sinon.SinonStub;
    /** Restore all stubs to original behavior */
    restore: () => void;
}

/**
 * Sets up sinon stubs for git operations.
 *
 * Creates configurable stubs for git command execution, allowing tests
 * to mock git responses without requiring actual git repositories.
 *
 * @returns GitStubsResult with stub and restore method
 *
 * @example
 * ```typescript
 * const gitStubs = setupGitStubs();
 *
 * // Configure stub behavior
 * gitStubs.execGit.withArgs(['status']).resolves({ stdout: '', stderr: '', exitCode: 0 });
 *
 * // Clean up after test
 * gitStubs.restore();
 * ```
 */
export function setupGitStubs(): GitStubsResult {
    const execGit = sinon.stub();

    return {
        execGit,
        restore: () => execGit.restore(),
    };
}

/**
 * Creates an in-memory git repository structure.
 *
 * Sets up the basic directory structure and configuration files
 * that mimic a real git repository. Uses the provided vol instance
 * from memfs to create files in memory.
 *
 * @param vol - The memfs volume instance (from setupMemfs().vol)
 * @param basePath - The base path for the repo (default: '/test-repo')
 *
 * @example
 * ```typescript
 * const memfs = setupMemfs();
 * createTestRepo(memfs.vol, '/my-repo');
 *
 * // Now /my-repo/.git/config exists in memory
 * const config = memfs.vol.readFileSync('/my-repo/.git/config', 'utf8');
 * ```
 */
export function createTestRepo(volume: VolumeType, basePath = '/test-repo'): void {
    const gitDir = path.join(basePath, '.git');

    volume.fromJSON({
        // Basic git directory structure
        [path.join(gitDir, 'config')]: `[core]
    repositoryformatversion = 0
    filemode = true
    bare = false
    logallrefupdates = true`,
        [path.join(gitDir, 'HEAD')]: 'ref: refs/heads/main',
        [path.join(gitDir, 'objects', 'info')]: '',
        [path.join(gitDir, 'objects', 'pack')]: '',
        [path.join(gitDir, 'refs', 'heads')]: '',
        [path.join(gitDir, 'refs', 'tags')]: '',
        [path.join(gitDir, 'refs', 'remotes')]: '',

        // Common workspace files
        [path.join(basePath, 'README.md')]: '# Test Repository\n',
    });
}

/**
 * Creates a worktree structure within an in-memory git repository.
 *
 * Simulates a git worktree by creating the necessary metadata files
 * that the Lanes extension looks for when managing sessions.
 *
 * @param vol - The memfs volume instance
 * @param repoPath - The base repository path
 * @param worktreeName - The name of the worktree/session
 * @param branch - The branch name (default: 'feature/test-session')
 *
 * @example
 * ```typescript
 * const memfs = setupMemfs();
 * createTestRepo(memfs.vol);
 * createWorktree(memfs.vol, '/test-repo', 'my-session', 'feature/my-branch');
 * ```
 */
export function createWorktree(
    volume: VolumeType,
    repoPath: string,
    worktreeName: string,
    branch = 'feature/test-session'
): void {
    const worktreesDir = path.join(repoPath, '.worktrees', worktreeName);

    volume.fromJSON({
        [path.join(worktreesDir, 'gitdir')]: path.join(repoPath, '.git', 'worktrees', worktreeName),
        [path.join(worktreesDir, 'HEAD')]: `ref: refs/heads/${branch}`,
        [path.join(worktreesDir, 'commondir')]: path.join(repoPath, '.git'),
    });
}
