import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
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
    getPromptsPath,
    getSessionWorkflow,
    saveSessionWorkflow
} from './ClaudeSessionProvider';
import { SessionFormProvider, PermissionMode, isValidPermissionMode } from './SessionFormProvider';
import { initializeGitPath, execGit } from './gitService';
import { GitChangesPanel, OnBranchChangeCallback } from './GitChangesPanel';
import { PreviousSessionProvider, PreviousSessionItem, getPromptsDir } from './PreviousSessionProvider';
import { WorkflowsProvider } from './WorkflowsProvider';
import { discoverWorkflows, WorkflowMetadata, loadWorkflowTemplateFromString, WorkflowValidationError } from './workflow';
import { addProject, removeProject, clearCache as clearProjectManagerCache, initialize as initializeProjectManagerService } from './ProjectManagerService';
import { sanitizeSessionName as _sanitizeSessionName, getErrorMessage } from './utils';
import { ClaudeCodeAgent, CodeAgent } from './codeAgents';
// Use local reference for internal use
const sanitizeSessionName = _sanitizeSessionName;

/**
 * Pending session request from MCP server.
 */
export interface PendingSessionConfig {
    name: string;
    sourceBranch: string;
    prompt?: string;
    workflow?: string;
    requestedAt: string;
}

/**
 * Directory where MCP server writes pending session requests.
 */
const PENDING_SESSIONS_DIR = path.join(os.homedir(), '.claude', 'lanes', 'pending-sessions');

/**
 * Directory containing bundled workflow templates.
 * Located at extension root/workflows/ (from compiled code in out/, go up one level)
 */
const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

/**
 * Get available workflow template names from the workflows directory.
 * @returns Array of workflow names (without .yaml extension)
 */
async function getAvailableWorkflows(): Promise<string[]> {
    try {
        const files = await fsPromises.readdir(WORKFLOWS_DIR);
        return files
            .filter(f => f.endsWith('.yaml'))
            .map(f => f.replace('.yaml', ''));
    } catch {
        // If workflows directory doesn't exist, return empty array
        return [];
    }
}

/**
 * Validate that a workflow template exists.
 * @param workflow The workflow name to validate
 * @returns Object with isValid flag and available workflows if invalid
 */
async function validateWorkflow(workflow: string): Promise<{ isValid: boolean; availableWorkflows: string[] }> {
    const availableWorkflows = await getAvailableWorkflows();
    const isValid = availableWorkflows.includes(workflow);
    return { isValid, availableWorkflows };
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
    /** Expected branch name (same as session name in Lanes) */
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
        console.warn('Lanes: Failed to read worktrees directory:', getErrorMessage(err));
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
                    expectedBranch: entry // In Lanes, folder name = branch name
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
        console.warn(`Lanes: Failed to copy some files during repair: ${getErrorMessage(err)}`);
    }

    // Step 6: Remove the temp directory
    try {
        await fsPromises.rm(tempPath, { recursive: true, force: true });
    } catch (err) {
        // Log but don't fail - the repair was successful
        console.warn(`Lanes: Failed to clean up temp directory: ${getErrorMessage(err)}`);
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
        console.error('Lanes: Failed to repair some worktrees:', failures);
    } else {
        vscode.window.showErrorMessage(
            `Failed to repair worktrees. Check the console for details.`
        );
        console.error('Lanes: Failed to repair worktrees:', failures);
    }
}

// getPromptsDir is imported from PreviousSessionProvider.ts

// Re-export sanitizeSessionName from utils for backwards compatibility
export { sanitizeSessionName } from './utils';

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
        console.warn('Lanes: getBaseRepoPath failed:', getErrorMessage(err));
        return workspacePath;
    }
}

/**
 * Get the glob pattern for watching a file based on configuration.
 * Security: Validates path to prevent directory traversal in glob patterns.
 * @param configKey The configuration key to read
 * @param filename The filename to watch (e.g., 'workflow-state.json')
 * @returns Glob pattern for watching the file in worktrees
 */
function getWatchPattern(configKey: string, filename: string): string {
    const config = vscode.workspace.getConfiguration('lanes');
    const relativePath = config.get<string>(configKey, '');
    const worktreesFolder = getWorktreesFolder();

    if (relativePath && relativePath.trim()) {
        // Normalize backslashes and remove leading/trailing slashes
        const normalizedPath = relativePath.trim()
            .replace(/\\/g, '/') // Convert Windows backslashes to forward slashes
            .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

        // Security: Reject absolute paths
        if (path.isAbsolute(normalizedPath)) {
            console.warn(`Lanes: Absolute paths not allowed in ${configKey}. Using default.`);
            return `${worktreesFolder}/**/${filename}`;
        }

        // Security: Reject paths with parent directory traversal
        if (normalizedPath.includes('..')) {
            console.warn(`Lanes: Invalid path in ${configKey}: ${normalizedPath}. Using default.`);
            return `${worktreesFolder}/**/${filename}`;
        }

        return `${worktreesFolder}/**/${normalizedPath}/${filename}`;
    }
    return `${worktreesFolder}/**/${filename}`;
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

/**
 * Process a pending session request from the MCP server.
 * Creates the session and opens the terminal, then deletes the config file.
 */
async function processPendingSession(
    configPath: string,
    workspaceRoot: string | undefined,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent
): Promise<void> {
    try {
        // Read and parse the config file
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: PendingSessionConfig = JSON.parse(configContent);

        console.log(`Processing pending session request: ${config.name}`);

        // Validate workflow if provided
        if (config.workflow) {
            const { isValid, availableWorkflows } = await validateWorkflow(config.workflow);
            if (!isValid) {
                // Delete config file to prevent re-processing
                await fsPromises.unlink(configPath);
                const availableList = availableWorkflows.length > 0
                    ? availableWorkflows.join(', ')
                    : 'none found';
                vscode.window.showErrorMessage(
                    `Invalid workflow '${config.workflow}'. Available workflows: ${availableList}. ` +
                    `Session '${config.name}' was not created.`
                );
                return;
            }
        }

        // Delete the config file first to prevent re-processing
        await fsPromises.unlink(configPath);

        // Use the existing createSession logic
        // Note: createSession expects these parameters:
        // name, prompt, acceptanceCriteria, permissionMode, sourceBranch, workflow, workspaceRoot, sessionProvider, codeAgent
        await createSession(
            config.name,
            config.prompt || '',
            '', // acceptanceCriteria
            'default' as PermissionMode, // permissionMode
            config.sourceBranch,
            config.workflow || null, // workflow - optional workflow template from MCP request
            workspaceRoot,
            sessionProvider,
            codeAgent
        );

    } catch (err) {
        console.error(`Failed to process pending session ${configPath}:`, err);
        // Try to delete the config file even on error to prevent infinite retries
        try {
            await fsPromises.unlink(configPath);
        } catch {
            // Ignore deletion errors
        }
        vscode.window.showErrorMessage(`Failed to create session from MCP request: ${getErrorMessage(err)}`);
    }
}

/**
 * Check for and process any pending session requests.
 * Called on startup and when new files are detected.
 */
async function checkPendingSessions(
    workspaceRoot: string | undefined,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent
): Promise<void> {
    try {
        // Ensure directory exists
        if (!fs.existsSync(PENDING_SESSIONS_DIR)) {
            return;
        }

        const files = await fsPromises.readdir(PENDING_SESSIONS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
            const configPath = path.join(PENDING_SESSIONS_DIR, file);
            await processPendingSession(configPath, workspaceRoot, sessionProvider, codeAgent);
        }
    } catch (err) {
        console.error('Failed to check pending sessions:', err);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, "Lanes" is now active!'); // Check Debug Console for this

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
            console.error('Lanes: Error checking for broken worktrees:', getErrorMessage(err));
        });
    }

    // Create the global code agent instance
    // This provides agent-specific behavior for terminal commands, file naming, etc.
    const codeAgent = new ClaudeCodeAgent();
    console.log(`Code agent initialized: ${codeAgent.displayName}`);

    // Initialize global storage context for session file storage
    // This must be done before creating the session provider
    initializeGlobalStorageContext(context.globalStorageUri, baseRepoPath, codeAgent);
    console.log(`Global storage initialized at: ${context.globalStorageUri.fsPath}`);

    // Initialize Tree Data Provider with the base repo path
    // This ensures sessions are always listed from the main repository
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot, baseRepoPath);
    vscode.window.registerTreeDataProvider('claudeSessionsView', sessionProvider);
    context.subscriptions.push(sessionProvider);

    // Initialize Previous Sessions Provider
    const previousSessionProvider = new PreviousSessionProvider(workspaceRoot, baseRepoPath);
    vscode.window.registerTreeDataProvider('previousSessionsView', previousSessionProvider);
    context.subscriptions.push(previousSessionProvider);

    // Initialize Workflows Provider
    const workflowsProvider = new WorkflowsProvider(context.extensionPath, workspaceRoot);
    vscode.window.registerTreeDataProvider('workflowsView', workflowsProvider);
    context.subscriptions.push(workflowsProvider);

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
    sessionFormProvider.setOnSubmit(async (name: string, prompt: string, acceptanceCriteria: string, sourceBranch: string, permissionMode: PermissionMode, workflow: string | null) => {
        await createSession(name, prompt, acceptanceCriteria, permissionMode, sourceBranch, workflow, baseRepoPath, sessionProvider, codeAgent);
    });

    // Helper function to refresh workflows in both the tree view and the session form
    async function refreshWorkflows(): Promise<void> {
        workflowsProvider.refresh();
        // Wait for the tree to update, then get the workflows
        // We need to trigger getChildren to populate the workflows list
        await workflowsProvider.getChildren();
        const workflows = workflowsProvider.getWorkflows();
        sessionFormProvider.updateWorkflows(workflows);
    }

    // Register callback for refresh workflows button in session form
    sessionFormProvider.setOnRefreshWorkflows(async () => {
        await refreshWorkflows();
    });

    // Initial workflow load
    refreshWorkflows();

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
            console.warn('Lanes: Failed to create global storage directory:', err);
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
    }

    // Watch for changes to the prompts folder to refresh previous sessions
    // getPromptsDir returns an absolute path (may be in global storage or repo-relative)
    if (watchPath) {
        const promptsDirPath = getPromptsDir(watchPath);
        if (promptsDirPath) {
            const promptsWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(promptsDirPath, '*.txt')
            );

            promptsWatcher.onDidChange(() => previousSessionProvider.refresh());
            promptsWatcher.onDidCreate(() => previousSessionProvider.refresh());
            promptsWatcher.onDidDelete(() => previousSessionProvider.refresh());

            context.subscriptions.push(promptsWatcher);
        }
    }

    // Watch for changes to the custom workflows folder to refresh workflows
    if (workspaceRoot) {
        const config = vscode.workspace.getConfiguration('lanes');
        const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.claude/lanes/workflows');
        const customWorkflowsPath = path.join(workspaceRoot, customWorkflowsFolder);

        const workflowsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(customWorkflowsPath, '*.yaml')
        );

        workflowsWatcher.onDidChange(() => refreshWorkflows());
        workflowsWatcher.onDidCreate(() => refreshWorkflows());
        workflowsWatcher.onDidDelete(() => refreshWorkflows());

        context.subscriptions.push(workflowsWatcher);
    }

    // Watch for worktree folder changes to refresh both active and previous sessions
    if (watchPath) {
        const worktreesFolder = getWorktreesFolder();
        const worktreeFolderWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, `${worktreesFolder}/*`)
        );

        // When worktrees are added/removed, both views need updating
        worktreeFolderWatcher.onDidCreate(() => {
            sessionProvider.refresh();
            previousSessionProvider.refresh();
        });
        worktreeFolderWatcher.onDidDelete(() => {
            sessionProvider.refresh();
            previousSessionProvider.refresh();
        });

        context.subscriptions.push(worktreeFolderWatcher);
    }

    // Watch for custom workflows folder changes
    if (watchPath) {
        const customWorkflowsFolder = vscode.workspace.getConfiguration('lanes').get<string>('customWorkflowsFolder', '.claude/lanes/workflows');
        const customWorkflowsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, `${customWorkflowsFolder}/*.yaml`)
        );

        customWorkflowsWatcher.onDidChange(() => workflowsProvider.refresh());
        customWorkflowsWatcher.onDidCreate(() => workflowsProvider.refresh());
        customWorkflowsWatcher.onDidDelete(() => workflowsProvider.refresh());

        context.subscriptions.push(customWorkflowsWatcher);
    }

    // Watch for pending session requests from MCP
    // Ensure the directory exists for the watcher
    if (!fs.existsSync(PENDING_SESSIONS_DIR)) {
        fs.mkdirSync(PENDING_SESSIONS_DIR, { recursive: true });
    }

    const pendingSessionWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(PENDING_SESSIONS_DIR, '*.json')
    );

    pendingSessionWatcher.onDidCreate(async (uri) => {
        console.log(`Pending session file detected: ${uri.fsPath}`);
        await processPendingSession(uri.fsPath, workspaceRoot, sessionProvider, codeAgent);
    });

    context.subscriptions.push(pendingSessionWatcher);

    // Check for any pending sessions on startup
    checkPendingSessions(workspaceRoot, sessionProvider, codeAgent);

    // Listen for configuration changes to update hooks when storage location changes
    // Use a flag to prevent concurrent execution during async operations
    let isUpdatingStorageConfig = false;
    const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('lanes.useGlobalStorage')) {
            // Prevent concurrent execution
            if (isUpdatingStorageConfig) {
                return;
            }
            isUpdatingStorageConfig = true;

            try {
                // Notify user about the change
                const useGlobal = isGlobalStorageEnabled();
                const message = useGlobal
                    ? 'Lanes: Global storage enabled. New sessions will use global storage for tracking files.'
                    : 'Lanes: Global storage disabled. New sessions will use worktree directories for tracking files.';
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

        // Use the shared createSession function (no prompt, acceptance criteria, source branch, or workflow when using command palette)
        // Use baseRepoPath to create sessions in the main repo even when in a worktree
        await createSession(name, '', '', 'default', '', null, baseRepoPath, sessionProvider, codeAgent);
    });

    // 3. Register OPEN/RESUME Command
    let openDisposable = vscode.commands.registerCommand('claudeWorktrees.openSession', async (item: SessionItem) => {
        await openClaudeTerminal(item.label, item.worktreePath, undefined, undefined, undefined, undefined, codeAgent);
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
        const config = vscode.workspace.getConfiguration('lanes');
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
                        console.warn(`Lanes: Could not read untracked file ${filePath}:`, getErrorMessage(fileErr));
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
                console.warn('Lanes: Could not get untracked files:', getErrorMessage(statusErr));
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

    // 8. Register OPEN PREVIOUS SESSION PROMPT Command
    let openPreviousPromptDisposable = vscode.commands.registerCommand('claudeWorktrees.openPreviousSessionPrompt', async (item: PreviousSessionItem) => {
        if (!item || !item.promptFilePath) {
            vscode.window.showErrorMessage('Please click on a previous session to view its prompt.');
            return;
        }

        try {
            // Open the prompt file in the editor
            const document = await vscode.workspace.openTextDocument(item.promptFilePath);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open prompt file: ${getErrorMessage(err)}`);
        }
    });

    // 9. Register CREATE WORKFLOW Command
    let createWorkflowDisposable = vscode.commands.registerCommand('lanes.createWorkflow', async () => {
        await createWorkflow(context.extensionPath, workspaceRoot, workflowsProvider);
        // Refresh workflows in both the tree view and the session form dropdown
        await refreshWorkflows();
    });

    // 10. Register VALIDATE WORKFLOW Command
    let validateWorkflowDisposable = vscode.commands.registerCommand('lanes.validateWorkflow', async () => {
        // 1. Get the active editor
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No file is open');
            return;
        }

        // 2. Check if it's a YAML file
        const document = editor.document;
        const fileName = document.fileName;
        if (!fileName.endsWith('.yaml') && !fileName.endsWith('.yml')) {
            vscode.window.showWarningMessage('Current file is not a YAML file');
            return;
        }

        // 3. Get the file content
        const content = document.getText();

        // 4. Try to validate using loadWorkflowTemplateFromString
        try {
            const template = loadWorkflowTemplateFromString(content);
            vscode.window.showInformationMessage(`Workflow "${template.name}" is valid!`);
        } catch (error) {
            if (error instanceof WorkflowValidationError) {
                vscode.window.showErrorMessage(`Workflow validation failed: ${error.message}`);
            } else {
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Invalid YAML: ${errorMessage}`);
            }
        }
    });

    context.subscriptions.push(createDisposable);
    context.subscriptions.push(openDisposable);
    context.subscriptions.push(deleteDisposable);
    context.subscriptions.push(setupHooksDisposable);
    context.subscriptions.push(showGitChangesDisposable);
    context.subscriptions.push(openWindowDisposable);
    context.subscriptions.push(openPreviousPromptDisposable);
    context.subscriptions.push(createWorkflowDisposable);
    context.subscriptions.push(validateWorkflowDisposable);

    // Auto-resume Claude session when opened in a worktree with an existing session
    if (isInWorktree && workspaceRoot) {
        const sessionData = getSessionId(workspaceRoot);
        if (sessionData?.sessionId) {
            const sessionName = path.basename(workspaceRoot);
            // Brief delay to ensure VS Code is fully ready
            setTimeout(() => {
                openClaudeTerminal(sessionName, workspaceRoot, undefined, undefined, undefined, undefined, codeAgent);
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
 * @param permissionMode Permission mode for Claude CLI
 * @param sourceBranch Optional source branch to create worktree from (empty = use default behavior)
 * @param workflow Optional workflow template name to guide Claude through structured phases
 * @param workspaceRoot The workspace root path
 * @param sessionProvider The session provider for refreshing the UI
 */
async function createSession(
    name: string,
    prompt: string,
    acceptanceCriteria: string,
    permissionMode: PermissionMode,
    sourceBranch: string,
    workflow: string | null,
    workspaceRoot: string | undefined,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent
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
            await addProject(projectName, worktreePath, ['lanes']);

            // 6. Success
            sessionProvider.refresh();
            await openClaudeTerminal(trimmedName, worktreePath, prompt, acceptanceCriteria, permissionMode, workflow, codeAgent);
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

/**
 * Generates the workflow orchestrator instructions to prepend to a prompt.
 * These instructions guide Claude through the structured workflow phases.
 */
function getWorkflowOrchestratorInstructions(): string {
    return `You are an orchestrator agent following a structured workflow.

## CRITICAL RULES

1. **Always check workflow_status first** to see your current step
2. **Follow the agent restrictions** - only use tools you're allowed to use
3. **For implementation/test/review steps**, spawn sub-agents using the Task tool
4. **Call workflow_advance** after completing each step
5. **Never skip steps** - complete each one before advancing
6. **Only perform actions for the CURRENT step** - do NOT call workflow tools that belong to future steps. If you are unsure about a parameter value (like a loop name), read the workflow file or wait for the step that provides that information instead of guessing.

## Workflow

1. Call workflow_start to begin
2. In planning phase: analyze the goal, then call workflow_set_tasks
3. In executing phase: follow instructions for each step
4. When complete: review all work and commit if approved

## Sub-Agent Spawning

When the current step requires an agent other than orchestrator:
- Use the Task tool to spawn a sub-agent
- Include the agent's tool restrictions in the prompt
- Wait for the sub-agent to complete
- Call workflow_advance with a summary

---

## User Request

`;
}

// THE CORE FUNCTION: Manages the Terminal Tabs
async function openClaudeTerminal(taskName: string, worktreePath: string, prompt?: string, acceptanceCriteria?: string, permissionMode?: PermissionMode, workflow?: string | null, codeAgent?: CodeAgent): Promise<void> {
    // Use CodeAgent for terminal naming if available, otherwise fallback to hardcoded
    const terminalName = codeAgent ? codeAgent.getTerminalName(taskName) : `Claude: ${taskName}`;

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
    // Use CodeAgent for terminal icon configuration if available
    const iconConfig = codeAgent ? codeAgent.getTerminalIcon() : { id: 'robot', color: 'terminal.ansiGreen' };
    const terminal = vscode.window.createTerminal({
        name: terminalName,      // <--- This sets the tab name in the UI
        cwd: worktreePath,       // <--- Starts shell directly inside the isolated worktree
        iconPath: new vscode.ThemeIcon(iconConfig.id), // Terminal icon
        color: iconConfig.color ? new vscode.ThemeColor(iconConfig.color) : new vscode.ThemeColor('terminal.ansiGreen') // Color code the tab
    });

    terminal.show();

    // C. Get or create the extension settings file with hooks
    let settingsPath: string | undefined;
    let mcpConfigPath: string | undefined;

    // Determine effective workflow: use provided workflow or restore from session data
    let effectiveWorkflow = workflow;
    if (!effectiveWorkflow) {
        const savedWorkflow = getSessionWorkflow(worktreePath);
        if (savedWorkflow) {
            effectiveWorkflow = savedWorkflow;
        }
    }

    try {
        settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, workflow, codeAgent);

        // If workflow is active (provided or restored), add MCP config flag separately
        // (--settings only loads hooks, not mcpServers)
        // effectiveWorkflow is now the full path to the workflow YAML file
        if (effectiveWorkflow) {
            // Use CodeAgent to get MCP config if available and supported
            if (codeAgent && codeAgent.supportsMcp()) {
                const mcpConfig = codeAgent.getMcpConfig(worktreePath, effectiveWorkflow);
                if (mcpConfig) {
                    // Write MCP config to a file (inline JSON escaping is problematic)
                    mcpConfigPath = path.join(path.dirname(settingsPath), 'mcp-config.json');
                    await fsPromises.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
                }
            } else {
                // Fallback to hardcoded Claude-specific MCP config
                const mcpServerPath = path.join(__dirname, 'mcp', 'server.js');
                // MCP config file must have mcpServers as root key (same format as .mcp.json)
                const mcpConfig = {
                    mcpServers: {
                        'lanes-workflow': {
                            command: 'node',
                            args: [mcpServerPath, '--worktree', worktreePath, '--workflow-path', effectiveWorkflow]
                        }
                    }
                };
                mcpConfigPath = path.join(path.dirname(settingsPath), 'mcp-config.json');
                await fsPromises.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
            }
        }
    } catch (err) {
        console.warn('Lanes: Failed to create extension settings file:', getErrorMessage(err));
        // Continue without the settings - hooks/MCP won't work but Claude will still run
    }

    // D. Auto-start Claude - resume if session ID exists, otherwise start fresh
    const sessionData = getSessionId(worktreePath);
    let shouldStartFresh = true;

    if (sessionData?.sessionId) {
        // Try to resume existing session
        if (codeAgent) {
            try {
                // Use CodeAgent to build resume command
                const resumeCommand = codeAgent.buildResumeCommand(sessionData.sessionId, {
                    settingsPath,
                    mcpConfigPath
                });
                terminal.sendText(resumeCommand);
                shouldStartFresh = false;
            } catch (err) {
                // Invalid session ID format - log and start fresh session
                console.error('Failed to build resume command, starting fresh session:', getErrorMessage(err));
            }
        } else {
            // Fallback to hardcoded command construction
            const mcpConfigFlag = mcpConfigPath ? `--mcp-config "${mcpConfigPath}" ` : '';
            const settingsFlag = settingsPath ? `--settings "${settingsPath}" ` : '';
            terminal.sendText(`claude ${mcpConfigFlag}${settingsFlag}--resume ${sessionData.sessionId}`.trim());
            shouldStartFresh = false;
        }
    }

    if (shouldStartFresh) {
        // Validate permissionMode to prevent command injection from untrusted webview input
        const validatedMode = isValidPermissionMode(permissionMode) ? permissionMode : 'default';

        // Combine prompt and acceptance criteria
        let combinedPrompt = combinePromptAndCriteria(prompt, acceptanceCriteria);

        // For workflow sessions, prepend orchestrator instructions
        if (workflow && combinedPrompt) {
            combinedPrompt = getWorkflowOrchestratorInstructions() + combinedPrompt;
        } else if (workflow) {
            // Even without a user prompt, workflow sessions need orchestrator instructions
            combinedPrompt = getWorkflowOrchestratorInstructions() + 'Start the workflow and follow the steps.';
        }

        // Write prompt to file for history and to avoid terminal buffer issues
        // This applies to both CodeAgent and fallback paths
        let promptFileCommand: string | undefined;
        if (combinedPrompt) {
            const repoRoot = path.dirname(path.dirname(worktreePath));
            const promptPathInfo = getPromptsPath(taskName, repoRoot);
            if (promptPathInfo) {
                await fsPromises.mkdir(promptPathInfo.needsDir, { recursive: true });
                await fsPromises.writeFile(promptPathInfo.path, combinedPrompt, 'utf-8');
                // Use command substitution to read prompt from file
                promptFileCommand = `"$(cat "${promptPathInfo.path}")"`;
            }
        }

        if (codeAgent) {
            // Use CodeAgent to build start command
            // Note: When using prompt file, we don't pass prompt to buildStartCommand
            // Instead, we append the prompt file command to the generated command
            const startCommand = codeAgent.buildStartCommand({
                permissionMode: validatedMode,
                settingsPath,
                mcpConfigPath
                // Don't pass prompt here - we handle it via file
            });

            if (promptFileCommand) {
                terminal.sendText(`${startCommand} ${promptFileCommand}`);
            } else if (combinedPrompt) {
                // Fallback: prompt exists but file creation failed - pass escaped prompt
                const escapedPrompt = combinedPrompt.replace(/'/g, "'\\''");
                terminal.sendText(`${startCommand} '${escapedPrompt}'`);
            } else {
                terminal.sendText(startCommand);
            }
        } else {
            // Fallback to hardcoded command construction
            const mcpConfigFlag = mcpConfigPath ? `--mcp-config "${mcpConfigPath}" ` : '';
            const settingsFlag = settingsPath ? `--settings "${settingsPath}" ` : '';
            const permissionFlag = validatedMode !== 'default'
                ? `--permission-mode ${validatedMode} `
                : '';

            if (promptFileCommand) {
                // Pass prompt file content as argument using command substitution
                terminal.sendText(`claude ${mcpConfigFlag}${settingsFlag}${permissionFlag}${promptFileCommand}`);
            } else if (combinedPrompt) {
                // Fallback: pass prompt directly if path resolution failed
                // Escape single quotes in the prompt for shell safety
                const escapedPrompt = combinedPrompt.replace(/'/g, "'\\''");
                terminal.sendText(`claude ${mcpConfigFlag}${settingsFlag}${permissionFlag}'${escapedPrompt}'`);
            } else {
                // Start new session without prompt
                terminal.sendText(`claude ${mcpConfigFlag}${settingsFlag}${permissionFlag}`.trim());
            }
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
    mcpServers?: {
        [name: string]: {
            command: string;
            args: string[];
        };
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
    const config = vscode.workspace.getConfiguration('lanes');
    const relativePath = config.get<string>(configKey, '');

    if (!relativePath || !relativePath.trim()) {
        return '';
    }

    const trimmedPath = relativePath.trim()
        .replace(/\\/g, '/') // Normalize backslashes to forward slashes
        .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

    // Security: Reject paths with parent directory traversal
    if (trimmedPath.includes('..')) {
        console.warn(`Lanes: Invalid path in ${configKey}: ${trimmedPath}. Using default.`);
        return '';
    }

    return trimmedPath + '/';
}

/**
 * Creates or updates the extension settings file in global storage.
 * This file contains hooks for status tracking and session ID capture.
 * When a workflow is specified, it also includes MCP server configuration.
 * The file is stored at: globalStorageUri/<repo-identifier>/<session-name>/claude-settings.json
 *
 * @param worktreePath Path to the worktree
 * @param workflow Optional workflow template name. When provided, includes MCP server config.
 * @param codeAgent Optional CodeAgent instance for agent-specific configuration
 * @returns The absolute path to the settings file
 */
export async function getOrCreateExtensionSettingsFile(worktreePath: string, workflow?: string | null, codeAgent?: CodeAgent): Promise<string> {
    // Get the session name from the worktree path
    const sessionName = getSessionNameFromWorktree(worktreePath);

    // Validate session name to prevent path traversal and command injection
    // Session names should only contain [a-zA-Z0-9_\-./] (enforced by sanitizeSessionName at creation)
    if (!sessionName || sessionName.includes('..') || !/^[a-zA-Z0-9_\-./]+$/.test(sessionName)) {
        throw new Error(`Invalid session name derived from worktree path: ${sessionName}`);
    }

    // If workflow not provided, try to restore from saved session data
    let effectiveWorkflow = workflow;
    if (!effectiveWorkflow) {
        const savedWorkflow = getSessionWorkflow(worktreePath);
        if (savedWorkflow) {
            effectiveWorkflow = savedWorkflow;
            console.log(`Lanes: Restored workflow '${effectiveWorkflow}' from session data`);
        }
    }

    const globalStorageUriObj = getGlobalStorageUri();
    const baseRepoPath = getBaseRepoPathForStorage();

    if (!globalStorageUriObj || !baseRepoPath) {
        throw new Error('Global storage not initialized. Cannot create extension settings file.');
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPath);
    const settingsDir = path.join(globalStorageUriObj.fsPath, repoIdentifier, sessionName);
    // Use CodeAgent for settings file naming if available, otherwise fallback to hardcoded
    const settingsFileName = codeAgent ? codeAgent.getSettingsFileName() : 'claude-settings.json';
    const settingsFilePath = path.join(settingsDir, settingsFileName);

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

    // Build hooks configuration
    let hooks: ClaudeSettings['hooks'];

    if (codeAgent) {
        // Use CodeAgent to generate hooks
        const hookConfigs = codeAgent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath);

        // Convert HookConfig[] to ClaudeSettings hooks format
        hooks = {};
        for (const hookConfig of hookConfigs) {
            const entry: HookEntry = {
                hooks: hookConfig.commands
            };
            if (hookConfig.matcher) {
                entry.matcher = hookConfig.matcher;
            }

            if (!hooks[hookConfig.event]) {
                hooks[hookConfig.event] = [];
            }
            hooks[hookConfig.event]!.push(entry);
        }
    } else {
        // Fallback to hardcoded hooks for backward compatibility
        const statusWriteWaiting = {
            type: 'command',
            command: `echo '{"status":"waiting_for_user"}' > "${statusFilePath}"`
        };

        const statusWriteWorking = {
            type: 'command',
            command: `echo '{"status":"working"}' > "${statusFilePath}"`
        };

        // Session ID is provided via stdin as JSON: {"session_id": "...", ...}
        // The hook merges with existing file data to preserve workflow and other metadata
        const sessionIdCapture = {
            type: 'command',
            command: `old=$(cat "${sessionFilePath}" 2>/dev/null || echo '{}'); jq -r --argjson old "$old" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '$old + {sessionId: .session_id, timestamp: $ts}' > "${sessionFilePath}"`
        };

        hooks = {
            SessionStart: [{ hooks: [sessionIdCapture] }],
            Stop: [{ hooks: [statusWriteWaiting] }],
            UserPromptSubmit: [{ hooks: [statusWriteWorking] }],
            Notification: [{ matcher: 'permission_prompt', hooks: [statusWriteWaiting] }],
            PreToolUse: [{ matcher: '.*', hooks: [statusWriteWorking] }]
        };
    }

    // Build the settings object
    const settings: ClaudeSettings = {
        hooks
    };

    // Save workflow path to session file for future restoration (MCP is passed via --mcp-config flag)
    // effectiveWorkflow is now the full path to the workflow YAML file
    if (effectiveWorkflow) {
        // Validate workflow path to prevent command injection
        // Must be an absolute path ending in .yaml
        if (!path.isAbsolute(effectiveWorkflow)) {
            throw new Error(`Invalid workflow path: ${effectiveWorkflow}. Must be an absolute path.`);
        }
        if (!effectiveWorkflow.endsWith('.yaml')) {
            throw new Error(`Invalid workflow path: ${effectiveWorkflow}. Must end with .yaml`);
        }

        // Save workflow path to session file for future restoration
        // Only save if this is a new workflow (not restored from session data)
        if (workflow) {
            saveSessionWorkflow(worktreePath, effectiveWorkflow);
        }
        // Note: MCP server config is now passed via --mcp-config flag in openClaudeTerminal()
        // instead of being included in the settings file
    }

    // Write the settings file atomically with cleanup on failure
    const tempPath = path.join(settingsDir, `${settingsFileName}.${Date.now()}.tmp`);
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
 * First checks the lanes.baseBranch setting.
 * If not set, checks in order: origin/main, origin/master, main, master.
 * @param cwd The working directory (git repo or worktree)
 * @returns The name of the base branch to use for comparisons
 */
export async function getBaseBranch(cwd: string): Promise<string> {
    // First check if user has configured a base branch
    const config = vscode.workspace.getConfiguration('lanes');
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
 * Blank workflow template for "Start from scratch" option.
 */
const BLANK_WORKFLOW_TEMPLATE = `name: my-workflow
description: Custom workflow description

agents:
  orchestrator:
    description: Plans work and coordinates
    tools:
      - Read
      - Glob
      - Grep
      - Task
    cannot:
      - Write
      - Edit
      - Bash
      - commit

loops: {}

steps:
  - id: plan
    type: action
    agent: orchestrator
    instructions: |
      Analyze the goal and create a plan.
`;

/**
 * Creates a new workflow template by copying from an existing template or creating from scratch.
 *
 * Flow:
 * 1. Show quick pick to select base template (built-in templates or start from scratch)
 * 2. Prompt for new workflow name
 * 3. Copy selected template to custom workflows folder
 * 4. Open the new file for editing
 *
 * @param extensionPath Path to the extension directory (for built-in templates)
 * @param workspaceRoot Path to the workspace root
 * @param workflowsProvider The workflows provider to refresh after creation
 */
async function createWorkflow(
    extensionPath: string,
    workspaceRoot: string | undefined,
    workflowsProvider: WorkflowsProvider
): Promise<void> {
    // 1. Check workspace root
    if (!workspaceRoot) {
        vscode.window.showErrorMessage('Please open a workspace folder first.');
        return;
    }

    // 2. Discover available templates for selection
    const config = vscode.workspace.getConfiguration('lanes');
    const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.claude/lanes/workflows');

    let templates: WorkflowMetadata[] = [];
    try {
        templates = await discoverWorkflows({
            extensionPath,
            workspaceRoot,
            customWorkflowsFolder
        });
    } catch (err) {
        console.warn('Lanes: Failed to discover workflows:', err);
        // Continue with empty list - user can still create from scratch
    }

    // 3. Build quick pick items
    interface WorkflowQuickPickItem extends vscode.QuickPickItem {
        action: 'scratch' | 'template';
        template?: WorkflowMetadata;
    }

    const quickPickItems: WorkflowQuickPickItem[] = [
        {
            label: '$(file-add) Start from scratch',
            description: 'Create a blank workflow template',
            action: 'scratch'
        }
    ];

    // Add built-in templates first
    const builtInTemplates = templates.filter(t => t.isBuiltIn);
    if (builtInTemplates.length > 0) {
        quickPickItems.push({
            label: 'Built-in Templates',
            kind: vscode.QuickPickItemKind.Separator,
            action: 'scratch' // Won't be selected
        });
        for (const template of builtInTemplates) {
            quickPickItems.push({
                label: `$(symbol-event) ${template.name}`,
                description: template.description,
                action: 'template',
                template
            });
        }
    }

    // Add custom templates if any
    const customTemplates = templates.filter(t => !t.isBuiltIn);
    if (customTemplates.length > 0) {
        quickPickItems.push({
            label: 'Custom Templates',
            kind: vscode.QuickPickItemKind.Separator,
            action: 'scratch' // Won't be selected
        });
        for (const template of customTemplates) {
            quickPickItems.push({
                label: `$(file-code) ${template.name}`,
                description: template.description,
                action: 'template',
                template
            });
        }
    }

    // 4. Show quick pick
    const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: 'Select a base template or start from scratch',
        title: 'Create Workflow Template'
    });

    if (!selected || selected.kind === vscode.QuickPickItemKind.Separator) {
        return;
    }

    // 5. Prompt for new workflow name
    const workflowName = await vscode.window.showInputBox({
        prompt: 'Enter a name for your workflow',
        placeHolder: 'my-custom-workflow',
        validateInput: (value) => {
            if (!value || !value.trim()) {
                return 'Workflow name is required';
            }
            const trimmed = value.trim();
            // Only allow alphanumeric, hyphens, and underscores
            if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
                return 'Use only letters, numbers, hyphens, and underscores';
            }
            // Check for reserved names
            if (trimmed === 'default' || trimmed === 'feature' || trimmed === 'bugfix' || trimmed === 'refactor') {
                return `'${trimmed}' is a built-in workflow name. Please choose a different name.`;
            }
            return null;
        }
    });

    if (!workflowName) {
        return;
    }

    const trimmedName = workflowName.trim();

    // 6. Validate custom workflows folder and create if needed
    // Security: Reject path traversal
    if (customWorkflowsFolder.includes('..')) {
        vscode.window.showErrorMessage('Invalid custom workflows folder path (contains parent directory traversal).');
        return;
    }

    const customPath = path.join(workspaceRoot, customWorkflowsFolder);

    // Verify resolved path is within workspace
    const normalizedWorkspace = path.normalize(workspaceRoot + path.sep);
    const normalizedCustomPath = path.normalize(customPath + path.sep);
    if (!normalizedCustomPath.startsWith(normalizedWorkspace)) {
        vscode.window.showErrorMessage('Custom workflows folder resolves outside the workspace.');
        return;
    }

    try {
        await fsPromises.mkdir(customPath, { recursive: true });
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to create custom workflows folder: ${getErrorMessage(err)}`);
        return;
    }

    // 7. Create the target file path
    const targetPath = path.join(customPath, `${trimmedName}.yaml`);

    // Check if file already exists
    try {
        await fsPromises.access(targetPath);
        // File exists
        const overwrite = await vscode.window.showWarningMessage(
            `A workflow named '${trimmedName}' already exists. Overwrite?`,
            { modal: true },
            'Overwrite'
        );
        if (overwrite !== 'Overwrite') {
            return;
        }
    } catch {
        // File doesn't exist - good
    }

    // 8. Create the workflow file
    try {
        let content: string;
        if (selected.action === 'scratch') {
            // Create blank template with the user's name
            content = BLANK_WORKFLOW_TEMPLATE.replace('name: my-workflow', `name: ${trimmedName}`);
        } else if (selected.template) {
            // Copy from existing template
            const sourceContent = await fsPromises.readFile(selected.template.path, 'utf-8');
            // Replace the name in the content
            content = sourceContent.replace(/^name:\s*.+$/m, `name: ${trimmedName}`);
        } else {
            vscode.window.showErrorMessage('Invalid template selection.');
            return;
        }

        await fsPromises.writeFile(targetPath, content, 'utf-8');
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to create workflow file: ${getErrorMessage(err)}`);
        return;
    }

    // 9. Refresh the workflows view
    workflowsProvider.refresh();

    // 10. Open the file for editing
    try {
        const doc = await vscode.workspace.openTextDocument(targetPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        vscode.window.showInformationMessage(`Created workflow template: ${trimmedName}`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to open workflow file: ${getErrorMessage(err)}`);
    }
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