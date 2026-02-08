import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import {
    ClaudeSessionProvider,
    SessionItem,
    getSessionId,
    getSessionChimeEnabled,
    setSessionChimeEnabled,
    clearSessionId,
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
    saveSessionWorkflow,
    getClaudeStatusPath,
    getClaudeSessionPath,
    getWorkflowStatus,
    getOrCreateTaskListId
} from './ClaudeSessionProvider';
import { SessionFormProvider, PermissionMode, isValidPermissionMode } from './SessionFormProvider';
import { initializeGitPath, execGit } from './gitService';
import { GitChangesPanel, OnBranchChangeCallback } from './GitChangesPanel';
import { PreviousSessionProvider, PreviousSessionItem, getPromptsDir } from './PreviousSessionProvider';
import { WorkflowsProvider } from './WorkflowsProvider';
import { discoverWorkflows, WorkflowMetadata, loadWorkflowTemplateFromString, WorkflowValidationError } from './workflow';
import { addProject, removeProject, clearCache as clearProjectManagerCache, initialize as initializeProjectManagerService } from './ProjectManagerService';
import * as BrokenWorktreeService from './services/BrokenWorktreeService';
import * as SettingsService from './services/SettingsService';
import * as DiffService from './services/DiffService';
import * as SessionService from './services/SessionService';
import { sanitizeSessionName as _sanitizeSessionName, getErrorMessage, validateBranchName, ValidationResult } from './utils';
import { validateSessionName } from './validation';
import { AsyncQueue } from './AsyncQueue';
import { LanesError, GitError, ValidationError } from './errors';
import { ClaudeCodeAgent, CodeAgent } from './codeAgents';
import { propagateLocalSettings, LocalSettingsPropagationMode } from './localSettings';
import type { PendingSessionConfig, ClearSessionConfig } from './types/extension';
// Use local reference for internal use
const sanitizeSessionName = _sanitizeSessionName;
const TERMINAL_CLOSE_DELAY_MS = 200; // Delay to ensure terminal is closed before reopening

// Session creation queue - now managed by SessionService
// Access via SessionService.getSessionCreationQueue()

// Track branches that have shown merge-base warnings (debounce to avoid spam)
const warnedMergeBaseBranches = SessionService.warnedMergeBaseBranches;

/**
 * Get the directory where MCP server writes pending session requests.
 * Uses the workspace's .lanes directory instead of the home directory.
 * @param repoRoot The root directory of the repository
 * @returns The path to the pending sessions directory
 */
function getPendingSessionsDir(repoRoot: string): string {
    return path.join(repoRoot, '.lanes', 'pending-sessions');
}

/**
 * Directory containing bundled workflow templates.
 * Located at extension root/workflows/ (from compiled code in out/, go up one level)
 */
const WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');

/**
 * Validate that a workflow exists and resolve it to a full path.
 * Accepts either a workflow name (e.g., 'copy-writer') or a full path to a YAML file.
 * Checks both built-in workflows (in WORKFLOWS_DIR) and custom workflows (in .lanes/workflows/).
 *
 * @param workflow The workflow name or path to validate
 * @param extensionPath The extension root path (for built-in workflows)
 * @param workspaceRoot The workspace root path (for custom workflows)
 * @returns Object with isValid flag, resolved path if valid, and available workflows if invalid
 */
async function validateWorkflow(
    workflow: string,
    extensionPath: string,
    workspaceRoot: string
): Promise<{ isValid: boolean; resolvedPath?: string; availableWorkflows: string[] }> {
    // If workflow is already an absolute path ending in .yaml, check if it exists
    if (path.isAbsolute(workflow) && workflow.endsWith('.yaml')) {
        try {
            await fsPromises.access(workflow, fs.constants.R_OK);
            return { isValid: true, resolvedPath: workflow, availableWorkflows: [] };
        } catch {
            // Path doesn't exist, fall through to name-based lookup
        }
    }

    // Discover all available workflows (built-in and custom)
    const allWorkflows = await discoverWorkflows({
        extensionPath,
        workspaceRoot
    });

    // Try to find the workflow by name (case-insensitive for convenience)
    const workflowLower = workflow.toLowerCase();
    const matchedWorkflow = allWorkflows.find(w => w.name.toLowerCase() === workflowLower);

    if (matchedWorkflow) {
        return { isValid: true, resolvedPath: matchedWorkflow.path, availableWorkflows: [] };
    }

    // Not found - return available workflow names for error message
    const availableWorkflows = allWorkflows.map(w => w.name);
    return { isValid: false, availableWorkflows };
}


// getPromptsDir is imported from PreviousSessionProvider.ts

// Re-export sanitizeSessionName from utils for backwards compatibility
export { sanitizeSessionName } from './utils';


/**
 * Process a pending session request from the MCP server.
 * Creates the session and opens the terminal, then deletes the config file.
 */
async function processPendingSession(
    configPath: string,
    workspaceRoot: string | undefined,
    extensionPath: string,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent
): Promise<void> {
    if (!workspaceRoot) {
        console.error('Cannot process pending session: no workspace root');
        return;
    }

    try {
        // Read and parse the config file
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: PendingSessionConfig = JSON.parse(configContent);

        console.log(`Processing pending session request: ${config.name}`);

        // Validate and resolve workflow if provided
        let resolvedWorkflowPath: string | null = null;
        if (config.workflow) {
            const { isValid, resolvedPath, availableWorkflows } = await validateWorkflow(
                config.workflow,
                extensionPath,
                workspaceRoot
            );
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
            resolvedWorkflowPath = resolvedPath || null;
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
            resolvedWorkflowPath, // workflow - resolved path to workflow YAML file
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
    extensionPath: string,
    sessionProvider: ClaudeSessionProvider,
    codeAgent?: CodeAgent
): Promise<void> {
    if (!workspaceRoot) {
        return;
    }

    try {
        const pendingSessionsDir = getPendingSessionsDir(workspaceRoot);
        // Ensure directory exists
        if (!fs.existsSync(pendingSessionsDir)) {
            return;
        }

        const files = await fsPromises.readdir(pendingSessionsDir);
        const jsonFiles = files.filter(f => f.endsWith('.json'));

        for (const file of jsonFiles) {
            const configPath = path.join(pendingSessionsDir, file);
            await processPendingSession(configPath, workspaceRoot, extensionPath, sessionProvider, codeAgent);
        }
    } catch (err) {
        console.error('Failed to check pending sessions:', err);
    }
}

/**
 * Process a pending session clear request from the MCP server.
 * Closes the existing terminal and opens a new one with fresh context.
 */
async function processClearRequest(
    configPath: string,
    codeAgent: CodeAgent,
    baseRepoPath: string | undefined,
    sessionProvider: ClaudeSessionProvider
): Promise<void> {
    try {
        // Read and parse the config file
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: ClearSessionConfig = JSON.parse(configContent);

        console.log(`Processing clear request for: ${config.worktreePath}`);

        // Delete the config file first to prevent re-processing
        await fsPromises.unlink(configPath);

        // Clear the session ID so the new terminal starts fresh instead of resuming
        clearSessionId(config.worktreePath);

        const sessionName = path.basename(config.worktreePath);
        const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

        // Find and close the existing terminal
        const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
        if (existingTerminal) {
            existingTerminal.dispose();
            // Brief delay to ensure terminal is closed
            await new Promise(resolve => setTimeout(resolve, TERMINAL_CLOSE_DELAY_MS));
        }

        // Open a new terminal with fresh session (skip workflow prompt for cleared sessions)
        await openClaudeTerminal(sessionName, config.worktreePath, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath, true);

        console.log(`Session cleared: ${sessionName}`);

    } catch (err) {
        console.error(`Failed to process clear request ${configPath}:`, err);
        // Try to delete the config file even on error to prevent infinite retries
        try {
            await fsPromises.unlink(configPath);
        } catch {
            // Ignore deletion errors
        }
        vscode.window.showErrorMessage(`Failed to clear session: ${getErrorMessage(err)}`);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, "Lanes" is now active!'); // Check Debug Console for this

    // Inject openClaudeTerminal into SessionService
    // This must be done early, before any session creation calls
    SessionService.setOpenClaudeTerminal(openClaudeTerminal);

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
    const baseRepoPath = workspaceRoot ? await SettingsService.getBaseRepoPath(workspaceRoot) : undefined;

    // Track if we're in a worktree - we'll use this to auto-resume session after setup
    const isInWorktree = baseRepoPath && baseRepoPath !== workspaceRoot;

    if (isInWorktree) {
        console.log(`Running in worktree. Base repo: ${baseRepoPath}`);
    }

    // Check for and offer to repair broken worktrees (e.g., after container rebuild)
    if (baseRepoPath) {
        // Run asynchronously to not block extension activation
        BrokenWorktreeService.checkAndRepairBrokenWorktrees(baseRepoPath).catch(err => {
            console.error('Lanes: Error checking for broken worktrees:', getErrorMessage(err));
        });
    }

    // Create the global code agent instance
    // This provides agent-specific behavior for terminal commands, file naming, etc.
    const codeAgent = new ClaudeCodeAgent();
    console.log(`Code agent initialized: ${codeAgent.displayName}`);

    // Initialize global storage context for session file storage
    // This must be done before creating the session provider
    initializeGlobalStorageContext(context.globalStorageUri, baseRepoPath, codeAgent, context);
    console.log(`Global storage initialized at: ${context.globalStorageUri.fsPath}`);

    // Initialize Tree Data Provider with the base repo path
    // This ensures sessions are always listed from the main repository
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot, baseRepoPath);
    const sessionTreeView = vscode.window.createTreeView('claudeSessionsView', {
        treeDataProvider: sessionProvider,
        showCollapseAll: false
    });
    context.subscriptions.push(sessionTreeView);
    context.subscriptions.push(sessionProvider);

    // Update chime and workflow context keys when session selection changes
    sessionTreeView.onDidChangeSelection(async (e) => {
        if (e.selection.length > 0) {
            const item = e.selection[0] as SessionItem;
            if (item.worktreePath) {
                const chimeEnabled = getSessionChimeEnabled(item.worktreePath);
                await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', chimeEnabled);

                // Set workflow context key to show/hide workflow button
                const workflowStatus = getWorkflowStatus(item.worktreePath);
                await vscode.commands.executeCommand('setContext', 'lanes.hasWorkflow', workflowStatus !== null);
            }
        }
    });

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
            new vscode.RelativePattern(watchPath, SettingsService.getStatusWatchPattern())
        );

        // Refresh on any status file change
        statusWatcher.onDidChange(() => sessionProvider.refresh());
        statusWatcher.onDidCreate(() => sessionProvider.refresh());
        statusWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(statusWatcher);

        // Also watch for .claude-session file changes to refresh the sidebar
        const sessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, SettingsService.getSessionWatchPattern())
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

        // Refresh on any status file change
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
        const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.lanes/workflows');
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
        const customWorkflowsFolder = vscode.workspace.getConfiguration('lanes').get<string>('customWorkflowsFolder', '.lanes/workflows');
        const customWorkflowsWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(watchPath, `${customWorkflowsFolder}/*.yaml`)
        );

        customWorkflowsWatcher.onDidChange(() => workflowsProvider.refresh());
        customWorkflowsWatcher.onDidCreate(() => workflowsProvider.refresh());
        customWorkflowsWatcher.onDidDelete(() => workflowsProvider.refresh());

        context.subscriptions.push(customWorkflowsWatcher);
    }

    // Watch for pending session requests from MCP
    if (baseRepoPath) {
        const pendingSessionsDir = getPendingSessionsDir(baseRepoPath);
        // Ensure the directory exists for the watcher
        if (!fs.existsSync(pendingSessionsDir)) {
            fs.mkdirSync(pendingSessionsDir, { recursive: true });
        }

        const pendingSessionWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(pendingSessionsDir, '*.json')
        );

        pendingSessionWatcher.onDidCreate(async (uri) => {
            console.log(`Pending session file detected: ${uri.fsPath}`);
            await processPendingSession(uri.fsPath, baseRepoPath, context.extensionPath, sessionProvider, codeAgent);
        });

        context.subscriptions.push(pendingSessionWatcher);

        // Check for any pending sessions on startup
        checkPendingSessions(baseRepoPath, context.extensionPath, sessionProvider, codeAgent);
    }

    // Watch for session clear requests from MCP
    if (baseRepoPath) {
        const clearRequestsDir = path.join(baseRepoPath, '.lanes', 'clear-requests');
        // Ensure the directory exists for the watcher
        if (!fs.existsSync(clearRequestsDir)) {
            fs.mkdirSync(clearRequestsDir, { recursive: true });
        }

        const clearRequestWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(clearRequestsDir, '*.json')
        );

        clearRequestWatcher.onDidCreate(async (uri) => {
            console.log(`Clear request file detected: ${uri.fsPath}`);
            await processClearRequest(uri.fsPath, codeAgent, baseRepoPath, sessionProvider);
        });

        context.subscriptions.push(clearRequestWatcher);
    }

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
                                        await SettingsService.getOrCreateExtensionSettingsFile(worktreePath);
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
        await openClaudeTerminal(item.label, item.worktreePath, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath);
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
            let userMessage = 'Failed to delete session.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to delete: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
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
            const settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(item.worktreePath);
            vscode.window.showInformationMessage(`Status hooks configured for '${item.label}' at ${settingsPath}`);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to setup hooks: ${getErrorMessage(err)}`);
        }
    });

    // 6. Register SHOW GIT CHANGES Command
    // Helper function to generate diff content for a worktree
    async function generateDiffContent(worktreePath: string, baseBranch: string): Promise<string> {
        return DiffService.generateDiffContent(worktreePath, baseBranch, warnedMergeBaseBranches);
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
                actualBranch = await DiffService.getBaseBranch(worktreePath);
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
                    actualBranch = await DiffService.getBaseBranch(worktreePath);
                }
            }

            // Generate new diff content
            const diffContent = await generateDiffContent(worktreePath, actualBranch);

            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage(`No changes found when comparing to '${actualBranch}'.`);
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

        // Validate branch name before Git operations
        const branchValidation = validateBranchName(item.label);
        if (!branchValidation.valid) {
            vscode.window.showErrorMessage(branchValidation.error || `Branch '${item.label}' contains invalid characters. Cannot view changes.`);
            return;
        }

        try {
            // Determine the base branch (main or master)
            const baseBranch = await DiffService.getBaseBranch(item.worktreePath);

            // Generate the diff content
            const diffContent = await generateDiffContent(item.worktreePath, baseBranch);

            // Check if there are any changes
            if (!diffContent || diffContent.trim() === '') {
                vscode.window.showInformationMessage(`No changes found when comparing to '${baseBranch}'.`);
                return;
            }

            // Open the GitChangesPanel with the diff content, worktree path, and base branch
            GitChangesPanel.createOrShow(context.extensionUri, item.label, diffContent, item.worktreePath, baseBranch);
        } catch (err) {
            let userMessage = 'Failed to get git changes.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to get git changes: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
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
                const repoName = SettingsService.getRepoName(baseRepoPath).replace(/[<>:"/\\|?*]/g, '_');
                const projectName = `${repoName}-${item.label}`;
                await addProject(projectName, item.worktreePath, ['lanes']);
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

    // 11. Register REPAIR BROKEN WORKTREES Command
    const repairBrokenWorktreesDisposable = vscode.commands.registerCommand('lanes.repairBrokenWorktrees', async () => {
        if (!baseRepoPath) {
            vscode.window.showErrorMessage('No workspace folder open');
            return;
        }
        await BrokenWorktreeService.checkAndRepairBrokenWorktrees(baseRepoPath);
    });
    context.subscriptions.push(repairBrokenWorktreesDisposable);

    // 12. Register PLAY CHIME Command (internal command for playing chime sound)
    const playChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.playChime', () => {
        sessionFormProvider.playChime();
    });
    context.subscriptions.push(playChimeDisposable);

    // 13. Register TEST CHIME Command (for debugging)
    const testChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.testChime', async () => {
        try {
            sessionFormProvider.playChime();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to test chime: ${getErrorMessage(err)}`);
        }
    });
    context.subscriptions.push(testChimeDisposable);

    // 14. Register ENABLE CHIME Command
    const enableChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.enableChime', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to enable chime.');
            return;
        }

        try {
            setSessionChimeEnabled(item.worktreePath, true);
            // Update context key so menu items update immediately
            await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', true);
            vscode.window.showInformationMessage(`Chime enabled for session '${item.label}'`);
            sessionProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to enable chime: ${getErrorMessage(err)}`);
        }
    });
    context.subscriptions.push(enableChimeDisposable);

    // 14b. Register DISABLE CHIME Command
    const disableChimeDisposable = vscode.commands.registerCommand('claudeWorktrees.disableChime', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please right-click on a session to disable chime.');
            return;
        }

        try {
            setSessionChimeEnabled(item.worktreePath, false);
            // Update context key so menu items update immediately
            await vscode.commands.executeCommand('setContext', 'lanes.chimeEnabled', false);
            vscode.window.showInformationMessage(`Chime disabled for session '${item.label}'`);
            sessionProvider.refresh();
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to disable chime: ${getErrorMessage(err)}`);
        }
    });
    context.subscriptions.push(disableChimeDisposable);

    // 15. Register CLEAR SESSION Command
    const clearSessionDisposable = vscode.commands.registerCommand('claudeWorktrees.clearSession', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to clear it.');
            return;
        }

        try {
            const sessionName = path.basename(item.worktreePath);
            // Use consistent terminal name logic
            const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

            // Clear the session ID so the new terminal starts fresh instead of resuming
            clearSessionId(item.worktreePath);

            // Find and close the existing terminal
            const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
            if (existingTerminal) {
                existingTerminal.dispose();
                // Brief delay to ensure terminal is closed
                await new Promise(resolve => setTimeout(resolve, TERMINAL_CLOSE_DELAY_MS));
            }

            // Open a new terminal with fresh session (skip workflow prompt for cleared sessions)
            await openClaudeTerminal(sessionName, item.worktreePath, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath, true);

            vscode.window.showInformationMessage(`Session '${sessionName}' cleared with fresh context.`);
        } catch (err) {
            let userMessage = 'Failed to clear session.';
            if (err instanceof GitError) {
                userMessage = err.userMessage;
            } else if (err instanceof ValidationError) {
                userMessage = err.userMessage;
            } else if (err instanceof LanesError) {
                userMessage = err.userMessage;
            } else {
                userMessage = `Failed to clear session: ${getErrorMessage(err)}`;
            }
            vscode.window.showErrorMessage(userMessage);
        }
    });
    context.subscriptions.push(clearSessionDisposable);

    // 16. Register CREATE TERMINAL Command
    const createTerminalDisposable = vscode.commands.registerCommand('claudeWorktrees.createTerminal', async (item: SessionItem) => {
        if (!item) {
            return;
        }

        await createTerminalForSession(item);
    });
    context.subscriptions.push(createTerminalDisposable);

    // 17. Register SEARCH IN WORKTREE Command
    const searchInWorktreeDisposable = vscode.commands.registerCommand('claudeWorktrees.searchInWorktree', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            return;
        }

        // Verify worktree exists
        if (!fs.existsSync(item.worktreePath)) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        try {
            // Get the worktrees folder and session name to build relative path pattern
            const worktreesFolder = getWorktreesFolder();
            const sessionName = path.basename(item.worktreePath);

            // Build the files to include pattern relative to repo root
            // This pattern tells VS Code search to only look in this worktree
            const filesToInclude = `${worktreesFolder}/${sessionName}/**`;

            // Open VS Code's search panel with the scoped pattern
            await vscode.commands.executeCommand('workbench.action.findInFiles', {
                query: '',
                filesToInclude: filesToInclude,
            });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open search in worktree: ${getErrorMessage(err)}`);
        }
    });
    context.subscriptions.push(searchInWorktreeDisposable);

    // 18. Register OPEN WORKFLOW STATE Command
    const openWorkflowStateDisposable = vscode.commands.registerCommand('claudeWorktrees.openWorkflowState', async (item: SessionItem) => {
        if (!item || !item.worktreePath) {
            vscode.window.showErrorMessage('Please select a session to open workflow state.');
            return;
        }

        // Verify the worktree path exists (consistent with showGitChanges)
        if (!fs.existsSync(item.worktreePath)) {
            vscode.window.showErrorMessage(`Worktree path does not exist: ${item.worktreePath}`);
            return;
        }

        // Validate that the workflow state path stays within the worktree
        const workflowStatePath = path.join(item.worktreePath, 'workflow-state.json');
        const resolvedPath = path.resolve(workflowStatePath);
        const resolvedWorktreePath = path.resolve(item.worktreePath);

        // Ensure the workflow-state.json is inside the worktree (security check)
        if (!resolvedPath.startsWith(resolvedWorktreePath)) {
            vscode.window.showErrorMessage('Invalid workflow state path');
            return;
        }

        try {
            // Check if the file exists
            if (!fs.existsSync(workflowStatePath)) {
                vscode.window.showInformationMessage(`No active workflow for session '${item.label}'. The workflow state file is created when a workflow is started.`);
                return;
            }

            // Open the file in the editor
            const document = await vscode.workspace.openTextDocument(workflowStatePath);
            await vscode.window.showTextDocument(document, { preview: false });
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to open workflow state: ${getErrorMessage(err)}`);
        }
    });
    context.subscriptions.push(openWorkflowStateDisposable);

    // Auto-resume Claude session when opened in a worktree with an existing session
    if (isInWorktree && workspaceRoot) {
        const sessionData = getSessionId(workspaceRoot);
        if (sessionData?.sessionId) {
            const sessionName = path.basename(workspaceRoot);
            // Brief delay to ensure VS Code is fully ready
            setTimeout(() => {
                openClaudeTerminal(sessionName, workspaceRoot, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath);
            }, 500);
        }
    }

    // Initial refresh to ensure tree view shows current state after activation/reload
    sessionProvider.refresh();
}

/**
 * Creates a new Claude session with optional starting prompt and acceptance criteria.
 * @deprecated Import from SessionService instead
 */
export const createSession = SessionService.createSession;

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
function getWorkflowOrchestratorInstructions(workflow?: string | null): string {
    return `You are the main agent following a structured workflow. Your goal is to successfully complete the workflow which guides you through the work requested by your user.
To be successfull you must follow the workflow and follow these instructions carefully.

## CRITICAL RULES

1. **Always check workflow_status first** to see your current step
2. **For tasks/steps which specify a agent or subagent**, spawn sub-agents using the Task tool to do the task even if you think you can do it yourself
3. **Call workflow_advance** after completing each step
4. **Never skip steps** - complete each one before advancing
5. **Only perform actions for the CURRENT step** - do NOT call workflow tools that belong to future steps. If you are unsure about a parameter value (like a loop name), read the workflow file (${workflow}) or wait for the step that provides that information instead of guessing.
6. **Do NOT call workflow_set_tasks unless instructed to do so in the step instructions**
7. **Do not play the role of a specified agent** - always spawn the required agent using the Task tool

## Workflow

1. Call workflow_start to begin the workflow
2. In workflow: follow instructions for each step and only that step at the end of each step call workflow_advance to move to the next step
3. When complete: review all work and commit if approved

## Sub-Agent Spawning

When the current step requires an agent/subagent other than orchestrator:
- Use the Task tool to spawn a sub-agent, make sure it knows it should NOT call workflow_advance
- Wait for the sub-agent to complete
- YOU should call workflow_advance with a summary

---

## User Request

`;
}

/**
 * Count existing terminals for a session to determine the next terminal number.
 * Counts terminals matching the pattern "{sessionName} [n]" where n is a number.
 * @param sessionName The session name to count terminals for
 * @returns The highest terminal number found, or 0 if none exist
 */
function countTerminalsForSession(sessionName: string): number {
    // Escape special regex characters in the session name
    const escapedName = sessionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedName} \\[(\\d+)\\]$`);

    const numbers: number[] = [];
    for (const terminal of vscode.window.terminals) {
        const match = terminal.name.match(pattern);
        if (match) {
            numbers.push(parseInt(match[1], 10));
        }
    }

    return numbers.length > 0 ? Math.max(...numbers) : 0;
}

/**
 * Create a new plain shell terminal for a session.
 * The terminal is named "{sessionName} [n]" where n is the terminal count.
 * @param item The SessionItem to create a terminal for
 */
async function createTerminalForSession(item: SessionItem): Promise<void> {
    // Validate worktree path
    if (!item.worktreePath) {
        vscode.window.showErrorMessage("Cannot determine worktree path for this session");
        return;
    }

    const worktreePath = item.worktreePath;
    const sessionName = item.label;

    // Verify worktree exists
    if (!fs.existsSync(worktreePath)) {
        vscode.window.showErrorMessage(`Worktree path does not exist: ${worktreePath}`);
        return;
    }

    try {
        // Count existing terminals for this session
        const terminalCount = countTerminalsForSession(sessionName);
        const nextNumber = terminalCount + 1;

        // Create terminal with incremented name
        const terminalName = `${sessionName} [${nextNumber}]`;
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            cwd: worktreePath,
            iconPath: new vscode.ThemeIcon('terminal')
        });

        terminal.show();
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to create terminal: ${getErrorMessage(err)}`);
    }
}

// THE CORE FUNCTION: Manages the Terminal Tabs
async function openClaudeTerminal(taskName: string, worktreePath: string, prompt?: string, acceptanceCriteria?: string, permissionMode?: PermissionMode, workflow?: string | null, codeAgent?: CodeAgent, repoRoot?: string, skipWorkflowPrompt?: boolean): Promise<void> {
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

    // Get or create a unique task list ID for this session
    const taskListId = getOrCreateTaskListId(worktreePath, taskName);

    const terminal = vscode.window.createTerminal({
        name: terminalName,      // <--- This sets the tab name in the UI
        cwd: worktreePath,       // <--- Starts shell directly inside the isolated worktree
        iconPath: new vscode.ThemeIcon(iconConfig.id), // Terminal icon
        color: iconConfig.color ? new vscode.ThemeColor(iconConfig.color) : new vscode.ThemeColor('terminal.ansiGreen'), // Color code the tab
        env: { CLAUDE_CODE_TASK_LIST_ID: taskListId } // Enable Claude Code task persistence with unique ID
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
        settingsPath = await SettingsService.getOrCreateExtensionSettingsFile(worktreePath, workflow, codeAgent);

        // If workflow is active (provided or restored), add MCP config flag separately
        // (--settings only loads hooks, not mcpServers)
        // effectiveWorkflow is now the full path to the workflow YAML file
        if (effectiveWorkflow) {
            // Determine the repo root for MCP server (needed for pending sessions directory)
            const effectiveRepoRoot = repoRoot || await SettingsService.getBaseRepoPath(worktreePath);

            // Use CodeAgent to get MCP config if available and supported
            if (codeAgent && codeAgent.supportsMcp()) {
                const mcpConfig = codeAgent.getMcpConfig(worktreePath, effectiveWorkflow, effectiveRepoRoot);
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
                            args: [mcpServerPath, '--worktree', worktreePath, '--workflow-path', effectiveWorkflow, '--repo-root', effectiveRepoRoot]
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
            // User provided a prompt - prepend orchestrator instructions
            combinedPrompt = getWorkflowOrchestratorInstructions(workflow) + combinedPrompt;
        } else if (workflow && skipWorkflowPrompt) {
            // Cleared session with workflow - add resume prompt
            combinedPrompt = getWorkflowOrchestratorInstructions(workflow) + `This is a Lanes workflow session that has been cleared.

To resume your work:
1. Call workflow_status to check the current state of the workflow
2. Review any artifacts from the previous session to understand what was completed
3. Continue with the next steps in the workflow

Proceed with resuming the workflow from where it left off.`;
        } else if (workflow) {
            // New workflow session without user prompt - add start prompt
            combinedPrompt = getWorkflowOrchestratorInstructions(workflow) + 'Start the workflow and follow the steps.';
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
 * Get a set of branch names that are currently checked out in worktrees.
 * @deprecated Import from SessionService instead
 * @param cwd The working directory (git repo root)
 * @returns A Set of branch names currently in use by worktrees
 */
export const getBranchesInWorktrees = SessionService.getBranchesInWorktrees;


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
    const customWorkflowsFolder = config.get<string>('customWorkflowsFolder', '.lanes/workflows');

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
        let userMessage = 'Failed to create workflow file.';
        if (err instanceof GitError) {
            userMessage = err.userMessage;
        } else if (err instanceof ValidationError) {
            userMessage = err.userMessage;
        } else if (err instanceof LanesError) {
            userMessage = err.userMessage;
        } else {
            userMessage = `Failed to create workflow file: ${getErrorMessage(err)}`;
        }
        vscode.window.showErrorMessage(userMessage);
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

// ============================================================================
// BACKWARDS COMPATIBILITY RE-EXPORTS
// These re-exports are deprecated. Import from the respective service modules.
// ============================================================================

/**
 * @deprecated Import from './services/BrokenWorktreeService' instead
 */
export type { BrokenWorktree } from './services/BrokenWorktreeService';

/**
 * @deprecated Import from './services/BrokenWorktreeService' instead
 */
export { detectBrokenWorktrees, repairWorktree, branchExists, checkAndRepairBrokenWorktrees } from './services/BrokenWorktreeService';

/**
 * @deprecated Import from './services/SettingsService' instead
 */
export { getBaseRepoPath, getRepoName, getOrCreateExtensionSettingsFile } from './services/SettingsService';

/**
 * @deprecated Import from './services/DiffService' instead
 */
export { parseUntrackedFiles, isBinaryContent, synthesizeUntrackedFileDiff, getBaseBranch } from './services/DiffService';

/**
 * Called when the extension is deactivated.
 * VS Code handles cleanup of subscriptions automatically,
 * but we also clear cached references to other extensions.
 */
export function deactivate(): void {
    // Clear Project Manager cache to avoid stale references
    clearProjectManagerCache();
}