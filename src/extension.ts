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
    getRepoIdentifier,
    getGlobalStorageUri
} from './ClaudeSessionProvider';
import { SessionFormProvider } from './SessionFormProvider';
import { initializeGitPath, execGit } from './gitService';
import { GitChangesPanel } from './GitChangesPanel';
import { addProject, removeProject, clearCache as clearProjectManagerCache, initialize as initializeProjectManagerService } from './ProjectManagerService';

/**
 * Helper to get error message from unknown error type
 */
function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

const WORKTREE_FOLDER = '.worktrees';

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

    if (relativePath && relativePath.trim()) {
        // Normalize backslashes and remove leading/trailing slashes
        const normalizedPath = relativePath.trim()
            .replace(/\\/g, '/') // Convert Windows backslashes to forward slashes
            .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

        // Security: Reject absolute paths
        if (path.isAbsolute(normalizedPath)) {
            console.warn(`Claude Lanes: Absolute paths not allowed in ${configKey}. Using default.`);
            return `.worktrees/**/${filename}`;
        }

        // Security: Reject paths with parent directory traversal
        if (normalizedPath.includes('..')) {
            console.warn(`Claude Lanes: Invalid path in ${configKey}: ${normalizedPath}. Using default.`);
            return `.worktrees/**/${filename}`;
        }

        return `.worktrees/**/${normalizedPath}/${filename}`;
    }
    return `.worktrees/**/${filename}`;
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
    sessionFormProvider.setOnSubmit(async (name: string, prompt: string, acceptanceCriteria: string) => {
        await createSession(name, prompt, acceptanceCriteria, baseRepoPath, sessionProvider);
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
                    const worktreesDir = path.join(baseRepoPath, WORKTREE_FOLDER);
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
                                        await setupStatusHooks(worktreePath);
                                        updated++;
                                    }
                                }
                                vscode.window.showInformationMessage(`Updated hooks in ${updated} worktree(s).`);
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

        // Use the shared createSession function (no prompt or acceptance criteria when using command palette)
        // Use baseRepoPath to create sessions in the main repo even when in a worktree
        await createSession(name, '', '', baseRepoPath, sessionProvider);
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
    let setupHooksDisposable = vscode.commands.registerCommand('claudeWorktrees.setupStatusHooks', async (item?: SessionItem) => {
        if (!item) {
            vscode.window.showErrorMessage('Please right-click on a session to setup status hooks.');
            return;
        }
        try {
            await setupStatusHooks(item.worktreePath);
            vscode.window.showInformationMessage(`Status hooks configured for '${item.label}'`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to setup hooks: ${getErrorMessage(err)}`);
        }
    });

    // 6. Register SHOW GIT CHANGES Command
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

            // Check if we should include uncommitted changes
            const config = vscode.workspace.getConfiguration('claudeLanes');
            const includeUncommitted = config.get<boolean>('includeUncommittedChanges', true);

            // Get the diff - either including working directory changes or only committed changes
            const diffArgs = includeUncommitted
                ? ['diff', baseBranch]  // Compare base branch to working directory
                : ['diff', `${baseBranch}...HEAD`];  // Compare base branch to HEAD (committed only)
            const diffContent = await execGit(diffArgs, item.worktreePath);

            // Check if there are any changes
            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage('No changes in this session');
                return;
            }

            // Open the GitChangesPanel with the diff content
            GitChangesPanel.createOrShow(context.extensionUri, item.label, diffContent);
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
 */
async function createSession(
    name: string,
    prompt: string,
    acceptanceCriteria: string,
    workspaceRoot: string | undefined,
    sessionProvider: ClaudeSessionProvider
): Promise<void> {
    console.log("Create Session triggered!");

    // 1. Check Workspace
    if (!workspaceRoot) {
        vscode.window.showErrorMessage("Error: You must open a folder/workspace first!");
        return;
    }

    // 3. Check Git Status (do this once before the loop)
    const isGit = fs.existsSync(path.join(workspaceRoot, '.git'));
    if (!isGit) {
        vscode.window.showErrorMessage("Error: Current folder is not a git repository. Run 'git init' first.");
        return;
    }

    // Use iterative approach to handle name conflicts
    let currentName = name;
    const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

    while (true) {
        // 2. Validate name
        if (!currentName || !currentName.trim()) {
            vscode.window.showErrorMessage("Error: Session name is required!");
            return;
        }

        const trimmedName = currentName.trim();

        // 2b. Validate branch name characters (git-safe)
        if (!branchNameRegex.test(trimmedName)) {
            vscode.window.showErrorMessage("Error: Session name contains invalid characters. Use only letters, numbers, hyphens, underscores, dots, or slashes.");
            return;
        }

        // 2c. Prevent names that could cause git issues
        if (trimmedName.startsWith('-') || trimmedName.startsWith('.') ||
            trimmedName.endsWith('.') || trimmedName.includes('..') ||
            trimmedName.endsWith('.lock')) {
            vscode.window.showErrorMessage("Error: Session name cannot start with '-' or '.', end with '.' or '.lock', or contain '..'");
            return;
        }

        const worktreePath = path.join(workspaceRoot, '.worktrees', trimmedName);
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
                    vscode.window.showErrorMessage(
                        `Branch '${trimmedName}' is already checked out in another worktree. ` +
                        `Git does not allow the same branch to be checked out in multiple worktrees.`
                    );
                    return;
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
                console.log(`Running: git worktree add "${worktreePath}" -b "${trimmedName}"`);
                await execGit(['worktree', 'add', worktreePath, '-b', trimmedName], workspaceRoot);
            }

            // 5. Setup status hooks before opening Claude
            await setupStatusHooks(worktreePath);

            // 5b. Add worktree as a project in Project Manager
            // Get sanitized repo name for project naming
            const repoName = getRepoName(workspaceRoot).replace(/[<>:"/\\|?*]/g, '_');
            const projectName = `${repoName}-${trimmedName}`;
            await addProject(projectName, worktreePath, ['claude-lanes']);

            // 6. Success
            sessionProvider.refresh();
            await openClaudeTerminal(trimmedName, worktreePath, prompt, acceptanceCriteria);
            vscode.window.showInformationMessage(`Session '${trimmedName}' Ready!`);

            // Exit the loop on success
            return;

        } catch (err) {
            console.error(err);
            vscode.window.showErrorMessage(`Git Error: ${getErrorMessage(err)}`);
            return;
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
async function openClaudeTerminal(taskName: string, worktreePath: string, prompt?: string, acceptanceCriteria?: string): Promise<void> {
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

    // C. Auto-start Claude - resume if session ID exists, otherwise start fresh
    const sessionData = getSessionId(worktreePath);
    if (sessionData?.sessionId) {
        // Resume existing session
        terminal.sendText(`claude --resume ${sessionData.sessionId}`);
    } else {
        // Combine prompt and acceptance criteria
        const combinedPrompt = combinePromptAndCriteria(prompt, acceptanceCriteria);
        if (combinedPrompt) {
            // Write prompt to file in main repo for history and to avoid terminal buffer issues
            // Stored in <repo>/.claude/lanes/<session-name>.txt for user reference
            // Derive repo root from worktree path: <repo>/.worktrees/<session-name>
            const repoRoot = path.dirname(path.dirname(worktreePath));
            const lanesDir = path.join(repoRoot, '.claude', 'lanes');
            await fsPromises.mkdir(lanesDir, { recursive: true });
            const promptFilePath = path.join(lanesDir, `${taskName}.txt`);
            await fsPromises.writeFile(promptFilePath, combinedPrompt, 'utf-8');
            // Pass prompt file content as argument using command substitution
            terminal.sendText(`claude "$(cat "${promptFilePath}")"`);
        } else {
            // Start new session without prompt
            terminal.sendText("claude");
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
    const dir = path.join(root, WORKTREE_FOLDER);
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
 * Helper to check if our status hook already exists in settings
 */
function hasStatusHook(settings: ClaudeSettings): boolean {
    if (!settings.hooks) {return false;}
    const hookTypes = ['Stop', 'UserPromptSubmit', 'Notification', 'PreToolUse'];
    return hookTypes.some(hookType => {
        const entries = settings.hooks?.[hookType];
        if (!entries) {return false;}
        return entries.some(entry =>
            entry.hooks.some(h => h.command.includes('.claude-status'))
        );
    });
}

/**
 * Helper to check if our session hook already exists in settings
 */
function hasSessionHook(settings: ClaudeSettings): boolean {
    if (!settings.hooks) {return false;}
    const entries = settings.hooks.SessionStart;
    if (!entries) {return false;}
    return entries.some(entry =>
        entry.hooks.some(h => h.command.includes('.claude-session'))
    );
}

/**
 * Sets up Claude hooks for status file updates in a worktree.
 * Always writes hooks to settings.local.json.
 * If hooks exist in settings.json, offers to migrate them to settings.local.json.
 * Uses atomic writes to prevent race conditions.
 * When global storage is enabled, uses absolute paths to the global storage directory.
 */
async function setupStatusHooks(worktreePath: string): Promise<void> {
    const claudeDir = path.join(worktreePath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settingsLocalPath = path.join(claudeDir, 'settings.local.json');

    // Check if global storage is enabled
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

            // Ensure the global storage directories exist
            await fsPromises.mkdir(path.dirname(globalStatusPath), { recursive: true });
            await fsPromises.mkdir(path.dirname(globalSessionPath), { recursive: true });
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

    // Ensure .claude directory exists
    await fsPromises.mkdir(claudeDir, { recursive: true });

    // Check if hooks already exist in settings.json (deprecated location)
    let existingSettings: ClaudeSettings = {};
    let hooksExistInSettingsJson = false;
    try {
        const content = await fsPromises.readFile(settingsPath, 'utf-8');
        existingSettings = JSON.parse(content);
        hooksExistInSettingsJson = hasStatusHook(existingSettings) || hasSessionHook(existingSettings);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // File exists but is invalid JSON
            console.warn('Claude Lanes: settings.json is invalid');
        }
        // File doesn't exist - that's ok
    }

    // Default to settings.local.json
    let targetPath = settingsLocalPath;

    // If hooks exist in settings.json, ask user if they want to migrate
    if (hooksExistInSettingsJson) {
        const migrate = await vscode.window.showInformationMessage(
            'Claude Lanes hooks found in settings.json (deprecated). Move to settings.local.json?',
            'Yes, migrate',
            'No, keep in settings.json'
        );

        if (migrate === 'Yes, migrate') {
            // Remove hooks from settings.json
            if (existingSettings.hooks) {
                // Remove our hooks from settings.json
                const hookTypes = ['SessionStart', 'Stop', 'UserPromptSubmit', 'Notification', 'PreToolUse'];
                for (const hookType of hookTypes) {
                    const entries = existingSettings.hooks[hookType];
                    if (entries) {
                        existingSettings.hooks[hookType] = entries
                            .map(entry => ({
                                ...entry,
                                hooks: entry.hooks.filter(h =>
                                    !h.command.includes('.claude-status') &&
                                    !h.command.includes('.claude-session')
                                )
                            }))
                            .filter(entry => entry.hooks.length > 0);

                        // Remove empty arrays
                        if (existingSettings.hooks[hookType].length === 0) {
                            delete existingSettings.hooks[hookType];
                        }
                    }
                }

                // Remove hooks object if empty
                if (Object.keys(existingSettings.hooks).length === 0) {
                    delete existingSettings.hooks;
                }

                // Write cleaned settings.json (or delete if empty)
                if (Object.keys(existingSettings).length === 0) {
                    await fsPromises.unlink(settingsPath).catch(() => {});
                } else {
                    const tempSettingsPath = path.join(claudeDir, `settings.json.${Date.now()}.tmp`);
                    await fsPromises.writeFile(tempSettingsPath, JSON.stringify(existingSettings, null, 2), 'utf-8');
                    await fsPromises.rename(tempSettingsPath, settingsPath);
                }
            }
            // targetPath remains settingsLocalPath
        } else if (migrate === 'No, keep in settings.json') {
            // User chose to keep using settings.json
            targetPath = settingsPath;
        } else {
            // User dismissed the dialog - default to settings.local.json but don't remove from settings.json
            // This is a safe default that doesn't modify their existing settings.json
        }
    }

    const tempPath = path.join(claudeDir, `${path.basename(targetPath)}.${Date.now()}.tmp`);

    // Read existing settings from the target file
    let settings: ClaudeSettings = {};
    try {
        const content = await fsPromises.readFile(targetPath, 'utf-8');
        settings = JSON.parse(content);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // File exists but is invalid JSON - warn user
            const fileName = path.basename(targetPath);
            const answer = await vscode.window.showWarningMessage(
                `Existing .claude/${fileName} is invalid. Overwrite?`,
                'Overwrite',
                'Cancel'
            );
            if (answer !== 'Overwrite') {
                throw new Error('Setup cancelled - invalid existing settings');
            }
        }
        // File doesn't exist or user chose to overwrite - start fresh
    }

    // Initialize hooks object if needed
    if (!settings.hooks) {
        settings.hooks = {};
    }

    // Define our status hooks with configured paths
    const statusWriteWaiting = {
        type: 'command',
        command: `echo '{"status":"waiting_for_user"}' > "${statusFilePath}"`
    };

    const statusWriteWorking = {
        type: 'command',
        command: `echo '{"status":"working"}' > "${statusFilePath}"`
    };

    // Define our session ID capture hook with configured path
    // Session ID is provided via stdin as JSON: {"session_id": "...", ...}
    const sessionIdCapture = {
        type: 'command',
        command: `jq -r --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{sessionId: .session_id, timestamp: $ts}' > "${sessionFilePath}"`
    };

    // Helper to remove existing hooks (used when updating paths)
    const removeStatusHooks = (entries: HookEntry[] | undefined): HookEntry[] => {
        if (!entries) {return [];}
        return entries.map(entry => ({
            ...entry,
            hooks: entry.hooks.filter(h => !h.command.includes('.claude-status'))
        })).filter(entry => entry.hooks.length > 0);
    };

    const removeSessionHooks = (entries: HookEntry[] | undefined): HookEntry[] => {
        if (!entries) {return [];}
        return entries.map(entry => ({
            ...entry,
            hooks: entry.hooks.filter(h => !h.command.includes('.claude-session'))
        })).filter(entry => entry.hooks.length > 0);
    };

    // Remove existing hooks and add new ones (to handle path changes)
    // Add SessionStart hook (fires when Claude session starts = capture session ID)
    settings.hooks.SessionStart = removeSessionHooks(settings.hooks.SessionStart);
    settings.hooks.SessionStart.push({
        hooks: [sessionIdCapture]
    });

    // Add Stop hook (fires when Claude finishes responding = waiting for user)
    settings.hooks.Stop = removeStatusHooks(settings.hooks.Stop);
    settings.hooks.Stop.push({
        hooks: [statusWriteWaiting]
    });

    // Add UserPromptSubmit hook (fires when user submits = Claude starts working)
    settings.hooks.UserPromptSubmit = removeStatusHooks(settings.hooks.UserPromptSubmit);
    settings.hooks.UserPromptSubmit.push({
        hooks: [statusWriteWorking]
    });

    // Add Notification hook for permission prompts (fires when Claude asks for permission)
    settings.hooks.Notification = removeStatusHooks(settings.hooks.Notification);
    settings.hooks.Notification.push({
        matcher: 'permission_prompt',
        hooks: [statusWriteWaiting]
    });

    // Add PreToolUse hook (fires before any tool = Claude is working)
    settings.hooks.PreToolUse = removeStatusHooks(settings.hooks.PreToolUse);
    settings.hooks.PreToolUse.push({
        matcher: '.*',
        hooks: [statusWriteWorking]
    });

    // Write updated settings atomically (write to temp, then rename)
    await fsPromises.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
    await fsPromises.rename(tempPath, targetPath);
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