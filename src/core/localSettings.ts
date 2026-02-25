import { constants } from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { CodeAgent } from './codeAgents';

export type LocalSettingsPropagationMode = 'copy' | 'symlink' | 'disabled';

/** Default settings file name (Claude-specific, for backward compatibility) */
const DEFAULT_SETTINGS_FILE_NAME = 'settings.local.json';
/** Default data directory (Claude-specific, for backward compatibility) */
const DEFAULT_DIR_NAME = '.claude';

/**
 * Propagate a single settings file from the base repository to a worktree.
 *
 * @param baseRepoPath Path to the base repository
 * @param worktreePath Path to the worktree directory
 * @param mode The propagation mode to use
 * @param dirName Directory name relative to repo root (e.g., '.claude')
 * @param fileName File name within that directory (e.g., 'settings.local.json')
 */
async function propagateSingleFile(
    baseRepoPath: string,
    worktreePath: string,
    mode: LocalSettingsPropagationMode,
    dirName: string,
    fileName: string
): Promise<void> {
    const sourcePath = path.join(baseRepoPath, dirName, fileName);
    const targetDir = path.join(worktreePath, dirName);
    const targetPath = path.join(targetDir, fileName);

    // Check if source file exists
    try {
        await fsPromises.access(sourcePath, constants.R_OK);
    } catch {
        // Source file doesn't exist - silently skip
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
        console.warn(`Lanes: Failed to propagate local settings (${dirName}/${fileName}): ${err}`);
    }
}

/**
 * Propagates local settings files from the base repository to a worktree.
 *
 * When a CodeAgent is provided, queries it for the list of settings files to propagate.
 * Falls back to the hardcoded Claude defaults (.claude/settings.local.json) when no
 * agent is provided, for backward compatibility.
 *
 * Behavior by mode:
 * - "copy": Copies files to the worktree (Windows-compatible)
 * - "symlink": Creates symbolic links (Unix-only, efficient)
 * - "disabled": Does nothing
 *
 * If a source file doesn't exist, it is silently skipped.
 * Errors are logged but don't throw (session creation should succeed).
 *
 * @param baseRepoPath Path to the base repository
 * @param worktreePath Path to the worktree directory
 * @param mode The propagation mode to use
 * @param codeAgent Optional CodeAgent to query for settings files
 */
export async function propagateLocalSettings(
    baseRepoPath: string,
    worktreePath: string,
    mode: LocalSettingsPropagationMode,
    codeAgent?: CodeAgent
): Promise<void> {
    // Early exit if disabled
    if (mode === 'disabled') {
        return;
    }

    // Get settings files from agent, or fall back to Claude defaults
    const settingsFiles = codeAgent
        ? codeAgent.getLocalSettingsFiles()
        : [{ dir: DEFAULT_DIR_NAME, file: DEFAULT_SETTINGS_FILE_NAME }];

    for (const { dir, file } of settingsFiles) {
        await propagateSingleFile(baseRepoPath, worktreePath, mode, dir, file);
    }
}
