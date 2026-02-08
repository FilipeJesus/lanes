import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { CodeAgent, SessionData, AgentStatus } from './codeAgents';
import { validateWorktreesFolder } from './validation';

// Valid Claude status states
export type ClaudeStatusState = 'working' | 'waiting_for_user' | 'idle' | 'error';

// Status from .claude-status file
export interface ClaudeStatus {
    status: ClaudeStatusState;
    timestamp?: string;
    message?: string;
}

// Valid status values for validation
const VALID_STATUS_VALUES: ClaudeStatusState[] = ['working', 'waiting_for_user', 'idle', 'error'];

/**
 * Fixed path for non-global session storage (relative to repo root)
 */
const NON_GLOBAL_SESSION_PATH = '.lanes/session_management';

// Global storage context - set during extension activation
let globalStorageUri: vscode.Uri | undefined;
let baseRepoPathForStorage: string | undefined;
let globalCodeAgent: CodeAgent | undefined;
let globalExtensionContext: vscode.ExtensionContext | undefined;

// Track previous icon state per session to detect transitions
const previousIconState = new Map<string, string>();

/**
 * Initialize the global storage context.
 * Must be called during extension activation.
 * @param storageUri The globalStorageUri from the extension context
 * @param baseRepoPath The base repository path for generating unique identifiers
 * @param codeAgent Optional CodeAgent instance for agent-specific behavior
 * @param context The extension context for accessing resources like audio files
 */
export function initializeGlobalStorageContext(storageUri: vscode.Uri, baseRepoPath?: string, codeAgent?: CodeAgent, context?: vscode.ExtensionContext): void {
    globalStorageUri = storageUri;
    baseRepoPathForStorage = baseRepoPath;
    globalCodeAgent = codeAgent;
    globalExtensionContext = context;
}

/**
 * Get the global storage URI. Returns undefined if not initialized.
 */
export function getGlobalStorageUri(): vscode.Uri | undefined {
    return globalStorageUri;
}

/**
 * Get the base repo path for storage. Returns undefined if not set.
 */
export function getBaseRepoPathForStorage(): string | undefined {
    return baseRepoPathForStorage;
}

/**
 * Get the global CodeAgent instance. Returns undefined if not set.
 */
export function getGlobalCodeAgent(): CodeAgent | undefined {
    return globalCodeAgent;
}

/**
 * Generate a unique identifier for a repository.
 * Uses a hash of the normalized absolute path to ensure uniqueness across repos.
 * @param repoPath The absolute path to the repository
 * @returns A unique identifier string (8-character hash + repo name)
 */
export function getRepoIdentifier(repoPath: string): string {
    // Normalize the path for cross-platform consistency
    const normalizedPath = path.normalize(repoPath).toLowerCase();

    // Create a short hash of the full path for uniqueness
    const hash = crypto.createHash('sha256')
        .update(normalizedPath)
        .digest('hex')
        .substring(0, 8);

    // Get the repo folder name (sanitized)
    const repoName = path.basename(repoPath).replace(/[^a-zA-Z0-9_-]/g, '_');

    // Combine for a readable yet unique identifier
    return `${repoName}-${hash}`;
}

/**
 * Get the session name from a worktree path.
 * The session name is the last component of the worktree path.
 * @param worktreePath Path to the worktree
 * @returns The session name
 */
export function getSessionNameFromWorktree(worktreePath: string): string {
    return path.basename(worktreePath);
}

/**
 * Get the path for storing a session's prompt file.
 *
 * By default (when promptsFolder setting is empty), stores in global storage:
 *   globalStorageUri/<repoIdentifier>/prompts/<sessionName>.txt
 *
 * When user specifies promptsFolder setting, stores repo-relative:
 *   <repoRoot>/<promptsFolder>/<sessionName>.txt
 *
 * Fallback chain:
 * 1. User-specified promptsFolder (if valid) -> repo-relative storage
 * 2. Global storage (if initialized) -> extension storage
 * 3. Legacy default (.lanes) -> repo-relative fallback
 *
 * Security: Validates both sessionName and user-provided paths to prevent directory traversal.
 *
 * @param sessionName The name of the session (used as filename)
 * @param repoRoot The repository root path (for repo-relative storage)
 * @returns Object with path and directory to create, or null if sessionName is invalid
 */
export function getPromptsPath(sessionName: string, repoRoot: string): { path: string; needsDir: string } | null {
    // Security: Validate sessionName to prevent path traversal
    if (!sessionName || sessionName.includes('..') || sessionName.includes('/') || sessionName.includes('\\')) {
        console.warn('Lanes: Invalid session name for prompts path');
        return null;
    }

    const config = vscode.workspace.getConfiguration('lanes');
    const promptsFolder = config.get<string>('promptsFolder', '');

    // If user has specified a promptsFolder, use repo-relative storage
    if (promptsFolder && promptsFolder.trim()) {
        const trimmedFolder = promptsFolder.trim()
            .replace(/\\/g, '/') // Normalize backslashes
            .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

        // Security: Reject empty result after normalization
        if (!trimmedFolder) {
            // Fall through to global storage
        }
        // Security: Reject absolute paths
        else if (path.isAbsolute(trimmedFolder)) {
            console.warn('Lanes: Absolute paths not allowed in promptsFolder. Using global storage.');
            // Fall through to global storage
        }
        // Security: Reject parent directory traversal
        else if (trimmedFolder.includes('..')) {
            console.warn('Lanes: Invalid promptsFolder path (contains ..). Using global storage.');
            // Fall through to global storage
        }
        else {
            // Valid user-specified path - use repo-relative storage
            const promptsDir = path.join(repoRoot, trimmedFolder);
            const promptFilePath = path.join(promptsDir, `${sessionName}.txt`);
            return { path: promptFilePath, needsDir: promptsDir };
        }
    }

    // Default: Use global storage
    if (!globalStorageUri || !baseRepoPathForStorage) {
        // Global storage not initialized - fall back to legacy default
        console.warn('Lanes: Global storage not initialized. Using legacy prompts location (.lanes).');
        const legacyDir = path.join(repoRoot, '.lanes');
        const legacyPath = path.join(legacyDir, `${sessionName}.txt`);
        return { path: legacyPath, needsDir: legacyDir };
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const promptsDir = path.join(globalStorageUri.fsPath, repoIdentifier, 'prompts');
    const promptFilePath = path.join(promptsDir, `${sessionName}.txt`);

    return { path: promptFilePath, needsDir: promptsDir };
}

/**
 * Get the global storage path for a specific file.
 * Structure: globalStorageUri/<repo-identifier>/<session-name>/<filename>
 * @param worktreePath The worktree path (used to derive session name and repo path)
 * @param filename The filename (e.g., '.claude-status', 'workflow-state.json')
 * @returns The absolute path to the file in global storage, or null if global storage not initialized
 */
export function getGlobalStoragePath(worktreePath: string, filename: string): string | null {
    if (!globalStorageUri || !baseRepoPathForStorage) {
        return null;
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPathForStorage);
    const sessionName = getSessionNameFromWorktree(worktreePath);

    return path.join(globalStorageUri.fsPath, repoIdentifier, sessionName, filename);
}

/**
 * Check if global storage is enabled in configuration.
 * @returns true if useGlobalStorage is enabled, false otherwise
 */
export function isGlobalStorageEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('lanes');
    return config.get<boolean>('useGlobalStorage', true);
}

/**
 * Get the configured worktrees folder name.
 * Security: Validates path to prevent directory traversal using centralized validator.
 * @returns The worktrees folder name (default: '.worktrees')
 */
export function getWorktreesFolder(): string {
    const config = vscode.workspace.getConfiguration('lanes');
    const folder = config.get<string>('worktreesFolder', '.worktrees');

    // Use centralized validator for consistency and security
    const validation = validateWorktreesFolder(folder);
    if (!validation.valid) {
        console.warn(`Lanes: Invalid worktreesFolder configuration: ${validation.error}. Using default.`);
        return '.worktrees';
    }

    // Normalization for path handling (remove leading/trailing slashes, normalize backslashes)
    const trimmedFolder = folder.trim()
        .replace(/\\/g, '/')
        .replace(/^\/+|\/+$/g, '');

    // Final safety check - return default if normalization results in empty
    if (!trimmedFolder) {
        return '.worktrees';
    }

    return trimmedFolder;
}

/**
 * Get the configured path for .claude-session file relative to a worktree.
 * Returns the full path to the .claude-session file.
 * If global storage is enabled, returns the path in global storage.
 * If global storage is disabled, returns the path in .lanes/session_management/.
 * @param worktreePath Path to the worktree directory
 * @returns Full path to .claude-session based on configuration
 */
export function getClaudeSessionPath(worktreePath: string): string {
    // Determine the session file name
    const sessionFileName = globalCodeAgent?.getSessionFileName() || '.claude-session';

    // Check if global storage is enabled
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, sessionFileName);
        if (globalPath) {
            return globalPath;
        }
        // Fall back to non-global path if global storage not initialized
    }

    // Non-global mode: use fixed .lanes/session_management path
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, sessionFileName);
}

/**
 * Get the configured path for .claude-status file relative to a worktree.
 * Returns the full path to the .claude-status file.
 * If global storage is enabled, returns the path in global storage.
 * If global storage is disabled, returns the path in .lanes/session_management/.
 * @param worktreePath Path to the worktree directory
 * @returns Full path to .claude-status based on configuration
 */
export function getClaudeStatusPath(worktreePath: string): string {
    // Determine the status file name
    const statusFileName = globalCodeAgent?.getStatusFileName() || '.claude-status';

    // Check if global storage is enabled
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, statusFileName);
        if (globalPath) {
            return globalPath;
        }
        // Fall back to non-global path if global storage not initialized
    }

    // Non-global mode: use fixed .lanes/session_management path
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, statusFileName);
}

// Session data from .claude-session file
export interface ClaudeSessionData {
    sessionId: string;
    timestamp?: string;
    workflow?: string;
    isChimeEnabled?: boolean;
    taskListId?: string;
}

/**
 * Save workflow metadata to the .claude-session file.
 * This pre-writes the workflow before Claude starts, which will be preserved
 * when the SessionStart hook merges in the sessionId.
 * @param worktreePath Path to the worktree directory
 * @param workflow The workflow template name
 */
export function saveSessionWorkflow(worktreePath: string, workflow: string): void {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        // Ensure directory exists
        const dir = path.dirname(sessionPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Read existing data if present
        let existingData: Record<string, unknown> = {};
        if (fs.existsSync(sessionPath)) {
            try {
                const content = fs.readFileSync(sessionPath, 'utf-8');
                existingData = JSON.parse(content);
            } catch {
                // Ignore parse errors, start fresh
            }
        }

        // Merge workflow into existing data
        const mergedData = { ...existingData, workflow };
        fs.writeFileSync(sessionPath, JSON.stringify(mergedData, null, 2), 'utf-8');
    } catch (err) {
        console.warn('Lanes: Failed to save session workflow:', err);
    }
}

/**
 * Get the workflow from a worktree's .claude-session file
 * @param worktreePath Path to the worktree directory
 * @returns The workflow name if present, null otherwise
 */
export function getSessionWorkflow(worktreePath: string): string | null {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        if (!fs.existsSync(sessionPath)) {
            return null;
        }

        const content = fs.readFileSync(sessionPath, 'utf-8');
        const data = JSON.parse(content);

        if (typeof data.workflow === 'string' && data.workflow.trim() !== '') {
            return data.workflow;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Get the chime enabled preference from a worktree's .claude-session file
 * @param worktreePath Path to the worktree directory
 * @returns true if chime is enabled, false otherwise (defaults to false)
 */
export function getSessionChimeEnabled(worktreePath: string): boolean {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        if (!fs.existsSync(sessionPath)) {
            return false;
        }

        const content = fs.readFileSync(sessionPath, 'utf-8');
        const data = JSON.parse(content);

        // Default to false if property doesn't exist
        if (typeof data.isChimeEnabled === 'boolean') {
            return data.isChimeEnabled;
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Set the chime enabled preference for a worktree's .claude-session file
 * Preserves existing session data (sessionId, timestamp, workflow)
 * @param worktreePath Path to the worktree directory
 * @param enabled Whether chime should be enabled
 */
export function setSessionChimeEnabled(worktreePath: string, enabled: boolean): void {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        // Ensure directory exists
        const dir = path.dirname(sessionPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Read existing data if present
        let existingData: Record<string, unknown> = {};
        if (fs.existsSync(sessionPath)) {
            try {
                const content = fs.readFileSync(sessionPath, 'utf-8');
                existingData = JSON.parse(content);
            } catch {
                // Ignore parse errors, start fresh
            }
        }

        // Merge isChimeEnabled into existing data
        const mergedData = { ...existingData, isChimeEnabled: enabled };
        fs.writeFileSync(sessionPath, JSON.stringify(mergedData, null, 2), 'utf-8');
    } catch (err) {
        console.warn('Lanes: Failed to set session chime preference:', err);
    }
}

/**
 * Get the Claude status from a worktree's .claude-status file
 * @param worktreePath Path to the worktree directory
 * @returns ClaudeStatus if valid file exists, null otherwise
 */
export function getClaudeStatus(worktreePath: string): ClaudeStatus | null {
    const statusPath = getClaudeStatusPath(worktreePath);

    try {
        if (!fs.existsSync(statusPath)) {
            return null;
        }

        const content = fs.readFileSync(statusPath, 'utf-8');

        // Use CodeAgent parsing if available
        if (globalCodeAgent) {
            const agentStatus = globalCodeAgent.parseStatus(content);
            if (!agentStatus) {
                return null;
            }

            // Validate status against agent's valid states
            const validStates = globalCodeAgent.getValidStatusStates();
            if (!validStates.includes(agentStatus.status)) {
                return null;
            }

            // Convert AgentStatus to ClaudeStatus
            return {
                status: agentStatus.status as ClaudeStatusState,
                timestamp: agentStatus.timestamp,
                message: agentStatus.message
            };
        }

        // Fallback to hardcoded Claude behavior
        const data = JSON.parse(content);

        // Validate status field exists and is a valid value
        if (!data.status || !VALID_STATUS_VALUES.includes(data.status)) {
            return null;
        }

        return {
            status: data.status as ClaudeStatusState,
            timestamp: data.timestamp,
            message: data.message
        };
    } catch {
        // Graceful fallback for any error (invalid JSON, read error, etc.)
        return null;
    }
}

/**
 * Get the Claude session ID from a worktree's .claude-session file
 * @param worktreePath Path to the worktree directory
 * @returns ClaudeSessionData if valid file exists, null otherwise
 */
export function getSessionId(worktreePath: string): ClaudeSessionData | null {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        if (!fs.existsSync(sessionPath)) {
            return null;
        }

        const content = fs.readFileSync(sessionPath, 'utf-8');

        // Use CodeAgent parsing if available
        if (globalCodeAgent) {
            const sessionData = globalCodeAgent.parseSessionData(content);
            if (!sessionData) {
                return null;
            }

            // Convert SessionData to ClaudeSessionData
            return {
                sessionId: sessionData.sessionId,
                timestamp: sessionData.timestamp,
                workflow: sessionData.workflow,
                isChimeEnabled: sessionData.isChimeEnabled
            };
        }

        // Fallback to hardcoded Claude behavior
        const data = JSON.parse(content);

        // Validate sessionId field exists and is a non-empty string
        if (!data.sessionId || typeof data.sessionId !== 'string' || data.sessionId.trim() === '') {
            return null;
        }

        // Validate session ID format to prevent command injection
        // Claude session IDs are alphanumeric with hyphens and underscores
        const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
        if (!SESSION_ID_PATTERN.test(data.sessionId)) {
            return null;
        }

        return {
            sessionId: data.sessionId,
            timestamp: data.timestamp,
            workflow: data.workflow,
            isChimeEnabled: data.isChimeEnabled
        };
    } catch {
        // Graceful fallback for any error (invalid JSON, read error, etc.)
        return null;
    }
}

/**
 * Clear the Claude session ID from a worktree's .claude-session file.
 * This preserves workflow and user preferences like isChimeEnabled, only removing the sessionId.
 * @param worktreePath Path to the worktree directory
 */
export function clearSessionId(worktreePath: string): void {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        if (!fs.existsSync(sessionPath)) {
            return; // Nothing to clear
        }

        const content = fs.readFileSync(sessionPath, 'utf-8');
        const data = JSON.parse(content);

        // Remove only the sessionId field
        delete data.sessionId;

        // Preserve timestamp if it exists
        if (!data.timestamp) {
            data.timestamp = new Date().toISOString();
        }

        // Write back the modified data
        fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        // Log but don't throw - this is a cleanup operation
        console.warn(`Lanes: Failed to clear session ID from ${sessionPath}:`, err);
    }
}

/**
 * Generate a unique task list ID for a session.
 * Combines the session name with a random suffix for uniqueness.
 * @param sessionName The base session name
 * @returns A unique task list ID string
 */
export function generateTaskListId(sessionName: string): string {
    // Generate a random 6-character suffix (alphanumeric)
    const randomSuffix = crypto.randomBytes(3).toString('base64')
        .replace(/[+/=]/g, '') // Remove URL-unsafe characters
        .substring(0, 6);
    return `${sessionName}-${randomSuffix}`;
}

/**
 * Get the task list ID from a worktree's .claude-session file.
 * If no task list ID exists, returns null.
 * @param worktreePath Path to the worktree directory
 * @returns Task list ID if exists, null otherwise
 */
export function getTaskListId(worktreePath: string): string | null {
    const sessionPath = getClaudeSessionPath(worktreePath);

    try {
        if (!fs.existsSync(sessionPath)) {
            return null;
        }

        const content = fs.readFileSync(sessionPath, 'utf-8');
        const data = JSON.parse(content);

        // Return taskListId if it exists and is a non-empty string
        if (data.taskListId && typeof data.taskListId === 'string' && data.taskListId.trim() !== '') {
            return data.taskListId;
        }

        return null;
    } catch {
        // Graceful fallback for any error
        return null;
    }
}

/**
 * Get or create a task list ID for a session.
 * If an existing task list ID exists in the session file, returns it.
 * Otherwise, generates a new unique ID and stores it in the session file.
 * @param worktreePath Path to the worktree directory
 * @param sessionName The session name (used for generating new IDs)
 * @returns The task list ID
 */
export function getOrCreateTaskListId(worktreePath: string, sessionName: string): string {
    // Try to get existing task list ID
    const existingId = getTaskListId(worktreePath);
    if (existingId) {
        return existingId;
    }

    // Generate a new task list ID
    const newId = generateTaskListId(sessionName);

    // Store it in the session file
    const sessionPath = getClaudeSessionPath(worktreePath);
    try {
        // Ensure the directory exists
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

        // Read existing data or create new object
        let data: Record<string, unknown> = {};
        if (fs.existsSync(sessionPath)) {
            const content = fs.readFileSync(sessionPath, 'utf-8');
            data = JSON.parse(content);
        }

        // Add the task list ID
        data.taskListId = newId;

        // Write back the updated data
        fs.writeFileSync(sessionPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        // Log but don't fail - we'll still return the generated ID
        console.warn(`Lanes: Failed to save task list ID to ${sessionPath}:`, err);
    }

    return newId;
}

// Workflow status interface for display purposes
export interface WorkflowStatus {
    active: boolean;
    workflow?: string;
    step?: string;
    progress?: string;
    /** Brief summary of the user's request (recommended: keep under 100 characters) */
    summary?: string;
}

/**
 * Get the workflow status from a worktree's workflow-state.json file.
 * @param worktreePath Path to the worktree directory
 * @returns WorkflowStatus if valid file exists, null otherwise
 */
export function getWorkflowStatus(worktreePath: string): WorkflowStatus | null {
    const statePath = path.join(worktreePath, 'workflow-state.json');

    try {
        if (!fs.existsSync(statePath)) {
            return null;
        }

        const content = fs.readFileSync(statePath, 'utf-8');
        const state = JSON.parse(content);

        // Validate required fields
        if (!state.status || typeof state.status !== 'string') {
            return null;
        }

        // Extract workflow step info
        const isActive = state.status === 'running';
        const workflow = state.workflow || undefined;
        const step = state.step || undefined;

        // Build progress string from task info if available
        let progress: string | undefined;
        if (state.task && typeof state.task.index === 'number') {
            progress = `Task ${state.task.index + 1}`;
        }

        // Extract summary if present
        const summary = typeof state.summary === 'string' && state.summary.trim() !== ''
            ? state.summary
            : undefined;

        return {
            active: isActive,
            workflow,
            step,
            progress,
            summary
        };
    } catch {
        // Graceful fallback for any error (invalid JSON, read error, etc.)
        return null;
    }
}

/**
 * SessionDetailItem displays workflow step and task information as a child of SessionItem.
 * This item is not clickable and serves as a visual indicator of the current workflow state.
 */
export class SessionDetailItem extends vscode.TreeItem {
    constructor(
        public readonly worktreePath: string,
        step: string,
        progress?: string
    ) {
        // Build the label: "step (progress)" or just "step"
        const label = progress ? `${step} (${progress})` : step;
        super(label, vscode.TreeItemCollapsibleState.None);

        // Visual indicator for sub-item
        this.iconPath = new vscode.ThemeIcon('arrow-small-right');

        // Tooltip with more context
        this.tooltip = `Workflow step: ${step}${progress ? ` - ${progress}` : ''}`;

        // No command - this item should not be clickable
        this.command = undefined;

        // Context value to distinguish from sessionItem
        this.contextValue = 'sessionDetailItem';
    }
}

// Define the shape of our Tree Item
export class SessionItem extends vscode.TreeItem {
    /** Workflow status for this session, stored for getChildren to create child items */
    public readonly workflowStatus: WorkflowStatus | null;

    constructor(
        public readonly label: string,
        public readonly worktreePath: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        claudeStatus?: ClaudeStatus | null,
        workflowStatus?: WorkflowStatus | null
    ) {
        // Store workflow status for later access by getChildren
        const storedWorkflowStatus = workflowStatus ?? null;

        // Determine if we have workflow step info to show as child items
        const hasWorkflowStepInfo = storedWorkflowStatus?.active && storedWorkflowStatus.step;

        // Use Expanded state when there's workflow step info, otherwise None
        const effectiveCollapsibleState = hasWorkflowStepInfo
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        super(label, effectiveCollapsibleState);

        // Store workflow status as public property
        this.workflowStatus = storedWorkflowStatus;

        // Tooltip shown on hover
        this.tooltip = `Path: ${this.worktreePath}`;

        // Set description based on Claude status and workflow status
        this.description = this.getDescriptionForStatus(claudeStatus, workflowStatus);

        // Set the icon based on Claude status
        this.iconPath = this.getIconForStatus(claudeStatus);

        // This command runs when you CLICK the item
        this.command = {
            command: 'claudeWorktrees.openSession',
            title: 'Open Session',
            arguments: [this] // Pass itself so the command knows which session to open
        };

        this.contextValue = 'sessionItem';
    }

    /**
     * Get the appropriate icon based on Claude status
     * Plays chime when transitioning to 'waiting_for_user' state
     */
    private getIconForStatus(claudeStatus?: ClaudeStatus | null): vscode.ThemeIcon {
        let iconId: string;

        if (!claudeStatus) {
            iconId = 'git-branch';
        } else {
            switch (claudeStatus.status) {
                case 'waiting_for_user':
                    iconId = 'bell';
                    break;
                case 'working':
                    iconId = 'sync~spin';
                    break;
                case 'error':
                    iconId = 'error';
                    break;
                case 'idle':
                default:
                    iconId = 'git-branch';
            }
        }

        // Check for transition to 'waiting_for_user' and play chime if enabled
        const previousIcon = previousIconState.get(this.worktreePath);
        if (iconId === 'bell' && previousIcon !== 'bell') {
            // Transition to waiting_for_user detected
            if (getSessionChimeEnabled(this.worktreePath)) {
                // Play chime asynchronously via command (don't block UI)
                void vscode.commands.executeCommand('claudeWorktrees.playChime');
            }
        }

        // Store current icon state for next time
        previousIconState.set(this.worktreePath, iconId);

        // Return the appropriate ThemeIcon with colors
        if (iconId === 'bell') {
            return new vscode.ThemeIcon('bell', new vscode.ThemeColor('charts.yellow'));
        } else if (iconId === 'error') {
            return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
        } else {
            return new vscode.ThemeIcon(iconId);
        }
    }

    /**
     * Get the description text based on Claude status and workflow status.
     * Shows status (Working/Waiting) and summary on the main line.
     * Workflow step/task info is now shown in child SessionDetailItem items.
     * Priority: waiting_for_user > working > summary > "Active"
     * Summary is appended when available using bullet separator.
     */
    private getDescriptionForStatus(
        claudeStatus?: ClaudeStatus | null,
        workflowStatus?: WorkflowStatus | null
    ): string {
        const summary = workflowStatus?.summary;

        // Helper to append summary if available
        const withSummary = (base: string): string => {
            return summary ? `${base} - ${summary}` : base;
        };

        if (claudeStatus?.status === 'waiting_for_user') {
            // Show only status and summary; step/task info moved to child items
            const base = 'Waiting';
            return withSummary(base);
        }

        if (claudeStatus?.status === 'working') {
            // Show only status and summary; step/task info moved to child items
            const base = 'Working';
            return withSummary(base);
        }

        // Fall back to summary or default
        if (summary) {
            return summary;
        } else {
            return "Active";
        }
    }
}

export class ClaudeSessionProvider implements vscode.TreeDataProvider<SessionItem | SessionDetailItem>, vscode.Disposable {

    // Event Emitter to notify VS Code when the tree changes (e.g. new session added)
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | SessionDetailItem | undefined | null | void> = new vscode.EventEmitter<SessionItem | SessionDetailItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | SessionDetailItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // The effective root for finding sessions - either baseRepoPath (if in worktree) or workspaceRoot
    private readonly sessionsRoot: string | undefined;

    /**
     * Create a new ClaudeSessionProvider.
     * @param workspaceRoot The current workspace root (may be a worktree)
     * @param baseRepoPath Optional base repository path (used when workspaceRoot is a worktree)
     * @param codeAgent Optional CodeAgent instance for agent-specific behavior
     */
    constructor(
        private workspaceRoot: string | undefined,
        baseRepoPath?: string,
        private codeAgent?: CodeAgent
    ) {
        // Use baseRepoPath for finding sessions if provided, otherwise fall back to workspaceRoot
        this.sessionsRoot = baseRepoPath || workspaceRoot;
    }

    /**
     * Dispose of resources held by this provider.
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
    }

    // 1. Refresh Method: Call this after creating a new session
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    // 2. Get the visual representation of the item
    getTreeItem(element: SessionItem | SessionDetailItem): vscode.TreeItem {
        return element;
    }

    // 3. Get the data (Scan the worktrees folder)
    // Uses sessionsRoot (base repo path) to ensure sessions are found even when in a worktree
    getChildren(element?: SessionItem | SessionDetailItem): Thenable<(SessionItem | SessionDetailItem)[]> {
        if (!this.sessionsRoot) {
            return Promise.resolve([]);
        }

        // Handle child elements for SessionItem with workflow step info
        if (element) {
            // If it's a SessionItem with workflow step info, return SessionDetailItem child
            if (element instanceof SessionItem && element.workflowStatus?.active && element.workflowStatus.step) {
                return Promise.resolve([
                    new SessionDetailItem(
                        element.worktreePath,
                        element.workflowStatus.step,
                        element.workflowStatus.progress
                    )
                ]);
            }
            // SessionDetailItem or SessionItem without workflow info has no children
            return Promise.resolve([]);
        }

        const worktreesDir = path.join(this.sessionsRoot, getWorktreesFolder());

        // Check if folder exists
        if (!fs.existsSync(worktreesDir)) {
            return Promise.resolve([]);
        }

        return Promise.resolve(this.getSessionsInDir(worktreesDir));
    }

    private getSessionsInDir(dirPath: string): SessionItem[] {
        return fs.readdirSync(dirPath).map(folderName => {
            const fullPath = path.join(dirPath, folderName);

            // Filter: Ensure it's actually a directory
            if (fs.statSync(fullPath).isDirectory()) {
                const claudeStatus = getClaudeStatus(fullPath);
                const workflowStatus = getWorkflowStatus(fullPath);
                return new SessionItem(
                    folderName,
                    fullPath,
                    vscode.TreeItemCollapsibleState.None, // No nested items
                    claudeStatus,
                    workflowStatus
                );
            }
        }).filter(item => item !== undefined) as SessionItem[];
    }
}
