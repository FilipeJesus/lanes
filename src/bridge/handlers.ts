/**
 * Method Handlers - Maps JSON-RPC methods to core service calls
 *
 * Organizes handlers by domain:
 * - Session handlers (session.*)
 * - Git handlers (git.*)
 * - Workflow handlers (workflow.*)
 * - Agent handlers (agent.*)
 * - Config handlers (config.*)
 * - Terminal handlers (terminal.*)
 * - File watcher handlers (fileWatcher.*)
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { execGit } from '../core/gitService';
import {
    getSessionFilePath,
    getAgentStatus,
    getSessionId,
    getPromptsPath,
    clearSessionId,
    getSessionNameFromWorktree,
    getWorktreesFolder,
    getWorkflowStatus,
    saveSessionWorkflow,
    saveSessionPermissionMode,
    saveSessionTerminalMode,
} from '../core/session/SessionDataService';
import * as TmuxService from '../core/services/TmuxService';
import * as DiffService from '../core/services/DiffService';
import * as BrokenWorktreeService from '../core/services/BrokenWorktreeService';
import { discoverWorkflows } from '../core/workflow/discovery';
import { getWorkflowOrchestratorInstructions, validateWorkflow } from '../core/services/WorkflowService';
import { getAgent, getAvailableAgents } from '../core/codeAgents';
import { ConfigStore } from './config';
import { NotificationEmitter } from './notifications';
import { FileWatchManager } from './fileWatcher';
import { readJson } from '../core/services/FileService';
import { buildAgentLaunchCommand, prepareAgentLaunchContext } from '../core/services/AgentLaunchSetupService';

// =============================================================================
// Input Validation
// =============================================================================

/**
 * Validate a session name to prevent path traversal attacks.
 * Session names are used as directory names and must not contain path separators.
 */
function validateSessionName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new Error('Session name is required');
    }
    if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        throw new Error('Invalid session name: must not contain path separators or traversal sequences');
    }
}

/**
 * Validate a workflow name to prevent path traversal.
 */
function validateWorkflowName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new Error('Workflow name is required');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Invalid workflow name: must only contain alphanumeric characters, hyphens, and underscores');
    }
}

/**
 * Validate a tmux terminal name.
 */
function validateTerminalName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new Error('Terminal name is required');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Invalid terminal name: must only contain alphanumeric characters, hyphens, and underscores');
    }
}

/**
 * Validate a file watch path is within the workspace root.
 */
function validateWatchPath(watchPath: string): void {
    const resolved = path.resolve(watchPath);
    const resolvedWorkspace = path.resolve(workspaceRoot);
    if (!resolved.startsWith(resolvedWorkspace + path.sep) && resolved !== resolvedWorkspace) {
        throw new Error('Watch path must be within the workspace root');
    }
}

function validateWatchPattern(pattern: string): void {
    if (!pattern || typeof pattern !== 'string') {
        throw new Error('Watch pattern is required');
    }
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
        throw new Error('Watch pattern must be relative and must not traverse parent directories');
    }
}

const VALID_CONFIG_KEYS = new Set([
    'lanes.worktreesFolder',
    'lanes.promptsFolder',
    'lanes.defaultAgent',
    'lanes.baseBranch',
    'lanes.includeUncommittedChanges',
    'lanes.useGlobalStorage',
    'lanes.localSettingsPropagation',
    'lanes.workflowsEnabled',
    'lanes.customWorkflowsFolder',
    'lanes.chimeSound',
    'lanes.polling.quietThresholdMs',
    'lanes.terminalMode'
]);

// Global handler context
let workspaceRoot: string;
let configStore: ConfigStore;
let notificationEmitter: NotificationEmitter;
let fileWatchManager: FileWatchManager;

function isSessionActive(status: { status?: string } | null | undefined): boolean {
    const state = status?.status;
    return state === 'active' || state === 'working' || state === 'waiting_for_user';
}

function normalizeTerminalMode(mode: string | undefined): string {
    if (mode === 'code') {
        // Backward compatibility for older IntelliJ values.
        return 'vscode';
    }
    return mode ?? 'vscode';
}

function buildCreateSessionPrompt(
    prompt: string | undefined,
    effectiveWorkflow: string | null
): string | undefined {
    const trimmed = prompt?.trim() ?? '';
    if (effectiveWorkflow && trimmed) {
        return getWorkflowOrchestratorInstructions(effectiveWorkflow) + trimmed;
    }
    if (effectiveWorkflow) {
        return getWorkflowOrchestratorInstructions(effectiveWorkflow) + 'Start the workflow and follow the steps.';
    }
    return trimmed || undefined;
}

async function resolveExtensionPath(): Promise<string> {
    const candidates = [
        path.join(__dirname, '..', '..'), // dev layout: out/bridge -> repo root
        path.join(__dirname, '..')        // packaged layout: <plugin>/bridge -> <plugin>
    ];

    for (const candidate of candidates) {
        try {
            await fs.access(path.join(candidate, 'workflows'));
            return candidate;
        } catch {
            // Continue to next candidate.
        }
    }

    return candidates[0];
}

async function resolveWorkflowPath(workflowNameOrPath: string): Promise<string | null> {
    if (path.isAbsolute(workflowNameOrPath) && workflowNameOrPath.endsWith('.yaml')) {
        const resolved = path.resolve(workflowNameOrPath);
        const resolvedWorkspace = path.resolve(workspaceRoot);
        if (!resolved.startsWith(resolvedWorkspace + path.sep) && resolved !== resolvedWorkspace) {
            throw new Error('Workflow path must be within the workspace root');
        }
        return workflowNameOrPath;
    }

    const customWorkflowsFolder = configStore.get('lanes.customWorkflowsFolder') as string ?? '.lanes/workflows';
    const extensionPath = await resolveExtensionPath();
    const workflows = await discoverWorkflows({
        extensionPath,
        workspaceRoot,
        customWorkflowsFolder
    });
    const matched = workflows.find(w => w.name === workflowNameOrPath);
    return matched?.path ?? null;
}

/**
 * Initialize handlers with context.
 * Must be called during server initialization.
 */
export function initializeHandlers(
    workspace: string,
    config: ConfigStore,
    notifications: NotificationEmitter
): void {
    workspaceRoot = workspace;
    configStore = config;
    notificationEmitter = notifications;
    fileWatchManager = new FileWatchManager(notifications);
}

/**
 * Clean up resources managed by handlers.
 * Should be called during server shutdown.
 */
export function disposeHandlers(): void {
    if (fileWatchManager) {
        fileWatchManager.dispose();
    }
}

const methodHandlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
    'session.list': handleSessionList,
    'session.create': handleSessionCreate,
    'session.delete': handleSessionDelete,
    'session.clear': handleSessionClear,
    'session.getStatus': handleSessionGetStatus,
    'session.open': handleSessionOpen,
    'session.pin': handleSessionPin,
    'session.unpin': handleSessionUnpin,
    'git.listBranches': handleGitListBranches,
    'git.getDiff': handleGitGetDiff,
    'git.getDiffFiles': handleGitGetDiffFiles,
    'git.getWorktreeInfo': handleGitGetWorktreeInfo,
    'git.repairWorktrees': handleGitRepairWorktrees,
    'workflow.list': handleWorkflowList,
    'workflow.validate': handleWorkflowValidate,
    'workflow.create': handleWorkflowCreate,
    'workflow.getState': handleWorkflowGetState,
    'agent.list': handleAgentList,
    'agent.getConfig': handleAgentGetConfig,
    'config.get': handleConfigGet,
    'config.set': handleConfigSet,
    'config.getAll': handleConfigGetAll,
    'terminal.create': handleTerminalCreate,
    'terminal.send': handleTerminalSend,
    'terminal.list': handleTerminalList,
    'fileWatcher.watch': handleFileWatcherWatch,
    'fileWatcher.unwatch': handleFileWatcherUnwatch,
};

/**
 * Main request dispatcher.
 * Routes method names to handler functions.
 */
export async function handleRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const handler = methodHandlers[method];
    if (!handler) {
        throw new Error(`Method not found: ${method}`);
    }
    return handler(params);
}

// =============================================================================
// Session Handlers
// =============================================================================

async function handleSessionList(params: Record<string, unknown>): Promise<unknown> {
    const includeInactive = params.includeInactive as boolean ?? true;
    const worktreesFolder = getWorktreesFolder();
    const worktreesDir = path.join(workspaceRoot, worktreesFolder);

    const sessions: unknown[] = [];

    try {
        const entries = await fs.readdir(worktreesDir);

        for (const entry of entries) {
            const worktreePath = path.join(worktreesDir, entry);
            const stat = await fs.stat(worktreePath);

            if (!stat.isDirectory()) {
                continue;
            }

            const sessionName = getSessionNameFromWorktree(worktreePath);

            // Get branch name (same as session name in Lanes)
            const branch = sessionName;

            // Get session data
            const data = await getSessionId(worktreePath);

            // Get status
            const status = await getAgentStatus(worktreePath);

            // Get workflow status
            const workflowStatus = await getWorkflowStatus(worktreePath);

            // For now, we don't have pin state persisted - always false
            const isPinned = false;

            if (!includeInactive && !isSessionActive(status as { status?: string } | null)) {
                continue;
            }

            sessions.push({
                name: sessionName,
                worktreePath,
                branch,
                data,
                status,
                workflowStatus,
                isPinned
            });
        }
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            // Worktrees directory doesn't exist - return empty list
        } else {
            throw err;
        }
    }

    return { sessions };
}

async function handleSessionCreate(params: Record<string, unknown>): Promise<unknown> {
    const name = params.name as string;
    const branch = (params.branch as string) || '';
    const workflow = params.workflow as string | undefined;
    const agent = params.agent as string | undefined;
    const prompt = params.prompt as string | undefined;
    const attachments = params.attachments as string[] | undefined;
    const permissionMode = params.permissionMode as string | undefined;

    if (!name) {
        throw new Error('Missing required parameter: name');
    }

    validateSessionName(name);

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, name);

    // Create worktree on a session-specific branch.
    // - If branch is provided, treat it as the source/base branch and create `name` from it.
    // - If branch is empty, create `name` from current HEAD.
    // - If branch equals name, reuse that existing branch in a new worktree.
    const worktreeArgs = ['worktree', 'add'];
    if (branch) {
        if (branch === name) {
            worktreeArgs.push(worktreePath, branch);
        } else {
            worktreeArgs.push('-b', name, worktreePath, branch);
        }
    } else {
        worktreeArgs.push('-b', name, worktreePath);
    }
    await execGit(worktreeArgs, workspaceRoot);

    try {
        const launchContext = await prepareAgentLaunchContext({
            worktreePath,
            workflow: workflow ?? null,
            permissionMode,
            agentName: agent,
            defaultAgentName: configStore.get('lanes.defaultAgent') as string ?? 'claude',
            repoRoot: workspaceRoot,
            workflowResolver: resolveWorkflowPath
        });
        const startPrompt = buildCreateSessionPrompt(prompt, launchContext.effectiveWorkflow);
        let launchPrompt = startPrompt;
        if (startPrompt) {
            const promptsFolder = configStore.get('lanes.promptsFolder') as string ?? '';
            const promptPathInfo = getPromptsPath(name, workspaceRoot, promptsFolder);
            if (promptPathInfo) {
                await fs.mkdir(promptPathInfo.needsDir, { recursive: true });
                await fs.writeFile(promptPathInfo.path, startPrompt, 'utf-8');
                // Use command substitution to avoid terminal issues with multiline prompts.
                const escapedPromptPath = promptPathInfo.path.replace(/"/g, '\\"');
                launchPrompt = `"$(cat "${escapedPromptPath}")"`;
            }
        }
        const launch = await buildAgentLaunchCommand(launchContext, {
            preferResume: false,
            prompt: launchPrompt
        });

        // Initialize session file
        const sessionFilePath = getSessionFilePath(worktreePath);
        const sessionId = `session-${Date.now()}`;
        await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
        await fs.writeFile(
            sessionFilePath,
            JSON.stringify({
                sessionId,
                timestamp: new Date().toISOString(),
                agentName: launchContext.codeAgent.name,
                workflow: launchContext.effectiveWorkflow ?? undefined,
                permissionMode: permissionMode ?? undefined
            }, null, 2),
            'utf-8'
        );

        // Save workflow if provided
        if (launchContext.effectiveWorkflow) {
            await saveSessionWorkflow(worktreePath, launchContext.effectiveWorkflow);
        }

        // Save permission mode if provided
        if (permissionMode) {
            await saveSessionPermissionMode(worktreePath, permissionMode);
        }

        // Create tmux terminal
        const terminalMode = normalizeTerminalMode(configStore.get('lanes.terminalMode') as string | undefined);
        let command = launch.command;
        if (TmuxService.isTmuxMode(terminalMode)) {
            const tmuxInstalled = await TmuxService.isTmuxInstalled();
            if (tmuxInstalled) {
                const sanitizedName = TmuxService.sanitizeTmuxSessionName(name);
                await TmuxService.createSession(sanitizedName, worktreePath);
                await TmuxService.sendCommand(sanitizedName, launch.command);
                await saveSessionTerminalMode(worktreePath, 'tmux');
                command = `tmux attach-session -t ${sanitizedName}`;
            }
        } else {
            await saveSessionTerminalMode(worktreePath, 'vscode');
        }

        // Emit notification
        notificationEmitter.sessionCreated(name, worktreePath);

        return {
            sessionName: name,
            worktreePath,
            sessionId,
            command
        };
    } catch (err) {
        // Clean up the worktree on partial failure
        try {
            await execGit(['worktree', 'remove', worktreePath, '--force'], workspaceRoot);
        } catch {
            // Best effort cleanup
        }
        throw err;
    }
}

async function handleSessionDelete(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);
    const deleteWorktree = params.deleteWorktree as boolean ?? true;

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    // Kill tmux session if it exists
    const sanitizedName = TmuxService.sanitizeTmuxSessionName(sessionName);
    await TmuxService.killSession(sanitizedName);

    // Remove worktree if requested
    if (deleteWorktree) {
        await execGit(['worktree', 'remove', worktreePath, '--force'], workspaceRoot);
    }

    // Emit notification
    notificationEmitter.sessionDeleted(sessionName);

    return { success: true };
}

async function handleSessionClear(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    await clearSessionId(worktreePath);

    return { success: true };
}

async function handleSessionGetStatus(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    const status = await getAgentStatus(worktreePath);
    const workflowStatus = await getWorkflowStatus(worktreePath);

    return { status, workflowStatus };
}

async function handleSessionOpen(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    const launchContext = await prepareAgentLaunchContext({
        worktreePath,
        workflow: null,
        permissionMode: undefined,
        defaultAgentName: configStore.get('lanes.defaultAgent') as string ?? 'claude',
        repoRoot: workspaceRoot,
        workflowResolver: resolveWorkflowPath
    });
    const launch = await buildAgentLaunchCommand(launchContext);

    let command = launch.command;
    const terminalMode = normalizeTerminalMode(configStore.get('lanes.terminalMode') as string | undefined);
    if (TmuxService.isTmuxMode(terminalMode)) {
        const tmuxInstalled = await TmuxService.isTmuxInstalled();
        if (tmuxInstalled) {
            const sanitizedName = TmuxService.sanitizeTmuxSessionName(sessionName);
            if (!await TmuxService.sessionExists(sanitizedName)) {
                await TmuxService.createSession(sanitizedName, worktreePath);
                await TmuxService.sendCommand(sanitizedName, launch.command);
            }
            command = `tmux attach-session -t ${sanitizedName}`;
        }
    }

    return {
        success: true,
        worktreePath,
        command
    };
}

async function handleSessionPin(_params: Record<string, unknown>): Promise<unknown> {
    // Pin state would need to be persisted somewhere
    // For now, just acknowledge success
    return { success: true };
}

async function handleSessionUnpin(_params: Record<string, unknown>): Promise<unknown> {
    // Unpin state would need to be persisted somewhere
    // For now, just acknowledge success
    return { success: true };
}

// =============================================================================
// Git Handlers
// =============================================================================

async function handleGitListBranches(params: Record<string, unknown>): Promise<unknown> {
    const includeRemote = params.includeRemote as boolean ?? false;

    const args = includeRemote
        ? ['branch', '-a', '--format=%(refname:short)|%(HEAD)']
        : ['branch', '--format=%(refname:short)|%(HEAD)'];

    const output = await execGit(args, workspaceRoot);
    const lines = output.trim().split('\n');

    const branches = lines
        .filter(line => line.trim())
        .map(line => {
            const [name, head] = line.split('|');
            return {
                name: name.trim(),
                isCurrent: head === '*'
            };
        });

    return { branches };
}

async function handleGitGetDiff(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);
    const includeUncommitted = params.includeUncommitted as boolean ?? true;

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    const baseBranch = configStore.get('lanes.baseBranch') as string ?? '';
    const resolvedBaseBranch = await DiffService.getBaseBranch(worktreePath, baseBranch);

    const warnedBranches = new Set<string>();
    const diff = await DiffService.generateDiffContent(
        worktreePath,
        resolvedBaseBranch,
        warnedBranches,
        { includeUncommitted }
    );

    return { diff };
}

async function handleGitGetDiffFiles(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);
    const includeUncommitted = params.includeUncommitted as boolean ?? true;

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    const baseBranch = configStore.get('lanes.baseBranch') as string ?? '';
    const resolvedBaseBranch = await DiffService.getBaseBranch(worktreePath, baseBranch);

    const warnedBranches = new Set<string>();
    const files = await DiffService.generateDiffFiles(
        worktreePath,
        resolvedBaseBranch,
        warnedBranches,
        { includeUncommitted }
    );

    return { files };
}

async function handleGitGetWorktreeInfo(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    // Get worktree list
    const output = await execGit(['worktree', 'list', '--porcelain'], workspaceRoot);
    const lines = output.trim().split('\n');

    // Parse worktree info
    let currentPath = '';
    let currentBranch = '';
    let currentCommit = '';

    for (const line of lines) {
        if (line.startsWith('worktree ')) {
            currentPath = line.substring('worktree '.length);
        } else if (line.startsWith('branch ')) {
            currentBranch = line.substring('branch '.length).replace('refs/heads/', '');
        } else if (line.startsWith('HEAD ')) {
            currentCommit = line.substring('HEAD '.length);
        } else if (line === '' && currentPath === worktreePath) {
            return {
                worktree: {
                    path: currentPath,
                    branch: currentBranch,
                    commit: currentCommit
                }
            };
        }
    }

    // Check the last accumulated entry (no trailing empty line in porcelain output)
    if (currentPath === worktreePath) {
        return {
            worktree: {
                path: currentPath,
                branch: currentBranch,
                commit: currentCommit
            }
        };
    }

    return { worktree: null };
}

async function handleGitRepairWorktrees(params: Record<string, unknown>): Promise<unknown> {
    const detectOnly = params.detectOnly as boolean ?? false;

    const worktreesFolder = getWorktreesFolder();
    const broken = await BrokenWorktreeService.detectBrokenWorktrees(workspaceRoot, worktreesFolder);

    if (detectOnly) {
        return {
            broken: broken.map(b => ({
                sessionName: b.sessionName,
                worktreePath: b.path,
                reason: 'Git metadata directory missing'
            })),
            repairResult: null
        };
    }

    // Repair broken worktrees
    const repairResult = await BrokenWorktreeService.repairBrokenWorktrees(workspaceRoot, broken);

    return {
        broken: broken.map(b => ({
            sessionName: b.sessionName,
            worktreePath: b.path,
            reason: 'Git metadata directory missing'
        })),
        repairResult: {
            successCount: repairResult.successCount,
            failures: repairResult.failures
        }
    };
}

// =============================================================================
// Workflow Handlers
// =============================================================================

async function handleWorkflowList(params: Record<string, unknown>): Promise<unknown> {
    const includeBuiltin = params.includeBuiltin as boolean ?? true;
    const includeCustom = params.includeCustom as boolean ?? true;
    const extensionPath = await resolveExtensionPath();

    const allWorkflows = await discoverWorkflows({
        extensionPath,
        workspaceRoot,
        customWorkflowsFolder: configStore.get('lanes.customWorkflowsFolder') as string ?? '.lanes/workflows'
    });

    // Filter based on params
    const workflows = allWorkflows.filter(w => {
        if (w.isBuiltIn && !includeBuiltin) {
            return false;
        }
        if (!w.isBuiltIn && !includeCustom) {
            return false;
        }
        return true;
    });

    return {
        workflows: workflows.map(w => ({
            name: w.name,
            path: w.path,
            description: w.description,
            isBuiltin: w.isBuiltIn
        }))
    };
}

async function handleWorkflowValidate(params: Record<string, unknown>): Promise<unknown> {
    const workflowPath = params.workflowPath as string;

    if (!workflowPath) {
        throw new Error('Missing required parameter: workflowPath');
    }

    // Validate path is within workspace
    if (path.isAbsolute(workflowPath)) {
        const resolved = path.resolve(workflowPath);
        const resolvedWorkspace = path.resolve(workspaceRoot);
        if (!resolved.startsWith(resolvedWorkspace + path.sep) && resolved !== resolvedWorkspace) {
            throw new Error('Workflow path must be within the workspace root');
        }
    }

    const extensionPath = await resolveExtensionPath();
    const result = await validateWorkflow(workflowPath, extensionPath, workspaceRoot);

    return {
        isValid: result.isValid,
        errors: result.isValid ? [] : [`Workflow not found. Available: ${result.availableWorkflows.join(', ')}`]
    };
}

async function handleWorkflowCreate(params: Record<string, unknown>): Promise<unknown> {
    const name = params.name as string;
    const content = params.content as string;

    if (!name || !content) {
        throw new Error('Missing required parameters: name and content');
    }
    validateWorkflowName(name);

    const customWorkflowsFolder = configStore.get('lanes.customWorkflowsFolder') as string ?? '.lanes/workflows';
    const workflowsDir = path.join(workspaceRoot, customWorkflowsFolder);
    const workflowPath = path.join(workflowsDir, `${name}.yaml`);

    await fs.mkdir(workflowsDir, { recursive: true });
    await fs.writeFile(workflowPath, content, 'utf-8');

    return { path: workflowPath };
}

async function handleWorkflowGetState(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);
    const statePath = path.join(worktreePath, 'workflow-state.json');

    try {
        const state = await readJson(statePath);
        return { state: state ?? null };
    } catch {
        return { state: null };
    }
}

// =============================================================================
// Agent Handlers
// =============================================================================

async function handleAgentList(_params: Record<string, unknown>): Promise<unknown> {
    const agentNames = getAvailableAgents();
    const agents = agentNames.map(name => {
        const agent = getAgent(name);
        if (!agent) {
            return null;
        }
        return {
            name: agent.name,
            displayName: agent.displayName,
            cliCommand: agent.cliCommand,
            sessionFileExtension: agent.getSessionFileName(),
            statusFileExtension: agent.getStatusFileName(),
            logoSvg: undefined, // Not available in core agents
            permissionModes: agent.getPermissionModes().map((pm: { id: string; label: string; flag?: string }) => ({
                id: pm.id,
                label: pm.label,
                flag: pm.flag
            }))
        };
    }).filter(Boolean);

    return { agents };
}

async function handleAgentGetConfig(params: Record<string, unknown>): Promise<unknown> {
    const agentName = params.agentName as string;

    if (!agentName) {
        throw new Error('Missing required parameter: agentName');
    }

    const agent = getAgent(agentName);
    if (!agent) {
        return { config: null };
    }

    return {
        config: {
            name: agent.name,
            displayName: agent.displayName,
            cliCommand: agent.cliCommand,
            sessionFileExtension: agent.getSessionFileName(),
            statusFileExtension: agent.getStatusFileName(),
            logoSvg: undefined,
            permissionModes: agent.getPermissionModes().map((pm: { id: string; label: string; flag?: string }) => ({
                id: pm.id,
                label: pm.label,
                flag: pm.flag
            }))
        }
    };
}

// =============================================================================
// Config Handlers
// =============================================================================

async function handleConfigGet(params: Record<string, unknown>): Promise<unknown> {
    const key = params.key as string;

    if (!key) {
        throw new Error('Missing required parameter: key');
    }

    const value = configStore.get(key);
    return { value: value ?? null };
}

async function handleConfigSet(params: Record<string, unknown>): Promise<unknown> {
    const key = params.key as string;
    const value = params.value;

    if (!key || value === undefined) {
        throw new Error('Missing required parameters: key and value');
    }

    if (!VALID_CONFIG_KEYS.has(key)) {
        throw new Error(`Unknown configuration key: ${key}`);
    }

    await configStore.set(key, value);
    return { success: true };
}

async function handleConfigGetAll(params: Record<string, unknown>): Promise<unknown> {
    const prefix = params.prefix as string | undefined;
    const config = configStore.getAll(prefix);
    return { config };
}

// =============================================================================
// Terminal Handlers
// =============================================================================

async function handleTerminalCreate(params: Record<string, unknown>): Promise<unknown> {
    const sessionName = params.sessionName as string;
    validateSessionName(sessionName);
    const command = params.command as string | undefined;

    const worktreesFolder = getWorktreesFolder();
    const worktreePath = path.join(workspaceRoot, worktreesFolder, sessionName);

    const sanitizedName = TmuxService.sanitizeTmuxSessionName(sessionName);
    await TmuxService.createSession(sanitizedName, worktreePath);

    if (command) {
        await TmuxService.sendCommand(sanitizedName, command);
    }

    return {
        terminalName: sanitizedName,
        attachCommand: `tmux attach-session -t ${sanitizedName}`
    };
}

async function handleTerminalSend(params: Record<string, unknown>): Promise<unknown> {
    const terminalName = params.terminalName as string;
    validateTerminalName(terminalName);
    const text = params.text as string;

    if (!terminalName || !text) {
        throw new Error('Missing required parameters: terminalName and text');
    }

    await TmuxService.sendCommand(terminalName, text);
    return { success: true };
}

async function handleTerminalList(_params: Record<string, unknown>): Promise<unknown> {
    // List tmux sessions
    // For now, return empty list (full implementation would parse tmux list-sessions)
    return { terminals: [] };
}

// =============================================================================
// File Watcher Handlers
// =============================================================================

async function handleFileWatcherWatch(params: Record<string, unknown>): Promise<unknown> {
    const basePath = params.basePath as string;
    const pattern = params.pattern as string;

    if (!basePath || !pattern) {
        throw new Error('Missing required parameters: basePath and pattern');
    }
    validateWatchPath(basePath);
    validateWatchPattern(pattern);

    const watchId = fileWatchManager.watch(basePath, pattern);
    return { watchId };
}

async function handleFileWatcherUnwatch(params: Record<string, unknown>): Promise<unknown> {
    const watchId = params.watchId as string;

    if (!watchId) {
        throw new Error('Missing required parameter: watchId');
    }

    const success = await fileWatchManager.unwatch(watchId);
    return { success };
}
