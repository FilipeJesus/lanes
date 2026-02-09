import { constants } from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

export type LocalSettingsPropagationMode = 'copy' | 'symlink' | 'disabled';

const SETTINGS_FILE_NAME = 'settings.local.json';
const CLAUDE_DIR_NAME = '.claude';

/**
 * Propagates the local settings file from the base repository to a worktree.
 *
 * Behavior by mode:
 * - "copy": Copies the file to the worktree (Windows-compatible)
 * - "symlink": Creates a symbolic link (Unix-only, efficient)
 * - "disabled": Does nothing
 *
 * If the source file doesn't exist, this function does nothing silently.
 * Errors are logged but don't throw (session creation should succeed).
 *
 * @param baseRepoPath Path to the base repository
 * @param worktreePath Path to the worktree directory
 * @param mode The propagation mode to use
 */
export async function propagateLocalSettings(
    baseRepoPath: string,
    worktreePath: string,
    mode: LocalSettingsPropagationMode
): Promise<void> {
    // Early exit if disabled
    if (mode === 'disabled') {
        return;
    }

    const sourcePath = path.join(baseRepoPath, CLAUDE_DIR_NAME, SETTINGS_FILE_NAME);
    const targetDir = path.join(worktreePath, CLAUDE_DIR_NAME);
    const targetPath = path.join(targetDir, SETTINGS_FILE_NAME);

    // Check if source file exists
    try {
        await fsPromises.access(sourcePath, constants.R_OK);
    } catch {
        // Source file doesn't exist - silently exit
        return;
    }

    try {
        // Ensure target directory exists
        await fsPromises.mkdir(targetDir, { recursive: true });

        if (mode === 'symlink') {
            // Remove existing target if it exists (could be file, symlink, or directory)
            try {
                await fsPromises.unlink(targetPath);
            } catch {
                // Doesn't exist or can't remove - continue
            }

            // Create relative symlink for portability
            const relativeSource = path.relative(targetDir, sourcePath);
            await fsPromises.symlink(relativeSource, targetPath);
        } else {
            // mode === 'copy'
            await fsPromises.copyFile(sourcePath, targetPath);
        }
    } catch (err) {
        // Log but don't throw - session creation should succeed
        console.warn(`Lanes: Failed to propagate local settings: ${err}`);
    }
}
