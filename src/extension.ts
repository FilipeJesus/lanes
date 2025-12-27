import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { ClaudeSessionProvider, SessionItem, getSessionId } from './ClaudeSessionProvider';
import { SessionFormProvider } from './SessionFormProvider';
import { initializeGitPath, execGit } from './gitService';

/**
 * Helper to get error message from unknown error type
 */
function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

const WORKTREE_FOLDER = '.worktrees';

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

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, "Claude Lanes" is now active!'); // Check Debug Console for this

    // Initialize git path from VS Code Git Extension (with fallback to 'git')
    await initializeGitPath();

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

    // DEBUG: Check if we found a workspace
    if (!workspaceRoot) {
        console.error("No workspace detected!");
    } else {
        console.log(`Workspace detected: ${workspaceRoot}`);
    }

    // Initialize Tree Data Provider
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot);
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
    sessionFormProvider.setOnSubmit(async (name: string, prompt: string, acceptanceCriteria: string) => {
        await createSession(name, prompt, acceptanceCriteria, workspaceRoot, sessionProvider);
    });

    // Watch for .claude-status file changes to refresh the sidebar
    if (workspaceRoot) {
        const statusWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, getStatusWatchPattern())
        );

        // Refresh on any status file change
        statusWatcher.onDidChange(() => sessionProvider.refresh());
        statusWatcher.onDidCreate(() => sessionProvider.refresh());
        statusWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(statusWatcher);

        // Also watch for features.json changes to refresh the sidebar
        const featuresWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, getFeaturesWatchPattern())
        );

        featuresWatcher.onDidChange(() => sessionProvider.refresh());
        featuresWatcher.onDidCreate(() => sessionProvider.refresh());
        featuresWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(featuresWatcher);

        // Also watch for .claude-session file changes to refresh the sidebar
        const sessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, getSessionWatchPattern())
        );

        sessionWatcher.onDidChange(() => sessionProvider.refresh());
        sessionWatcher.onDidCreate(() => sessionProvider.refresh());
        sessionWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(sessionWatcher);
    }

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
        await createSession(name, '', '', workspaceRoot, sessionProvider);
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

            // C. Remove Worktree
            if (workspaceRoot) {
                // --force is required if the worktree is not clean, but usually safe for temp agent work
                await execGit(['worktree', 'remove', item.worktreePath, '--force'], workspaceRoot);
            }

            // D. Refresh List
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

    context.subscriptions.push(createDisposable);
    context.subscriptions.push(openDisposable);
    context.subscriptions.push(deleteDisposable);
    context.subscriptions.push(setupHooksDisposable);
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
 * Sets up Claude hooks for status file updates in a worktree.
 * Merges with existing hooks without overwriting user configuration.
 * Uses atomic writes to prevent race conditions.
 */
async function setupStatusHooks(worktreePath: string): Promise<void> {
    const claudeDir = path.join(worktreePath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');
    const tempSettingsPath = path.join(claudeDir, `settings.json.${Date.now()}.tmp`);

    // Get configured paths for status and session files
    const statusRelPath = getRelativeFilePath('claudeStatusPath');
    const sessionRelPath = getRelativeFilePath('claudeSessionPath');

    // Ensure .claude directory exists
    await fsPromises.mkdir(claudeDir, { recursive: true });

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

    // Read existing settings or start fresh
    let settings: ClaudeSettings = {};
    try {
        const content = await fsPromises.readFile(settingsPath, 'utf-8');
        settings = JSON.parse(content);
    } catch (err) {
        // Check if file doesn't exist (that's ok) vs other errors
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            // File exists but is invalid JSON - warn user
            const answer = await vscode.window.showWarningMessage(
                'Existing .claude/settings.json is invalid. Overwrite?',
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
    const statusFilePath = `${statusRelPath}.claude-status`;
    const statusWriteWaiting = {
        type: 'command',
        command: `echo '{"status":"waiting_for_user"}' > ${statusFilePath}`
    };

    const statusWriteWorking = {
        type: 'command',
        command: `echo '{"status":"working"}' > ${statusFilePath}`
    };

    // Define our session ID capture hook with configured path
    // Session ID is provided via stdin as JSON: {"session_id": "...", ...}
    const sessionFilePath = `${sessionRelPath}.claude-session`;
    const sessionIdCapture = {
        type: 'command',
        command: `jq -r --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{sessionId: .session_id, timestamp: $ts}' > ${sessionFilePath}`
    };

    // Helper to check if our status hook already exists
    const statusHookExists = (entries: HookEntry[] | undefined): boolean => {
        if (!entries) {return false;}
        return entries.some(entry =>
            entry.hooks.some(h => h.command.includes('.claude-status'))
        );
    };

    // Helper to check if our session ID hook already exists
    const sessionHookExists = (entries: HookEntry[] | undefined): boolean => {
        if (!entries) {return false;}
        return entries.some(entry =>
            entry.hooks.some(h => h.command.includes('.claude-session'))
        );
    };

    // Add SessionStart hook (fires when Claude session starts = capture session ID)
    if (!settings.hooks.SessionStart) {
        settings.hooks.SessionStart = [];
    }
    if (!sessionHookExists(settings.hooks.SessionStart)) {
        settings.hooks.SessionStart.push({
            hooks: [sessionIdCapture]
        });
    }

    // Add Stop hook (fires when Claude finishes responding = waiting for user)
    if (!settings.hooks.Stop) {
        settings.hooks.Stop = [];
    }
    if (!statusHookExists(settings.hooks.Stop)) {
        settings.hooks.Stop.push({
            hooks: [statusWriteWaiting]
        });
    }

    // Add UserPromptSubmit hook (fires when user submits = Claude starts working)
    if (!settings.hooks.UserPromptSubmit) {
        settings.hooks.UserPromptSubmit = [];
    }
    if (!statusHookExists(settings.hooks.UserPromptSubmit)) {
        settings.hooks.UserPromptSubmit.push({
            hooks: [statusWriteWorking]
        });
    }

    // Add Notification hook for permission prompts (fires when Claude asks for permission)
    if (!settings.hooks.Notification) {
        settings.hooks.Notification = [];
    }
    if (!statusHookExists(settings.hooks.Notification)) {
        settings.hooks.Notification.push({
            matcher: 'permission_prompt',
            hooks: [statusWriteWaiting]
        });
    }

    // Add PreToolUse hook (fires before any tool = Claude is working)
    if (!settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = [];
    }
    if (!statusHookExists(settings.hooks.PreToolUse)) {
        settings.hooks.PreToolUse.push({
            matcher: '.*',
            hooks: [statusWriteWorking]
        });
    }

    // Write updated settings atomically (write to temp, then rename)
    await fsPromises.writeFile(tempSettingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    await fsPromises.rename(tempSettingsPath, settingsPath);
}

/**
 * Called when the extension is deactivated.
 * VS Code handles cleanup of subscriptions automatically,
 * but this export is provided for explicit resource cleanup if needed.
 */
export function deactivate(): void {
    // All disposables are cleaned up via context.subscriptions
}