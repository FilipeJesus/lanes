import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import {
    ClaudeSessionProvider,
    SessionItem,
    getSessionId,
    initializeGlobalStorageContext,
    isGlobalStorageEnabled,
    getGlobalStoragePath,
    getGlobalStorageUri,
    getBaseRepoPathForStorage,
    getSessionNameFromWorktree,
    getRepoIdentifier,
    getWorktreesFolder,
    getPromptsPath
} from './ClaudeSessionProvider';
import { SessionFormProvider, PermissionMode, isValidPermissionMode } from './SessionFormProvider';
import { initializeGitPath, execGit } from './gitService';
import { GitChangesPanel, OnBranchChangeCallback } from './GitChangesPanel';
import { addProject, removeProject, clearCache as clearProjectManagerCache, initialize as initializeProjectManagerService } from './ProjectManagerService';

/**
 * Helper to get error message from unknown error type
 */
function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Represents a broken worktree that needs repair.
 * A worktree is broken when its .git file points to a non-existent metadata directory.
 */
export interface BrokenWorktree {
    /** Full path to the worktree directory */
    path: string;
    /** Session name (folder name, which equals the branch name) */
    sessionName: string;
    /** Expected branch name (same as session name in Claude Lanes) */
    expectedBranch: string;
}

/**
 * Detects broken worktrees in the .worktrees directory.
 * A worktree is broken when:
 * 1. It has a .git file (not directory) - indicating it's a worktree
 * 2. The .git file contains a gitdir reference to a metadata directory
 * 3. That metadata directory does not exist (e.g., after container rebuild)
 *
 * @param baseRepoPath The path to the base repository
 * @returns Array of broken worktrees that need repair
 */
export async function detectBrokenWorktrees(baseRepoPath: string): Promise<BrokenWorktree[]> {
    const worktreesDir = path.join(baseRepoPath, getWorktreesFolder());
    const brokenWorktrees: BrokenWorktree[] = [];

    // Check if .worktrees directory exists
    try {
        await fsPromises.access(worktreesDir);
    } catch {
        // Directory doesn't exist, no worktrees to check
        return brokenWorktrees;
    }

    // Read all entries in the worktrees directory
    let entries: string[];
    try {
        entries = await fsPromises.readdir(worktreesDir);
    } catch (err) {
        console.warn('Claude Lanes: Failed to read worktrees directory:', getErrorMessage(err));
        return brokenWorktrees;
    }

    // Check each entry
    for (const entry of entries) {
        // Validate entry name to prevent path traversal
        if (!entry || entry.includes('..') || entry.includes('/') || entry.includes('\\')) {
            continue;
        }

        const worktreePath = path.join(worktreesDir, entry);

        // Check if it's a directory
        try {
            const stat = await fsPromises.stat(worktreePath);
            if (!stat.isDirectory()) {
                continue;
            }
        } catch {
            continue;
        }

        // Check for .git file (not directory)
        const gitPath = path.join(worktreePath, '.git');
        try {
            const gitStat = await fsPromises.stat(gitPath);

            // Skip if .git is a directory (not a worktree reference)
            if (gitStat.isDirectory()) {
                continue;
            }

            // .git is a file - read its content
            const gitContent = await fsPromises.readFile(gitPath, 'utf-8');

            // Parse the gitdir reference
            // Format: "gitdir: /path/to/.git/worktrees/<name>"
            const gitdirMatch = gitContent.match(/^gitdir:\s*(.+)$/m);
            if (!gitdirMatch) {
                continue;
            }

            const metadataPath = gitdirMatch[1].trim();

            // Check if the metadata directory exists
            try {
                await fsPromises.access(metadataPath);
                // Metadata exists - worktree is healthy
            } catch {
                // Metadata doesn't exist - worktree is broken
                brokenWorktrees.push({
                    path: worktreePath,
                    sessionName: entry,
                    expectedBranch: entry // In Claude Lanes, folder name = branch name
                });
            }
        } catch {
            // No .git file or can't read it - not a worktree or already broken differently
            continue;
        }
    }

    return brokenWorktrees;
}

/**
 * Repairs a broken worktree by recreating it while preserving existing files.
 *
 * Strategy:
 * 1. Verify the branch exists
 * 2. Rename the broken worktree directory temporarily
 * 3. Create a fresh worktree at the original path
 * 4. Copy non-.git files from the temp directory to the new worktree
 * 5. Remove the temp directory
 *
 * @param baseRepoPath The path to the base repository
 * @param brokenWorktree The broken worktree to repair
 * @returns Object with success status and optional error message
 */
export async function repairWorktree(
    baseRepoPath: string,
    brokenWorktree: BrokenWorktree
): Promise<{ success: boolean; error?: string }> {
    const { path: worktreePath, expectedBranch } = brokenWorktree;

    // Step 1: Verify the branch exists
    const branchExistsResult = await branchExists(baseRepoPath, expectedBranch);
    if (!branchExistsResult) {
        return {
            success: false,
            error: `Branch '${expectedBranch}' does not exist in the repository`
        };
    }

    // Step 2: Create a temp directory name for the backup
    const tempPath = `${worktreePath}.repair-backup-${Date.now()}`;

    // Step 3: Rename the broken worktree directory
    try {
        await fsPromises.rename(worktreePath, tempPath);
    } catch (err) {
        return {
            success: false,
            error: `Failed to rename worktree for repair: ${getErrorMessage(err)}`
        };
    }

    // Step 4: Create a fresh worktree
    try {
        await execGit(
            ['worktree', 'add', worktreePath, expectedBranch],
            baseRepoPath
        );
    } catch (err) {
        // Try to restore the original directory on failure
        try {
            await fsPromises.rename(tempPath, worktreePath);
        } catch (restoreErr) {
            // Restore failed - include backup location in error message
            return {
                success: false,
                error: `Failed to create worktree: ${getErrorMessage(err)}. ` +
                       `WARNING: Original files backed up at ${tempPath} could not be restored.`
            };
        }
        return {
            success: false,
            error: `Failed to create worktree: ${getErrorMessage(err)}`
        };
    }

    // Step 5: Copy all non-.git files from temp to new worktree
    // We always prefer the user's version to preserve any modifications
    try {
        await copyDirectoryContents(tempPath, worktreePath);
    } catch (err) {
        // Log but don't fail - the worktree is fixed, just some files might not be copied
        console.warn(`Claude Lanes: Failed to copy some files during repair: ${getErrorMessage(err)}`);
    }

    // Step 6: Remove the temp directory
    try {
        await fsPromises.rm(tempPath, { recursive: true, force: true });
    } catch (err) {
        // Log but don't fail - the repair was successful
        console.warn(`Claude Lanes: Failed to clean up temp directory: ${getErrorMessage(err)}`);
    }

    return { success: true };
}

/**
 * Copy contents from source directory to destination, overwriting existing files.
 * Skips the .git file/directory in the source. Used to restore user's files after worktree repair.
 */
async function copyDirectoryContents(src: string, dest: string): Promise<void> {
    const entries = await fsPromises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        // Skip .git file (it was stale anyway)
        if (entry.name === '.git') {
            continue;
        }

        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isSymbolicLink()) {
            // Remove existing and recreate symlink
            try {
                await fsPromises.rm(destPath, { recursive: true, force: true });
            } catch {
                // Destination doesn't exist, that's fine
            }
            const linkTarget = await fsPromises.readlink(srcPath);
            await fsPromises.symlink(linkTarget, destPath);
        } else if (entry.isDirectory()) {
            // Recursively copy directory contents
            await fsPromises.mkdir(destPath, { recursive: true });
            await copyDirectoryContents(srcPath, destPath);
        } else {
            // Copy file, overwriting if exists (preserves user's modifications)
            await fsPromises.copyFile(srcPath, destPath);
            // Preserve file permissions
            const srcStat = await fsPromises.stat(srcPath);
            await fsPromises.chmod(destPath, srcStat.mode);
        }
    }
}

/**
 * Recursively copy a directory, preserving symlinks and file permissions.
 */
async function copyDirectory(src: string, dest: string): Promise<void> {
    await fsPromises.mkdir(dest, { recursive: true });
    const entries = await fsPromises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isSymbolicLink()) {
            // Preserve symbolic links
            const linkTarget = await fsPromises.readlink(srcPath);
            await fsPromises.symlink(linkTarget, destPath);
        } else if (entry.isDirectory()) {
            await copyDirectory(srcPath, destPath);
        } else {
            await fsPromises.copyFile(srcPath, destPath);
            // Preserve file permissions
            const srcStat = await fsPromises.stat(srcPath);
            await fsPromises.chmod(destPath, srcStat.mode);
        }
    }
}

/**
 * Checks for broken worktrees and prompts the user to repair them.
 * Called during extension activation.
 *
 * @param baseRepoPath The path to the base repository
 */
export async function checkAndRepairBrokenWorktrees(baseRepoPath: string): Promise<void> {
    // Step 1: Detect broken worktrees
    const brokenWorktrees = await detectBrokenWorktrees(baseRepoPath);

    // Step 2: Return immediately if none found
    if (brokenWorktrees.length === 0) {
        return;
    }

    // Step 3: Build list of session names for the message
    const sessionNames = brokenWorktrees.map(w => w.sessionName).join(', ');
    const count = brokenWorktrees.length;
    const plural = count > 1 ? 's' : '';

    // Step 4: Show warning message asking user if they want to repair
    const answer = await vscode.window.showWarningMessage(
        `Found ${count} broken worktree${plural}: ${sessionNames}. This can happen after a container rebuild. Would you like to repair them?`,
        'Repair',
        'Ignore'
    );

    if (answer !== 'Repair') {
        return;
    }

    // Step 5: Repair each broken worktree
    let successCount = 0;
    const failures: string[] = [];

    for (const brokenWorktree of brokenWorktrees) {
        const result = await repairWorktree(baseRepoPath, brokenWorktree);
        if (result.success) {
            successCount++;
        } else {
            failures.push(`${brokenWorktree.sessionName}: ${result.error}`);
        }
    }

    // Step 6: Show result message
    if (failures.length === 0) {
        vscode.window.showInformationMessage(
            `Successfully repaired ${successCount} worktree${successCount > 1 ? 's' : ''}.`
        );
    } else if (successCount > 0) {
        vscode.window.showWarningMessage(
            `Repaired ${successCount} worktree${successCount > 1 ? 's' : ''}, but ${failures.length} failed. Check the console for details.`
        );
        console.error('Claude Lanes: Failed to repair some worktrees:', failures);
    } else {
        vscode.window.showErrorMessage(
            `Failed to repair worktrees. Check the console for details.`
        );
        console.error('Claude Lanes: Failed to repair worktrees:', failures);
    }
}


/**
 * Sanitize a session name to be a valid git branch name.
 * Git branch naming rules:
 * - Allowed: letters, numbers, hyphens, underscores, dots, forward slashes
 * - Cannot start with '-', '.', or '/'
 * - Cannot end with '.', '/', or '.lock'
 * - Cannot contain '..' or '//'
 *
 * @param name The raw session name from user input
 * @returns Sanitized name safe for git branches, or empty string if nothing valid remains
 */
export function sanitizeSessionName(name: string): string {
    if (!name) {
        return '';
    }

    let result = name;

    // Step 1: Replace spaces with hyphens
    result = result.replace(/\s+/g, '-');

    // Step 2: Replace invalid characters (not in [a-zA-Z0-9_\-./]) with hyphens
    // This also handles consecutive invalid chars by replacing them all with hyphens
    result = result.replace(/[^a-zA-Z0-9_\-./]+/g, '-');

    // Step 3: Replace consecutive hyphens with single hyphen
    result = result.replace(/-+/g, '-');

    // Step 4: Replace consecutive dots with single dot
    result = result.replace(/\.+/g, '.');

    // Step 5: Replace consecutive slashes with single slash
    result = result.replace(/\/+/g, '/');

    // Step 6: Remove leading hyphens, dots, or slashes
    result = result.replace(/^[-./]+/, '');

    // Step 7: Remove trailing dots or slashes
    result = result.replace(/[./]+$/, '');

    // Step 8: Remove .lock suffix (only at the end)
    if (result.endsWith('.lock')) {
        result = result.slice(0, -5);
    }

    // Step 9: After removing .lock, we might have trailing dots/slashes again
    result = result.replace(/[./]+$/, '');

    // Step 10: Clean up leading chars again (in case .lock removal exposed them)
    result = result.replace(/^[-./]+/, '');

    // Step 11: Remove leading/trailing hyphens that may have been created
    result = result.replace(/^-+/, '').replace(/-+$/, '');

    return result;
}

/**
 * Check if the given path is a git worktree and return the base repo path.
 * Uses `git rev-parse --git-common-dir` to detect worktrees.
 *
 * - In a regular repo, this returns `.git` (relative) or `/path/to/repo/.git`
 * - In a worktree, this returns `/path/to/repo/.git` (the main repo's .git dir)
 *
 * @param workspacePath The current workspace path
 * @returns The base repo path if in a worktree, or the original path if not
 */
export async function getBaseRepoPath(workspacePath: string): Promise<string> {
    try {
        // Get the common git directory (shared across all worktrees)
        const gitCommonDir = await execGit(['rev-parse', '--git-common-dir'], workspacePath);
        const trimmedGitDir = gitCommonDir.trim();

        // If we get just '.git', we're in a regular repo (not a worktree)
        if (trimmedGitDir === '.git') {
            return workspacePath;
        }

        // We're in a worktree - resolve the base repo path
        // gitCommonDir will be an absolute path like:
        // - /path/to/repo/.git (for regular repos when run with absolute paths)
        // - /path/to/repo/.git (for worktrees - always absolute)

        // Resolve to absolute path if relative
        const absoluteGitDir = path.isAbsolute(trimmedGitDir)
            ? trimmedGitDir
            : path.resolve(workspacePath, trimmedGitDir);

        // The base repo is the parent of the .git directory
        // Handle both cases:
        // - /path/to/repo/.git -> /path/to/repo
        // - /path/to/repo/.git/worktrees/branch-name -> (needs to go up to .git, then to repo)

        // Normalize the path to handle any trailing slashes
        const normalizedGitDir = path.normalize(absoluteGitDir);

        // Check if this looks like a worktree git dir (contains /worktrees/)
        if (normalizedGitDir.includes(path.join('.git', 'worktrees'))) {
            // This is the worktree-specific git dir, go up to the main .git
            // e.g., /repo/.git/worktrees/branch -> /repo/.git -> /repo
            const gitDirIndex = normalizedGitDir.indexOf(path.join('.git', 'worktrees'));
            const mainGitDir = normalizedGitDir.substring(0, gitDirIndex + '.git'.length);
            return path.dirname(mainGitDir);
        }

        // Standard case: just get parent of .git
        if (normalizedGitDir.endsWith('.git') || normalizedGitDir.endsWith('.git' + path.sep)) {
            return path.dirname(normalizedGitDir);
        }

        // Fallback: return original path if we can't determine the base
        return workspacePath;

    } catch (err) {
        // Not a git repository or git command failed - return original path
        console.warn('Claude Lanes: getBaseRepoPath failed:', getErrorMessage(err));
        return workspacePath;
    }
}

/**
 * Get the glob pattern for watching a file based on configuration.
 * Security: Validates path to prevent directory traversal in glob patterns.
 * @param configKey The configuration key to read (e.g., 'featuresJsonPath')
 * @param filename The filename to watch (e.g., 'features.json')
 * @returns Glob pattern for watching the file in worktrees
 */
function getWatchPattern(configKey: string, filename: string): string {
    const config = vscode.workspace.getConfiguration('claudeLanes');
    const relativePath = config.get<string>(configKey, '');
    const worktreesFolder = getWorktreesFolder();

    if (relativePath && relativePath.trim()) {
        // Normalize backslashes and remove leading/trailing slashes
        const normalizedPath = relativePath.trim()
            .replace(/\\/g, '/') // Convert Windows backslashes to forward slashes
            .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

        // Security: Reject absolute paths
        if (path.isAbsolute(normalizedPath)) {
            console.warn(`Claude Lanes: Absolute paths not allowed in ${configKey}. Using default.`);
            return `${worktreesFolder}/**/${filename}`;
        }

        // Security: Reject paths with parent directory traversal
        if (normalizedPath.includes('..')) {
            console.warn(`Claude Lanes: Invalid path in ${configKey}: ${normalizedPath}. Using default.`);
            return `${worktreesFolder}/**/${filename}`;
        }

        return `${worktreesFolder}/**/${normalizedPath}/${filename}`;
    }
    return `${worktreesFolder}/**/${filename}`;
}

/**
 * Get the glob pattern for watching features.json based on configuration.
 * Security: Validates path to prevent directory traversal in glob patterns.
 * @returns Glob pattern for watching features.json in worktrees
 */
function getFeaturesWatchPattern(): string {
    return getWatchPattern('featuresJsonPath', 'features.json');
}

/**
 * Get the glob pattern for watching .claude-status based on configuration.
 * Security: Validates path to prevent directory traversal in glob patterns.
 * @returns Glob pattern for watching .claude-status in worktrees
 */
function getStatusWatchPattern(): string {
    return getWatchPattern('claudeStatusPath', '.claude-status');
}

/**
 * Get the glob pattern for watching .claude-session based on configuration.
 * Security: Validates path to prevent directory traversal in glob patterns.
 * @returns Glob pattern for watching .claude-session in worktrees
 */
function getSessionWatchPattern(): string {
    return getWatchPattern('claudeSessionPath', '.claude-session');
}

/**
 * Get the repository name from a path.
 * @param repoPath Path to the repository
 * @returns The repository folder name
 */
export function getRepoName(repoPath: string): string {
    return path.basename(repoPath);
}


export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, "Claude Lanes" is now active!'); // Check Debug Console for this

    // Initialize git path from VS Code Git Extension (with fallback to 'git')
    await initializeGitPath();

    // Initialize Project Manager service with extension context
    initializeProjectManagerService(context);

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    // DEBUG: Check if we found a workspace
    if (!workspaceRoot) {
        console.error("No workspace detected!");
    } else {
        console.log(`Workspace detected: ${workspaceRoot}`);
    }

    // Detect if we're in a worktree and resolve the base repository path
    // This ensures sessions are listed from the main repo even when opened in a worktree
    const baseRepoPath = workspaceRoot ? await getBaseRepoPath(workspaceRoot) : undefined;

    // Track if we're in a worktree - we'll use this to auto-resume session after setup
    const isInWorktree = baseRepoPath && baseRepoPath !== workspaceRoot;

    if (isInWorktree) {
        console.log(`Running in worktree. Base repo: ${baseRepoPath}`);
    }

    // Check for and offer to repair broken worktrees (e.g., after container rebuild)
    if (baseRepoPath) {
        // Run asynchronously to not block extension activation
        checkAndRepairBrokenWorktrees(baseRepoPath).catch(err => {
            console.error('Claude Lanes: Error checking for broken worktrees:', getErrorMessage(err));
        });
    }

    // Initialize global storage context for session file storage
    // This must be done before creating the session provider
    initializeGlobalStorageContext(context.globalStorageUri, baseRepoPath);
    console.log(`Global storage initialized at: ${context.globalStorageUri.fsPath}`);

    // Initialize Tree Data Provider with the base repo path
    // This ensures sessions are always listed from the main repository
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot, baseRepoPath);
    vscode.window.registerTreeDataProvider('claudeSessionsView', sessionProvider);
    context.subscriptions.push(sessionProvider);

    // Initialize Session Form Provider (webview in sidebar)
    const sessionFormProvider = new SessionFormProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SessionFormProvider.viewType,
            sessionFormProvider
        )
    );

    // Handle form submission - creates a new session with optional prompt and acceptance criteria
    // Use baseRepoPath for creating sessions to ensure worktrees are created in the main repo
    sessionFormProvider.setOnSubmit(async (name: string, prompt: string, acceptanceCriteria: string, sourceBranch: string, permissionMode: PermissionMode) => {
        await createSession(name, prompt, acceptanceCriteria, permissionMode, sourceBranch, baseRepoPath, sessionProvider);
    });

    // Watch for .claude-status file changes to refresh the sidebar
    // Use baseRepoPath for file watchers to monitor sessions in the main repo
    const watchPath = baseRepoPath || workspaceRoot;
    if (watchPath) {
        const statusWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, getStatusWatchPattern())
        );

        // Refresh on any status file change
        statusWatcher.onDidChange(() => sessionProvider.refresh());
        statusWatcher.onDidCreate(() => sessionProvider.refresh());
        statusWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(statusWatcher);

        // Also watch for features.json changes to refresh the sidebar
        const featuresWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, getFeaturesWatchPattern())
        );

        featuresWatcher.onDidChange(() => sessionProvider.refresh());
        featuresWatcher.onDidCreate(() => sessionProvider.refresh());
        featuresWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(featuresWatcher);

        // Also watch for .claude-session file changes to refresh the sidebar
        const sessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, getSessionWatchPattern())
        );

        sessionWatcher.onDidChange(() => sessionProvider.refresh());
        sessionWatcher.onDidCreate(() => sessionProvider.refresh());
        sessionWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(sessionWatcher);
    }

    // Watch global storage directory for file changes if global storage is enabled
    if (isGlobalStorageEnabled() && baseRepoPath) {
        const repoIdentifier = getRepoIdentifier(baseRepoPath);
        const globalStoragePath = path.join(context.globalStorageUri.fsPath, repoIdentifier);

        // Ensure the global storage directory exists
        fsPromises.mkdir(globalStoragePath, { recursive: true }).catch(err => {
            console.warn('Claude Lanes: Failed to create global storage directory:', err);
        });

        const globalStorageWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(globalStoragePath, '**/.claude-status')
        );

        globalStorageWatcher.onDidChange(() => sessionProvider.refresh());
        globalStorageWatcher.onDidCreate(() => sessionProvider.refresh());
        globalStorageWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(globalStorageWatcher);

        // Also watch for .claude-session in global storage
        const globalSessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(globalStoragePath, '**/.claude-session')
        );

        globalSessionWatcher.onDidChange(() => sessionProvider.refresh());
        globalSessionWatcher.onDidCreate(() => sessionProvider.refresh());
        globalSessionWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(globalSessionWatcher);
        // Note: features.json and tests.json are NOT stored in global storage
        // as they are development workflow files, not extension-managed session files
    }

    // Listen for configuration changes to update hooks when storage location changes
    // Use a flag to prevent concurrent execution during async operations
    let isUpdatingStorageConfig = false;
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('claudeLanes.useGlobalStorage')) {
            // Prevent concurrent execution
            if (isUpdatingStorageConfig) {
                return;
            }
            isUpdatingStorageConfig = true;

            try {
                // Notify user about the change
                const useGlobal = isGlobalStorageEnabled();
                const message = useGlobal
                    ? 'Claude Lanes: Global storage enabled. New sessions will use global storage for tracking files.'
                    : 'Claude Lanes: Global storage disabled. New sessions will use worktree directories for tracking files.';
                vscode.window.showInformationMessage(message);

                // Offer to update existing worktrees
                if (baseRepoPath) {
                    const worktreesDir = path.join(baseRepoPath, getWorktreesFolder());
                    if (fs.existsSync(worktreesDir)) {
                        const updateExisting = await vscode.window.showQuickPick(
                            [
                                { label: 'Yes', description: 'Update hooks in all existing worktrees' },
                                { label: 'No', description: 'Only apply to new sessions' }
                            ],
                            {
                                placeHolder: 'Would you like to update hooks in existing worktrees?',
                                title: 'Update Existing Sessions'
                            }
                        );

                        if (updateExisting?.label === 'Yes') {
                            try {
                                const worktrees = fs.readdirSync(worktreesDir);
                                let updated = 0;
                                for (const worktree of worktrees) {
                                    const worktreePath = path.join(worktreesDir, worktree);
                                    if (fs.statSync(worktreePath).isDirectory()) {
                                        await getOrCreateExtensionSettingsFile(worktreePath);
                                        updated++;
                                    }
                                }
                                vscode.window.showInformationMessage(`Updated settings files in ${updated} worktree(s).`);
                            } catch (err) {
                                vscode.window.showErrorMessage(`Failed to update some worktrees: ${getErrorMessage(err)}`);
                            }
                        }
                    }
                }

                // Refresh the session provider to reflect any changes
                sessionProvider.refresh();
            } finally {
                isUpdatingStorageConfig = false;
            }
        }
    });

    context.subscriptions.push(configChangeDisposable);

    // 2. Register CREATE Command (for command palette / keybinding usage)
    let createDisposable = vscode.commands.registerCommand('claudeWorktrees.createSession', async () => {
        console.log("Create Session Command Triggered!");

        // Get session name via input box
        const name = await vscode.window.showInputBox({
            prompt: "Session Name (creates new branch)",
            placeHolder: "fix-login"
        });

        if (!name) {
            vscode.window.showInformationMessage("Creation cancelled");
            return;
        }

        // Use the shared createSession function (no prompt, acceptance criteria, or source branch when using command palette)
        // Use baseRepoPath to create sessions in the main repo even when in a worktree
        await createSession(name, '', '', 'default', '', baseRepoPath, sessionProvider);
    });

    // 3. Register OPEN/RESUME Command
    let openDisposable = vscode.commands.registerCommand('claudeWorktrees.openSession', async (item: SessionItem) => {
        await openClaudeTerminal(item.label, item.worktreePath);
    });

    // ---------------------------------------------------------
    // 4. INSERT DELETE COMMAND HERE (New Code)
    // ---------------------------------------------------------
    let deleteDisposable = vscode.commands.registerCommand('claudeWorktrees.deleteSession', async (item: SessionItem) => {
        
        // A. Confirm with user
        const answer = await vscode.window.showWarningMessage(
            `Delete session '${item.label}'?`, 
            { modal: true }, 
            "Delete"
        );
        if (answer !== "Delete") {
            return;
        }

        try {
            // B. Kill Terminal
            const termName = `Claude: ${item.label}`;
            const terminal = vscode.window.terminals.find(t => t.name === termName);
            if (terminal) {
                terminal.dispose();
            }

            // C. Remove from Project Manager
            await removeProject(item.worktreePath);

            // D. Remove Worktree
            // Use baseRepoPath to ensure git worktree command works from the main repo
            if (baseRepoPath) {
                // --force is required if the worktree is not clean, but usually safe for temp agent work
                await execGit(['worktree', 'remove', item.worktreePath, '--force'], baseRepoPath);
            }

            // E. Clean up global storage files if global storage is enabled
            if (isGlobalStorageEnabled()) {
                const globalStoragePath = getGlobalStoragePath(item.worktreePath, '.claude-status');
                if (globalStoragePath) {
                    const sessionStorageDir = path.dirname(globalStoragePath);
                    await fsPromises.rm(sessionStorageDir, { recursive: true, force: true }).catch(() => {
                        // Ignore errors - files may not exist
                    });
                }
            }

            // F. Refresh List
            sessionProvider.refresh();
            vscode.window.showInformationMessage(`Deleted session: ${item.label}`);

        } catch (err) {
            vscode.window.showErrorMessage(`Failed to delete: ${getErrorMessage(err)}`);
        }
    });

    // 5. Register SETUP STATUS HOOKS Command
    // This command regenerates the extension settings file with hooks
    let setupHooksDisposable = vscode.commands.registerCommand('claudeWorktrees.setupStatusHooks', async (item?: SessionItem) => {
        if (!item) {
            vscode.window.showErrorMessage('Please right-click on a session to setup status hooks.');
            return;
        }
        try {
            const settingsPath = await getOrCreateExtensionSettingsFile(item.worktreePath);
            vscode.window.showInformationMessage(`Status hooks configured for '${item.label}' at ${settingsPath}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to setup hooks: ${getErrorMessage(err)}`);
        }
    });

    // 6. Register SHOW GIT CHANGES Command
    // Helper function to generate diff content for a worktree
    async function generateDiffContent(worktreePath: string, baseBranch: string): Promise<string> {
        // Check if we should include uncommitted changes
        const config = vscode.workspace.getConfiguration('claudeLanes');
        const includeUncommitted = config.get<boolean>('includeUncommittedChanges', true);

        // Get the diff - either including working directory changes or only committed changes
        const diffArgs = includeUncommitted
            ? ['diff', baseBranch]  // Compare base branch to working directory
            : ['diff', `${baseBranch}...HEAD`];  // Compare base branch to HEAD (committed only)
        let diffContent = await execGit(diffArgs, worktreePath);

        // If including uncommitted changes, also get untracked files
        if (includeUncommitted) {
            try {
                // git status --porcelain respects .gitignore by default
                const statusOutput = await execGit(['status', '--porcelain'], worktreePath);
                const untrackedFiles = parseUntrackedFiles(statusOutput);

                // Process each untracked file
                const untrackedDiffs: string[] = [];
                for (const filePath of untrackedFiles) {
                    try {
                        const fullPath = path.join(worktreePath, filePath);

                        // Skip directories (git status can list directories with trailing /)
                        if (filePath.endsWith('/')) {
                            continue;
                        }

                        // Check if it's a file (not a directory) and not too large
                        const stat = await fsPromises.stat(fullPath);
                        if (!stat.isFile()) {
                            continue;
                        }

                        // Skip very large files to avoid memory issues (5MB limit)
                        const MAX_FILE_SIZE = 5 * 1024 * 1024;
                        if (stat.size > MAX_FILE_SIZE) {
                            untrackedDiffs.push([
                                `diff --git a/${filePath} b/${filePath}`,
                                'new file mode 100644',
                                `File too large (${Math.round(stat.size / 1024 / 1024)}MB)`
                            ].join('\n'));
                            continue;
                        }

                        // Read file content
                        const content = await fsPromises.readFile(fullPath, 'utf-8');

                        // Skip binary files
                        if (isBinaryContent(content)) {
                            // Add a placeholder for binary files
                            untrackedDiffs.push([
                                `diff --git a/${filePath} b/${filePath}`,
                                'new file mode 100644',
                                'Binary file'
                            ].join('\n'));
                            continue;
                        }

                        // Synthesize diff for the untracked file
                        const synthesizedDiff = synthesizeUntrackedFileDiff(filePath, content);
                        untrackedDiffs.push(synthesizedDiff);
                    } catch (fileErr) {
                        // Skip files that can't be read (permissions, etc.)
                        console.warn(`Claude Lanes: Could not read untracked file ${filePath}:`, getErrorMessage(fileErr));
                    }
                }

                // Append untracked file diffs to the main diff
                if (untrackedDiffs.length > 0) {
                    if (diffContent && diffContent.trim() !== '') {
                        diffContent = diffContent + '\n' + untrackedDiffs.join('\n');
                    } else {
                        diffContent = untrackedDiffs.join('\n');
                    }
                }
            } catch (statusErr) {
                // If git status fails, continue with just the diff
                console.warn('Claude Lanes: Could not get untracked files:', getErrorMessage(statusErr));
            }
        }

        return diffContent;
    }

    // Register the branch change callback for GitChangesPanel
    // This handles when users change the base branch in the diff viewer
    GitChangesPanel.setOnBranchChange(async (branchName: string, worktreePath: string) => {
        try {
            // Validate the branch exists (check local branches, remote branches, and tags)
            let actualBranch = branchName.trim();
            const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

            // Validate branch name format to prevent issues
            if (!branchNameRegex.test(actualBranch)) {
                vscode.window.showWarningMessage(`Invalid branch name format: '${branchName}'. Using default base branch.`);
                actualBranch = await getBaseBranch(worktreePath);
            } else {
                // Check if the branch/ref exists
                let refExists = false;

                // Check local branch
                try {
                    await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${actualBranch}`], worktreePath);
                    refExists = true;
                } catch {
                    // Not a local branch
                }

                // Check remote branch (exact match)
                if (!refExists) {
                    try {
                        await execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${actualBranch}`], worktreePath);
                        refExists = true;
                    } catch {
                        // Not a remote branch
                    }
                }

                // Check if it's a valid ref (commit, tag, etc.)
                if (!refExists) {
                    try {
                        await execGit(['rev-parse', '--verify', `${actualBranch}^{commit}`], worktreePath);
                        refExists = true;
                    } catch {
                        // Not a valid ref
                    }
                }

                if (!refExists) {
                    vscode.window.showWarningMessage(`Branch '${branchName}' not found. Using default base branch.`);
                    actualBranch = await getBaseBranch(worktreePath);
                }
            }

            // Generate new diff content
            const diffContent = await generateDiffContent(worktreePath, actualBranch);

            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage('No changes when comparing to this branch.');
                return { diffContent: '', baseBranch: actualBranch };
            }

            return { diffContent, baseBranch: actualBranch };
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to change branch: ${getErrorMessage(err)}`);
            return null;
        }
    });

    let showGitChangesDisposable = vscode.commands.registerCommand('claudeWorktrees.showGitChanges', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to view git changes.');
            return;
        }

        // Verify the worktree path exists
        if (!fs.existsSync(item.worktreePath)) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        try {
            // Determine the base branch (main or master)
            const baseBranch = await getBaseBranch(item.worktreePath);

            // Generate the diff content
            const diffContent = await generateDiffContent(item.worktreePath, baseBranch);

            // Check if there are any changes
            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage('No changes in this session');
                return;
            }

            // Open the GitChangesPanel with the diff content, worktree path, and base branch
            GitChangesPanel.createOrShow(context.extensionUri, item.label, diffContent, item.worktreePath, baseBranch);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to get git changes: ${getErrorMessage(err)}`);
        }
    });

    // 7. Register OPEN IN NEW WINDOW Command
    let openWindowDisposable = vscode.commands.registerCommand('claudeWorktrees.openInNewWindow', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please click on a session to open in new window.');
            return;
        }

        // Verify the worktree path exists
        if (!fs.existsSync(item.worktreePath)) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        // Check if there's an active terminal for this session
        const terminalName = `Claude: ${item.label}`;
        const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);

        if (existingTerminal) {
            // Session has an active terminal - ask user what to do
            const choice = await vscode.window.showQuickPick(
                [
                    {
                        label: 'Transfer session',
                        description: 'Close the terminal here and resume in the new window',
                        action: 'transfer'
                    },
                    {
                        label: 'Open anyway',
                        description: 'Open new window without closing terminal (session will conflict)',
                        action: 'open'
                    }
                ],
                {
                    placeHolder: 'This session has an active Claude terminal. What would you like to do?',
                    title: 'Active Session Detected'
                }
            );

            if (!choice) {
                // User cancelled
                return;
            }

            if (choice.action === 'transfer') {
                // Close the terminal before opening new window
                existingTerminal.dispose();
                // Brief delay to ensure terminal is closed
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            // If 'open', just continue without closing the terminal
        }

        try {
            // Ensure the project is saved in Project Manager before opening
            // This handles the edge case where a session was created before Project Manager integration
            if (baseRepoPath) {
                // Get sanitized repo name for project naming
                const repoName = getRepoName(baseRepoPath).replace(/[<>:"/\\|?*]/g, '_');
                const projectName = `${repoName}-${item.label}`;
                await addProject(projectName, item.worktreePath, ['claude-lanes']);
            }

            // Open the folder in a new VS Code window
            // The second parameter 'true' opens in a new window
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(item.worktreePath), true);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open in new window: ${getErrorMessage(err)}`);
        }
    });

    context.subscriptions.push(createDisposable);
    context.subscriptions.push(openDisposable);
    context.subscriptions.push(deleteDisposable);
    context.subscriptions.push(setupHooksDisposable);
    context.subscriptions.push(showGitChangesDisposable);
    context.subscriptions.push(openWindowDisposable);

    // Auto-resume Claude session when opened in a worktree with an existing session
    if (isInWorktree && workspaceRoot) {
        const sessionData = getSessionId(workspaceRoot);
        if (sessionData?.sessionId) {
            const sessionName = path.basename(workspaceRoot);
            // Brief delay to ensure VS Code is fully ready
            setTimeout(() => {
                openClaudeTerminal(sessionName, workspaceRoot);
            }, 500);
        }
    }
}

/**
 * Creates a new Claude session with optional starting prompt and acceptance criteria.
 * Shared logic between the form-based UI and the command palette.
 * Uses iterative approach to handle name conflicts instead of recursion.
 *
 * @param name Session name (used as branch name)
 * @param prompt Optional starting prompt for Claude
 * @param acceptanceCriteria Optional acceptance criteria for Claude
 * @param sourceBranch Optional source branch to create worktree from (empty = use default behavior)
 * @param workspaceRoot The workspace root path
 * @param sessionProvider The session provider for refreshing the UI
 */
async function createSession(
    name: string,
    prompt: string,
    acceptanceCriteria: string,
    permissionMode: PermissionMode,
    sourceBranch: string,
    workspaceRoot: string | undefined,
    sessionProvider: ClaudeSessionProvider
): Promise<void> {
    console.log("Create Session triggered!");

    // 1. Check Workspace
    if (!workspaceRoot) {
        const errorMsg = "Error: You must open a folder/workspace first!";
        vscode.window.showErrorMessage(errorMsg);
        throw new Error(errorMsg);
    }

    // 3. Check Git Status (do this once before the loop)
    const isGit = fs.existsSync(path.join(workspaceRoot, '.git'));
    if (!isGit) {
        const errorMsg = "Error: Current folder is not a git repository. Run 'git init' first.";
        vscode.window.showErrorMessage(errorMsg);
        throw new Error(errorMsg);
    }

    // Use iterative approach to handle name conflicts
    let currentName = name;
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

    while (true) {
        // 2. Validate name exists
        if (!currentName || !currentName.trim()) {
            const errorMsg = "Error: Session name is required!";
            vscode.window.showErrorMessage(errorMsg);
            throw new Error(errorMsg);
        }

        // 2a. Sanitize the name to make it git-safe
        const sanitizedName = sanitizeSessionName(currentName);

        // 2b. Check if sanitization resulted in an empty string
        if (!sanitizedName) {
            const errorMsg = "Error: Session name contains no valid characters. Use letters, numbers, hyphens, underscores, dots, or slashes.";
            vscode.window.showErrorMessage(errorMsg);
            throw new Error(errorMsg);
        }

        const trimmedName = sanitizedName;

        // 2c. Validate branch name characters (git-safe) - should pass after sanitization
        if (!branchNameRegex.test(trimmedName)) {
            const errorMsg = "Error: Session name contains invalid characters. Use only letters, numbers, hyphens, underscores, dots, or slashes.";
            vscode.window.showErrorMessage(errorMsg);
            throw new Error(errorMsg);
        }

        // 2d. Prevent names that could cause git issues - should pass after sanitization
        if (trimmedName.startsWith('-') || trimmedName.startsWith('.') ||
            trimmedName.endsWith('.') || trimmedName.includes('..') ||
            trimmedName.endsWith('.lock')) {
            const errorMsg = "Error: Session name cannot start with '-' or '.', end with '.' or '.lock', or contain '..'";
            vscode.window.showErrorMessage(errorMsg);
            throw new Error(errorMsg);
        }

        const worktreePath = path.join(workspaceRoot, getWorktreesFolder(), trimmedName);
        console.log(`Target path: ${worktreePath}`);

        try {
            // 4. Create Worktree
            vscode.window.showInformationMessage(`Creating session '${trimmedName}'...`);

            await ensureWorktreeDirExists(workspaceRoot);

            // Check if the branch already exists
            const branchAlreadyExists = await branchExists(workspaceRoot, trimmedName);

            if (branchAlreadyExists) {
                // Check if the branch is already in use by another worktree
                const branchesInUse = await getBranchesInWorktrees(workspaceRoot);

                if (branchesInUse.has(trimmedName)) {
                    // Branch is already checked out in another worktree - cannot use it
                    const errorMsg = `Branch '${trimmedName}' is already checked out in another worktree. ` +
                        `Git does not allow the same branch to be checked out in multiple worktrees.`;
                    vscode.window.showErrorMessage(errorMsg);
                    throw new Error(errorMsg);
                }

                // Branch exists but is not in use - prompt user for action
                const choice = await vscode.window.showQuickPick(
                    [
                        {
                            label: 'Use existing branch',
                            description: `Create worktree using the existing '${trimmedName}' branch`,
                            action: 'use-existing'
                        },
                        {
                            label: 'Enter new name',
                            description: 'Choose a different session name',
                            action: 'new-name'
                        }
                    ],
                    {
                        placeHolder: `Branch '${trimmedName}' already exists. What would you like to do?`,
                        title: 'Branch Already Exists'
                    }
                );

                if (!choice) {
                    // User cancelled
                    vscode.window.showInformationMessage('Session creation cancelled.');
                    return;
                }

                if (choice.action === 'new-name') {
                    // Prompt for new name and continue the loop
                    const newName = await vscode.window.showInputBox({
                        prompt: "Enter a new session name (creates new branch)",
                        placeHolder: "fix-login-v2",
                        validateInput: (value) => {
                            if (!value || !value.trim()) {
                                return 'Session name is required';
                            }
                            const trimmed = value.trim();
                            if (!branchNameRegex.test(trimmed)) {
                                return 'Use only letters, numbers, hyphens, underscores, dots, or slashes';
                            }
                            // Prevent names that could cause git issues
                            if (trimmed.startsWith('-') || trimmed.startsWith('.') ||
                                trimmed.endsWith('.') || trimmed.includes('..') ||
                                trimmed.endsWith('.lock')) {
                                return "Name cannot start with '-' or '.', end with '.' or '.lock', or contain '..'";
                            }
                            return null;
                        }
                    });

                    if (!newName) {
                        vscode.window.showInformationMessage('Session creation cancelled.');
                        return;
                    }

                    // Update currentName and continue the loop (iterative instead of recursive)
                    currentName = newName;
                    continue;
                }

                // User chose to use existing branch - create worktree without -b flag
                console.log(`Running: git worktree add "${worktreePath}" "${trimmedName}"`);
                await execGit(['worktree', 'add', worktreePath, trimmedName], workspaceRoot);
            } else {
                // Branch doesn't exist - create new branch
                // If sourceBranch is provided, use it as the starting point
                const trimmedSourceBranch = sourceBranch.trim();
                if (trimmedSourceBranch) {
                    // Validate branch name format before checking existence
                    if (!branchNameRegex.test(trimmedSourceBranch)) {
                        const errorMsg = "Error: Source branch name contains invalid characters. Use only letters, numbers, hyphens, underscores, dots, or slashes.";
                        vscode.window.showErrorMessage(errorMsg);
                        throw new Error(errorMsg);
                    }

                    // Verify the source branch exists before using it
                    const sourceBranchExists = await branchExists(workspaceRoot, trimmedSourceBranch);
                    // Also check for remote branches (origin/branch-name format)
                    let remoteSourceExists = false;
                    if (!sourceBranchExists) {
                        try {
                            await execGit(['show-ref', '--verify', '--quiet', `refs/remotes/${trimmedSourceBranch}`], workspaceRoot);
                            remoteSourceExists = true;
                        } catch {
                            // Remote doesn't exist either
                        }
                    }

                    if (!sourceBranchExists && !remoteSourceExists) {
                        const errorMsg = `Source branch '${trimmedSourceBranch}' does not exist.`;
                        vscode.window.showErrorMessage(errorMsg);
                        throw new Error(errorMsg);
                    }

                    console.log(`Running: git worktree add "${worktreePath}" -b "${trimmedName}" "${trimmedSourceBranch}"`);
                    await execGit(['worktree', 'add', worktreePath, '-b', trimmedName, trimmedSourceBranch], workspaceRoot);
                } else {
                    // No source branch specified - use HEAD as starting point (default behavior)
                    console.log(`Running: git worktree add "${worktreePath}" -b "${trimmedName}"`);
                    await execGit(['worktree', 'add', worktreePath, '-b', trimmedName], workspaceRoot);
                }
            }

            // 5. Add worktree as a project in Project Manager
            // Get sanitized repo name for project naming
            const repoName = getRepoName(workspaceRoot).replace(/[<>:"/\\|?*]/g, '_');
            const projectName = `${repoName}-${trimmedName}`;
            await addProject(projectName, worktreePath, ['claude-lanes']);

            // 6. Success
            sessionProvider.refresh();
            await openClaudeTerminal(trimmedName, worktreePath, prompt, acceptanceCriteria, permissionMode);
            vscode.window.showInformationMessage(`Session '${trimmedName}' Ready!`);

            // Exit the loop on success
            return;

        } catch (err) {
            console.error(err);
            const errorMsg = `Git Error: ${getErrorMessage(err)}`;
            vscode.window.showErrorMessage(errorMsg);
            throw new Error(errorMsg);
        }
    }
}

/**
 * Combines prompt and acceptance criteria into a single formatted string.
 * - If both are provided: "request: [prompt]\nacceptance criteria: [criteria]"
 * - If only one is provided: use that value as-is
 * - If neither is provided: returns empty string
 */
export function combinePromptAndCriteria(prompt?: string, acceptanceCriteria?: string): string {
    const trimmedPrompt = prompt?.trim() || '';
    const trimmedCriteria = acceptanceCriteria?.trim() || '';

    if (trimmedPrompt && trimmedCriteria) {
        return `request: ${trimmedPrompt}\nacceptance criteria: ${trimmedCriteria}`;
    } else if (trimmedPrompt) {
        return trimmedPrompt;
    } else if (trimmedCriteria) {
        return trimmedCriteria;
    }
    return '';
}

// THE CORE FUNCTION: Manages the Terminal Tabs
async function openClaudeTerminal(taskName: string, worktreePath: string, prompt?: string, acceptanceCriteria?: string, permissionMode?: PermissionMode): Promise<void> {
    const terminalName = `Claude: ${taskName}`;

    // A. Check if this terminal already exists to avoid duplicates
    const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);

    if (existingTerminal) {
        // Just bring it to the front!
        existingTerminal.show();
        // If we have a prompt and we're reopening an existing terminal,
        // we don't want to send the prompt again as it would interrupt
        return;
    }

    // B. Create a Brand New Terminal Tab
    const terminal = vscode.window.createTerminal({
        name: terminalName,      // <--- This sets the tab name in the UI
        cwd: worktreePath,       // <--- Starts shell directly inside the isolated worktree
        iconPath: new vscode.ThemeIcon('robot'), // Gives it a cool robot icon
        color: new vscode.ThemeColor('terminal.ansiGreen') // Optional: Color code the tab
    });

    terminal.show();

    // C. Get or create the extension settings file with hooks
    let settingsFlag = '';
    try {
        const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);
        settingsFlag = `--settings "${settingsPath}" `;
    } catch (err) {
        console.warn('Claude Lanes: Failed to create extension settings file:', getErrorMessage(err));
        // Continue without the settings flag - hooks won't work but Claude will still run
    }

    // D. Auto-start Claude - resume if session ID exists, otherwise start fresh
    const sessionData = getSessionId(worktreePath);
    if (sessionData?.sessionId) {
        // Resume existing session
        terminal.sendText(`claude ${settingsFlag}--resume ${sessionData.sessionId}`.trim());
    } else {
        // Build the permission mode flag if not using default
        // Validate permissionMode to prevent command injection from untrusted webview input
        const validatedMode = isValidPermissionMode(permissionMode) ? permissionMode : 'default';
        const permissionFlag = validatedMode !== 'default'
            ? `--permission-mode ${validatedMode} `
            : '';

        // Combine prompt and acceptance criteria
        const combinedPrompt = combinePromptAndCriteria(prompt, acceptanceCriteria);
        if (combinedPrompt) {
            // Write prompt to file for history and to avoid terminal buffer issues
            // Location depends on settings:
            // - Default (empty promptsFolder): global storage at globalStorageUri/<repoIdentifier>/prompts/<sessionName>.txt
            // - User override: repo-relative at <repoRoot>/<promptsFolder>/<sessionName>.txt
            // Derive repo root from worktree path: <repo>/<worktreesFolder>/<session-name>
            const repoRoot = path.dirname(path.dirname(worktreePath));
            const promptPathInfo = getPromptsPath(taskName, repoRoot);
            if (promptPathInfo) {
                await fsPromises.mkdir(promptPathInfo.needsDir, { recursive: true });
                await fsPromises.writeFile(promptPathInfo.path, combinedPrompt, 'utf-8');
                // Pass prompt file content as argument using command substitution
                terminal.sendText(`claude ${settingsFlag}${permissionFlag}"$(cat "${promptPathInfo.path}")"`);
            } else {
                // Fallback: pass prompt directly if path resolution failed
                // Escape single quotes in the prompt for shell safety
                const escapedPrompt = combinedPrompt.replace(/'/g, "'\\''");
                terminal.sendText(`claude ${settingsFlag}${permissionFlag}'${escapedPrompt}'`);
            }
        } else {
            // Start new session without prompt
            terminal.sendText(`claude ${settingsFlag}${permissionFlag}`.trim());
        }
    }
}

/**
 * Check if a branch exists in the git repository.
 * @param cwd The working directory (git repo root)
 * @param branchName The name of the branch to check
 * @returns true if the branch exists, false otherwise
 * @note Returns false for invalid branch names or on any git command failure
 */
export async function branchExists(cwd: string, branchName: string): Promise<boolean> {
    // Validate branch name to prevent issues
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
    if (!branchNameRegex.test(branchName)) {
        return false;
    }
    try {
        await execGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], cwd);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get a set of branch names that are currently checked out in worktrees.
 * Parses the output of `git worktree list --porcelain`.
 * @param cwd The working directory (git repo root)
 * @returns A Set of branch names currently in use by worktrees
 */
export async function getBranchesInWorktrees(cwd: string): Promise<Set<string>> {
    const branches = new Set<string>();
    try {
        const output = await execGit(['worktree', 'list', '--porcelain'], cwd);
        // Parse the porcelain output - each worktree is separated by blank lines
        // and branch info is in "branch refs/heads/<branch-name>" format
        const lines = output.split('\n');
        for (const line of lines) {
            if (line.startsWith('branch refs/heads/')) {
                const branchName = line.replace('branch refs/heads/', '').trim();
                if (branchName) {
                    branches.add(branchName);
                }
            }
        }
    } catch (error) {
        // Log error for debugging but return empty set to allow graceful degradation
        console.warn('Failed to get worktree branches:', error);
    }
    return branches;
}

async function ensureWorktreeDirExists(root: string): Promise<void> {
    const dir = path.join(root, getWorktreesFolder());
    try {
        await fsPromises.access(dir);
    } catch {
        await fsPromises.mkdir(dir, { recursive: true });
    }
}

/**
 * Interface for Claude settings.json structure
 */
interface ClaudeSettings {
    hooks?: {
        SessionStart?: HookEntry[];
        Stop?: HookEntry[];
        UserPromptSubmit?: HookEntry[];
        Notification?: HookEntry[];
        PreToolUse?: HookEntry[];
        [key: string]: HookEntry[] | undefined;
    };
    [key: string]: unknown;
}

interface HookEntry {
    matcher?: string;
    hooks: { type: string; command: string }[];
}

/**
 * Get the relative path for status/session files based on configuration.
 * Returns an empty string if the path is at the root, otherwise returns the path with a trailing slash.
 * @param configKey The configuration key to read
 * @returns The relative path prefix for the file (empty string or 'path/')
 */
function getRelativeFilePath(configKey: string): string {
    const config = vscode.workspace.getConfiguration('claudeLanes');
    const relativePath = config.get<string>(configKey, '');

    if (!relativePath || !relativePath.trim()) {
        return '';
    }

    const trimmedPath = relativePath.trim()
        .replace(/\\/g, '/') // Normalize backslashes to forward slashes
        .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

    // Security: Reject paths with parent directory traversal
    if (trimmedPath.includes('..')) {
        console.warn(`Claude Lanes: Invalid path in ${configKey}: ${trimmedPath}. Using default.`);
        return '';
    }

    return trimmedPath + '/';
}

/**
 * Creates or updates the extension settings file in global storage.
 * This file contains hooks for status tracking and session ID capture.
 * The file is stored at: globalStorageUri/<repo-identifier>/<session-name>/claude-settings.json
 *
 * @param worktreePath Path to the worktree
 * @returns The absolute path to the settings file
 */
export async function getOrCreateExtensionSettingsFile(worktreePath: string): Promise<string> {
    // Get the session name from the worktree path
    const sessionName = getSessionNameFromWorktree(worktreePath);

    // Validate session name to prevent path traversal and command injection
    // Session names should only contain [a-zA-Z0-9_\-./] (enforced by sanitizeSessionName at creation)
    if (!sessionName || sessionName.includes('..') || !/^[a-zA-Z0-9_\-./]+$/.test(sessionName)) {
        throw new Error(`Invalid session name derived from worktree path: ${sessionName}`);
    }

    const globalStorageUriObj = getGlobalStorageUri();
    const baseRepoPath = getBaseRepoPathForStorage();

    if (!globalStorageUriObj || !baseRepoPath) {
        throw new Error('Global storage not initialized. Cannot create extension settings file.');
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPath);
    const settingsDir = path.join(globalStorageUriObj.fsPath, repoIdentifier, sessionName);
    const settingsFilePath = path.join(settingsDir, 'claude-settings.json');

    // Ensure the directory exists
    await fsPromises.mkdir(settingsDir, { recursive: true });

    // Determine status and session file paths
    const useGlobalStorage = isGlobalStorageEnabled();
    let statusFilePath: string;
    let sessionFilePath: string;

    if (useGlobalStorage) {
        // Use absolute paths to global storage
        const globalStatusPath = getGlobalStoragePath(worktreePath, '.claude-status');
        const globalSessionPath = getGlobalStoragePath(worktreePath, '.claude-session');

        if (globalStatusPath && globalSessionPath) {
            statusFilePath = globalStatusPath;
            sessionFilePath = globalSessionPath;

            // Ensure the global storage directory exists (both files are in same directory)
            await fsPromises.mkdir(path.dirname(globalStatusPath), { recursive: true });
        } else {
            // Fall back to relative paths if global storage not initialized
            const statusRelPath = getRelativeFilePath('claudeStatusPath');
            const sessionRelPath = getRelativeFilePath('claudeSessionPath');
            statusFilePath = `${statusRelPath}.claude-status`;
            sessionFilePath = `${sessionRelPath}.claude-session`;
        }
    } else {
        // Use relative paths within the worktree
        const statusRelPath = getRelativeFilePath('claudeStatusPath');
        const sessionRelPath = getRelativeFilePath('claudeSessionPath');
        statusFilePath = `${statusRelPath}.claude-status`;
        sessionFilePath = `${sessionRelPath}.claude-session`;

        // Ensure status file directory exists if configured
        if (statusRelPath) {
            const statusDir = path.join(worktreePath, statusRelPath.replace(/\/$/, ''));
            await fsPromises.mkdir(statusDir, { recursive: true });
        }

        // Ensure session file directory exists if configured
        if (sessionRelPath) {
            const sessionDir = path.join(worktreePath, sessionRelPath.replace(/\/$/, ''));
            await fsPromises.mkdir(sessionDir, { recursive: true });
        }
    }

    // Define the hooks
    const statusWriteWaiting = {
        type: 'command',
        command: `echo '{"status":"waiting_for_user"}' > "${statusFilePath}"`
    };

    const statusWriteWorking = {
        type: 'command',
        command: `echo '{"status":"working"}' > "${statusFilePath}"`
    };

    // Session ID is provided via stdin as JSON: {"session_id": "...", ...}
    const sessionIdCapture = {
        type: 'command',
        command: `jq -r --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{sessionId: .session_id, timestamp: $ts}' > "${sessionFilePath}"`
    };

    // Build the settings object
    const settings: ClaudeSettings = {
        hooks: {
            SessionStart: [{ hooks: [sessionIdCapture] }],
            Stop: [{ hooks: [statusWriteWaiting] }],
            UserPromptSubmit: [{ hooks: [statusWriteWorking] }],
            Notification: [{ matcher: 'permission_prompt', hooks: [statusWriteWaiting] }],
            PreToolUse: [{ matcher: '.*', hooks: [statusWriteWorking] }]
        }
    };

    // Write the settings file atomically with cleanup on failure
    const tempPath = path.join(settingsDir, `claude-settings.json.${Date.now()}.tmp`);
    try {
        await fsPromises.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
        await fsPromises.rename(tempPath, settingsFilePath);
    } catch (err) {
        // Clean up temp file on failure
        await fsPromises.unlink(tempPath).catch(() => {});
        throw err;
    }

    return settingsFilePath;
}

/**
 * Parse untracked files from git status --porcelain output.
 * Untracked files are indicated by '??' prefix.
 * @param statusOutput The raw output from git status --porcelain
 * @returns Array of file paths for untracked files
 */
export function parseUntrackedFiles(statusOutput: string): string[] {
    const files: string[] = [];
    const lines = statusOutput.split('\n');

    for (const line of lines) {
        // Untracked files start with '?? '
        if (line.startsWith('?? ')) {
            // Extract the file path (everything after '?? ')
            const filePath = line.substring(3).trim();
            // Handle quoted paths (git uses C-style escaping for paths with special characters)
            const unquotedPath = filePath.startsWith('"') && filePath.endsWith('"')
                ? filePath.slice(1, -1)
                    .replace(/\\"/g, '"')
                    .replace(/\\n/g, '\n')
                    .replace(/\\t/g, '\t')
                    .replace(/\\\\/g, '\\')  // Must be last to avoid double-unescaping
                : filePath;
            if (unquotedPath) {
                files.push(unquotedPath);
            }
        }
    }

    return files;
}

/**
 * Check if content appears to be binary (contains null bytes).
 * @param content The string content to check
 * @returns true if the content appears to be binary
 */
export function isBinaryContent(content: string): boolean {
    // Check for null bytes which indicate binary content
    return content.includes('\0');
}

/**
 * Synthesize a unified diff format entry for an untracked (new) file.
 * @param filePath The path to the file (relative to repo root)
 * @param content The file content
 * @returns A string in unified diff format representing a new file
 */
export function synthesizeUntrackedFileDiff(filePath: string, content: string): string {
    const lines = content.split('\n');

    // Handle empty files
    if (content === '' || (lines.length === 1 && lines[0] === '')) {
        return [
            `diff --git a/${filePath} b/${filePath}`,
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${filePath}`,
            ''
        ].join('\n');
    }

    // Handle files that don't end with a newline
    const hasTrailingNewline = content.endsWith('\n');
    const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
    const lineCount = contentLines.length;

    const diffLines = [
        `diff --git a/${filePath} b/${filePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${lineCount} @@`
    ];

    // Add each line with a '+' prefix
    for (const line of contentLines) {
        diffLines.push(`+${line}`);
    }

    // Add marker for missing newline at end of file
    if (!hasTrailingNewline) {
        diffLines.push('\\ No newline at end of file');
    }

    return diffLines.join('\n');
}

/**
 * Determines the base branch for comparing changes.
 * First checks the claudeLanes.baseBranch setting.
 * If not set, checks in order: origin/main, origin/master, main, master.
 * @param cwd The working directory (git repo or worktree)
 * @returns The name of the base branch to use for comparisons
 */
export async function getBaseBranch(cwd: string): Promise<string> {
    // First check if user has configured a base branch
    const config = vscode.workspace.getConfiguration('claudeLanes');
    const configuredBranch = config.get<string>('baseBranch', '');

    if (configuredBranch && configuredBranch.trim()) {
        return configuredBranch.trim();
    }

    // Fallback to auto-detection
    // Check for origin/main
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/main'], cwd);
        return 'origin/main';
    } catch {
        // origin/main doesn't exist, try next
    }

    // Check for origin/master
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/master'], cwd);
        return 'origin/master';
    } catch {
        // origin/master doesn't exist, try local branches
    }

    // Check for local main
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/heads/main'], cwd);
        return 'main';
    } catch {
        // main doesn't exist, try master
    }

    // Check for local master
    try {
        await execGit(['show-ref', '--verify', '--quiet', 'refs/heads/master'], cwd);
        return 'master';
    } catch {
        // master doesn't exist either
    }

    // Default fallback - this will likely fail but gives a sensible error
    return 'main';
}

/**
 * Called when the extension is deactivated.
 * VS Code handles cleanup of subscriptions automatically,
 * but we also clear cached references to other extensions.
 */
export function deactivate(): void {
    // Clear Project Manager cache to avoid stale references
    clearProjectManagerCache();
}