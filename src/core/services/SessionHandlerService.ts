/**
 * SessionHandlerService - Protocol-agnostic handler layer.
 *
 * Encapsulates all 27 request-handler methods that were previously
 * implemented as module-level functions in the JetBrains bridge handlers.ts.
 * By extracting this logic into a class that depends only on the
 * IHandlerContext interfaces, the same business logic can be reused by
 * both the JetBrains bridge and any future daemon/adapter.
 *
 * Organises handlers into logical groups:
 *   - Sessions (session.*)
 *   - Git       (git.*)
 *   - Workflows (workflow.*)
 *   - Agents    (agent.*)
 *   - Config    (config.*)
 *   - Terminals (terminal.*)
 *   - File watchers (fileWatcher.*)
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { execGit } from '../gitService';
import {
    getSessionFilePath,
    getAgentStatus,
    getSessionId,
    clearSessionId,
    getSessionNameFromWorktree,
    getWorktreesFolder,
    getWorkflowStatus,
    saveSessionWorkflow,
    saveSessionPermissionMode,
    saveSessionTerminalMode,
} from '../session/SessionDataService';
import { ValidationError } from '../errors/ValidationError';
import * as TmuxService from './TmuxService';
import * as DiffService from './DiffService';
import * as BrokenWorktreeService from './BrokenWorktreeService';
import { discoverWorkflows } from '../workflow/discovery';
import { validateWorkflow } from './WorkflowService';
import { assemblePrompt, writePromptFile } from './PromptService';
import { getAgent, getAvailableAgents } from '../codeAgents';
import { readJson } from './FileService';
import { buildAgentLaunchCommand, prepareAgentLaunchContext } from './AgentLaunchSetupService';
import { IHandlerContext } from '../interfaces/IHandlerContext';
import { validateSessionName as coreValidateSessionName, validateComparisonRef } from '../validation';
import { generateInsights, formatInsightsReport, SessionInsights } from './InsightsService';
import { analyzeInsights } from './InsightsAnalyzer';

// =============================================================================
// JSON-RPC Error Helper
// =============================================================================

/**
 * An error that carries an explicit JSON-RPC error code.
 * Thrown by handlers when a specific protocol-level error code is needed
 * (e.g., -32602 INVALID_PARAMS) rather than a generic internal error.
 */
export class JsonRpcHandlerError extends Error {
    public readonly code: number;

    constructor(code: number, message: string) {
        super(message);
        this.name = 'JsonRpcHandlerError';
        this.code = code;
    }
}

// =============================================================================
// Shared Validation Helpers
// =============================================================================

/**
 * Validate a session name to prevent path traversal attacks.
 * Delegates to the canonical validator in core/validation and throws on failure.
 */
export function validateSessionName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new Error('Session name is required');
    }
    // Session names are used as directory names — reject path separators
    if (name.includes('/') || name.includes('\\')) {
        throw new Error('Invalid session name: must not contain path separators');
    }
    const result = coreValidateSessionName(name);
    if (!result.valid) {
        throw new Error(result.error ?? 'Invalid session name');
    }
}

/**
 * Validate a workflow name to prevent path traversal.
 */
export function validateWorkflowName(name: string): void {
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
export function validateTerminalName(name: string): void {
    if (!name || typeof name !== 'string') {
        throw new Error('Terminal name is required');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        throw new Error('Invalid terminal name: must only contain alphanumeric characters, hyphens, and underscores');
    }
}

/** Valid configuration keys that the config handlers accept. */
export const VALID_CONFIG_KEYS = [
    'lanes.worktreesFolder',
    'lanes.promptsFolder',
    'lanes.defaultAgent',
    'lanes.baseBranch',
    'lanes.includeUncommittedChanges',
    'lanes.localSettingsPropagation',
    'lanes.workflowsEnabled',
    'lanes.customWorkflowsFolder',
    'lanes.chimeSound',
    'lanes.polling.quietThresholdMs',
    'lanes.terminalMode',
];

// =============================================================================
// SessionHandlerService
// =============================================================================

/**
 * Protocol-agnostic business-logic layer for all session/git/workflow
 * handler operations.  Constructed with a IHandlerContext and used by
 * the transport layer (JetBrains bridge, future daemon, etc.).
 */
export class SessionHandlerService {
    private readonly ctx: IHandlerContext;

    constructor(context: IHandlerContext) {
        this.ctx = context;
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    private isSessionActive(status: { status?: string } | null | undefined): boolean {
        const state = status?.status;
        return state === 'active' || state === 'working' || state === 'waiting_for_user';
    }

    private normalizeTerminalMode(mode: string | undefined): string {
        if (mode === 'code') {
            // Backward compatibility for older IntelliJ values.
            return 'vscode';
        }
        return mode ?? 'vscode';
    }

    private buildCreateSessionPrompt(
        prompt: string | undefined,
        effectiveWorkflow: string | null
    ): string | undefined {
        return assemblePrompt({ userPrompt: prompt, effectiveWorkflow });
    }

    private async resolveExtensionPath(): Promise<string> {
        const candidates = [
            path.join(__dirname, '..', '..'), // dev layout: out/core/services -> repo root
            path.join(__dirname, '..'),        // packaged layout
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

    private assertPathWithinWorkspace(targetPath: string, label: string): void {
        const resolved = path.resolve(targetPath);
        const base = path.resolve(this.ctx.workspaceRoot);
        if (!resolved.startsWith(base + path.sep) && resolved !== base) {
            throw new Error(`${label} must be within the workspace root`);
        }
    }

    private validateWatchPath(watchPath: string): void {
        this.assertPathWithinWorkspace(watchPath, 'Watch path');
    }

    private validateWatchPattern(pattern: string): void {
        if (!pattern || typeof pattern !== 'string') {
            throw new Error('Watch pattern is required');
        }
        if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
            throw new Error('Watch pattern must be relative and must not traverse parent directories');
        }
    }

    private async resolveWorkflowPath(workflowNameOrPath: string): Promise<string | null> {
        if (path.isAbsolute(workflowNameOrPath) && workflowNameOrPath.endsWith('.yaml')) {
            this.assertPathWithinWorkspace(workflowNameOrPath, 'Workflow path');
            return workflowNameOrPath;
        }

        const customWorkflowsFolder =
            (this.ctx.config.get('lanes.customWorkflowsFolder') as string) ?? '.lanes/workflows';
        const extensionPath = await this.resolveExtensionPath();
        const workflows = await discoverWorkflows({
            extensionPath,
            workspaceRoot: this.ctx.workspaceRoot,
            customWorkflowsFolder,
        });
        const matched = workflows.find((w) => w.name === workflowNameOrPath);
        return matched?.path ?? null;
    }

    // ---------------------------------------------------------------------------
    // Session handlers
    // ---------------------------------------------------------------------------

    async handleSessionList(params: Record<string, unknown>): Promise<unknown> {
        const includeInactive = (params.includeInactive as boolean) ?? true;
        const worktreesFolder = getWorktreesFolder();
        const worktreesDir = path.join(this.ctx.workspaceRoot, worktreesFolder);

        const pinnedSessions =
            (this.ctx.config.get('lanes.pinnedSessions') as string[] | undefined) ?? [];
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
                const branch = sessionName;
                const data = await getSessionId(worktreePath);
                const status = await getAgentStatus(worktreePath);
                const workflowStatus = await getWorkflowStatus(worktreePath);
                const isPinned = pinnedSessions.includes(sessionName);

                if (!includeInactive && !this.isSessionActive(status as { status?: string } | null)) {
                    continue;
                }

                sessions.push({
                    name: sessionName,
                    worktreePath,
                    branch,
                    data,
                    status,
                    workflowStatus,
                    isPinned,
                });
            }
        } catch (err: unknown) {
            if (
                err instanceof Error &&
                'code' in err &&
                (err as NodeJS.ErrnoException).code === 'ENOENT'
            ) {
                // Worktrees directory doesn't exist - return empty list
            } else {
                throw err;
            }
        }

        return { sessions };
    }

    async handleSessionCreate(params: Record<string, unknown>): Promise<unknown> {
        const name = params.name as string;
        const branch = (params.branch as string) || '';
        const workflow = params.workflow as string | undefined;
        const agent = params.agent as string | undefined;
        const prompt = params.prompt as string | undefined;
        const permissionMode = params.permissionMode as string | undefined;

        if (!name) {
            throw new Error('Missing required parameter: name');
        }
        validateSessionName(name);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, name);

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
        await execGit(worktreeArgs, this.ctx.workspaceRoot);

        try {
            const launchContext = await prepareAgentLaunchContext({
                worktreePath,
                workflow: workflow ?? null,
                permissionMode,
                agentName: agent,
                defaultAgentName:
                    (this.ctx.config.get('lanes.defaultAgent') as string) ?? 'claude',
                repoRoot: this.ctx.workspaceRoot,
                workflowResolver: (name: string) => this.resolveWorkflowPath(name),
            });
            const startPrompt = this.buildCreateSessionPrompt(prompt, launchContext.effectiveWorkflow);
            let launchPrompt = startPrompt;
            if (startPrompt) {
                const promptsFolder = (this.ctx.config.get('lanes.promptsFolder') as string) ?? '';
                const result = await writePromptFile(
                    startPrompt,
                    name,
                    this.ctx.workspaceRoot,
                    promptsFolder
                );
                if (result) {
                    launchPrompt = result.commandArg;
                }
            }
            const launch = await buildAgentLaunchCommand(launchContext, {
                preferResume: false,
                prompt: launchPrompt,
            });

            // Initialize session file
            const agentName = launchContext.codeAgent?.name;
            if (!agentName) {
                throw new Error('Failed to resolve code agent for session');
            }
            const sessionFilePath = getSessionFilePath(worktreePath);
            const sessionId = `session-${Date.now()}`;
            await fs.mkdir(path.dirname(sessionFilePath), { recursive: true });
            await fs.writeFile(
                sessionFilePath,
                JSON.stringify(
                    {
                        sessionId,
                        timestamp: new Date().toISOString(),
                        agentName,
                        workflow: launchContext.effectiveWorkflow ?? undefined,
                        permissionMode: permissionMode ?? undefined,
                    },
                    null,
                    2
                ),
                'utf-8'
            );

            if (launchContext.effectiveWorkflow) {
                await saveSessionWorkflow(worktreePath, launchContext.effectiveWorkflow);
            }

            if (permissionMode) {
                await saveSessionPermissionMode(worktreePath, permissionMode);
            }

            const terminalMode = this.normalizeTerminalMode(
                this.ctx.config.get('lanes.terminalMode') as string | undefined
            );
            let command = launch.command;
            if (TmuxService.isTmuxMode(terminalMode)) {
                const tmuxInstalled = await TmuxService.isTmuxInstalled();
                if (tmuxInstalled) {
                    const tmuxResult = await TmuxService.launchInTmux({
                        sessionName: name,
                        worktreePath,
                        command: launch.command,
                    });
                    await saveSessionTerminalMode(worktreePath, 'tmux');
                    command = tmuxResult.attachCommand;
                }
            } else {
                await saveSessionTerminalMode(worktreePath, 'vscode');
            }

            this.ctx.notificationEmitter.sessionCreated(name, worktreePath);

            return { sessionName: name, worktreePath, sessionId, command };
        } catch (err) {
            try {
                await execGit(
                    ['worktree', 'remove', worktreePath, '--force'],
                    this.ctx.workspaceRoot
                );
            } catch {
                // Best effort cleanup
            }
            throw err;
        }
    }

    async handleSessionDelete(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);
        const deleteWorktree = (params.deleteWorktree as boolean) ?? true;

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const sanitizedName = TmuxService.sanitizeTmuxSessionName(sessionName);
        await TmuxService.killSession(sanitizedName);

        if (deleteWorktree) {
            await execGit(
                ['worktree', 'remove', worktreePath, '--force'],
                this.ctx.workspaceRoot
            );
        }

        this.ctx.notificationEmitter.sessionDeleted(sessionName);

        return { success: true };
    }

    async handleSessionClear(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        await clearSessionId(worktreePath);

        return { success: true };
    }

    async handleSessionGetStatus(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const status = await getAgentStatus(worktreePath);
        const workflowStatus = await getWorkflowStatus(worktreePath);

        return { status, workflowStatus };
    }

    async handleSessionOpen(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const launchContext = await prepareAgentLaunchContext({
            worktreePath,
            workflow: null,
            permissionMode: undefined,
            defaultAgentName:
                (this.ctx.config.get('lanes.defaultAgent') as string) ?? 'claude',
            repoRoot: this.ctx.workspaceRoot,
            workflowResolver: (name: string) => this.resolveWorkflowPath(name),
        });
        const launch = await buildAgentLaunchCommand(launchContext);

        let command = launch.command;
        const terminalMode = this.normalizeTerminalMode(
            this.ctx.config.get('lanes.terminalMode') as string | undefined
        );
        if (TmuxService.isTmuxMode(terminalMode)) {
            const tmuxInstalled = await TmuxService.isTmuxInstalled();
            if (tmuxInstalled) {
                const tmuxResult = await TmuxService.launchInTmux({
                    sessionName,
                    worktreePath,
                    command: launch.command,
                });
                command = tmuxResult.attachCommand;
            }
        }

        return { success: true, worktreePath, command };
    }

    async handleSessionPin(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const existing =
            (this.ctx.config.get('lanes.pinnedSessions') as string[] | undefined) ?? [];
        if (!existing.includes(sessionName)) {
            await this.ctx.config.set('lanes.pinnedSessions', [...existing, sessionName]);
        }

        return { success: true };
    }

    async handleSessionUnpin(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const pinned =
            (this.ctx.config.get('lanes.pinnedSessions') as string[] | undefined) ?? [];
        const updated = pinned.filter((n) => n !== sessionName);
        await this.ctx.config.set('lanes.pinnedSessions', updated);

        return { success: true };
    }

    // ---------------------------------------------------------------------------
    // Insights handlers
    // ---------------------------------------------------------------------------

    async handleSessionInsights(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);
        const includeAnalysis = (params.includeAnalysis as boolean) ?? true;

        const worktreePath = path.join(
            this.ctx.workspaceRoot,
            getWorktreesFolder(),
            sessionName
        );

        let insights: SessionInsights;
        try {
            insights = await generateInsights(worktreePath);
        } catch (err: unknown) {
            if (
                err instanceof Error &&
                'code' in err &&
                (err as NodeJS.ErrnoException).code === 'ENOENT'
            ) {
                return { insights: '', analysis: null, sessionName };
            }
            throw err;
        }

        const analysisResult = includeAnalysis ? analyzeInsights(insights) : null;
        const formattedReport = formatInsightsReport(sessionName, insights, analysisResult ?? undefined);

        return { insights: formattedReport, analysis: null, sessionName };
    }

    // ---------------------------------------------------------------------------
    // Git handlers
    // ---------------------------------------------------------------------------

    async handleGitListBranches(params: Record<string, unknown>): Promise<unknown> {
        const includeRemote = (params.includeRemote as boolean) ?? false;

        const args = includeRemote
            ? ['branch', '-a', '--format=%(refname:short)|%(HEAD)']
            : ['branch', '--format=%(refname:short)|%(HEAD)'];

        const output = await execGit(args, this.ctx.workspaceRoot);
        const lines = output.trim().split('\n');

        const branches = lines
            .filter((line) => line.trim())
            .map((line) => {
                const [name, head] = line.split('|');
                return { name: name.trim(), isCurrent: head === '*' };
            });

        return { branches };
    }

    private async resolveBaseBranch(
        worktreePath: string,
        explicitBranch: string | undefined
    ): Promise<string> {
        if (explicitBranch) {
            const refValidation = validateComparisonRef(explicitBranch);
            if (!refValidation.valid) {
                throw new ValidationError('baseBranch', explicitBranch, refValidation.error ?? 'Invalid baseBranch');
            }
            return DiffService.getBaseBranch(worktreePath, explicitBranch);
        }
        const configBranch = (this.ctx.config.get('lanes.baseBranch') as string) ?? '';
        return DiffService.getBaseBranch(worktreePath, configBranch);
    }

    async handleGitGetDiff(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);
        const includeUncommitted = (params.includeUncommitted as boolean) ?? true;

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const resolvedBaseBranch = await this.resolveBaseBranch(
            worktreePath,
            params.baseBranch as string | undefined
        );

        const warnedBranches = new Set<string>();
        const diff = await DiffService.generateDiffContent(
            worktreePath,
            resolvedBaseBranch,
            warnedBranches,
            { includeUncommitted }
        );

        return { diff, baseBranch: resolvedBaseBranch };
    }

    async handleGitGetDiffFiles(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);
        const includeUncommitted = (params.includeUncommitted as boolean) ?? true;

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const resolvedBaseBranch = await this.resolveBaseBranch(
            worktreePath,
            params.baseBranch as string | undefined
        );

        const warnedBranches = new Set<string>();
        const files = await DiffService.generateDiffFiles(
            worktreePath,
            resolvedBaseBranch,
            warnedBranches,
            { includeUncommitted }
        );

        return { files, baseBranch: resolvedBaseBranch };
    }

    async handleGitGetWorktreeInfo(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const output = await execGit(
            ['worktree', 'list', '--porcelain'],
            this.ctx.workspaceRoot
        );
        const lines = output.trim().split('\n');

        let currentPath = '';
        let currentBranch = '';
        let currentCommit = '';

        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                currentPath = line.substring('worktree '.length);
            } else if (line.startsWith('branch ')) {
                currentBranch = line
                    .substring('branch '.length)
                    .replace('refs/heads/', '');
            } else if (line.startsWith('HEAD ')) {
                currentCommit = line.substring('HEAD '.length);
            } else if (line === '' && currentPath === worktreePath) {
                return {
                    worktree: {
                        path: currentPath,
                        branch: currentBranch,
                        commit: currentCommit,
                    },
                };
            }
        }

        // Check the last accumulated entry (no trailing empty line in porcelain output)
        if (currentPath === worktreePath) {
            return {
                worktree: {
                    path: currentPath,
                    branch: currentBranch,
                    commit: currentCommit,
                },
            };
        }

        return { worktree: null };
    }

    async handleGitRepairWorktrees(params: Record<string, unknown>): Promise<unknown> {
        const detectOnly = (params.detectOnly as boolean) ?? false;

        const worktreesFolder = getWorktreesFolder();
        const broken = await BrokenWorktreeService.detectBrokenWorktrees(
            this.ctx.workspaceRoot,
            worktreesFolder
        );

        if (detectOnly) {
            return {
                broken: broken.map((b) => ({
                    sessionName: b.sessionName,
                    worktreePath: b.path,
                    reason: 'Git metadata directory missing',
                })),
                repairResult: null,
            };
        }

        const repairResult = await BrokenWorktreeService.repairBrokenWorktrees(
            this.ctx.workspaceRoot,
            broken
        );

        return {
            broken: broken.map((b) => ({
                sessionName: b.sessionName,
                worktreePath: b.path,
                reason: 'Git metadata directory missing',
            })),
            repairResult: {
                successCount: repairResult.successCount,
                failures: repairResult.failures,
            },
        };
    }

    // ---------------------------------------------------------------------------
    // Workflow handlers
    // ---------------------------------------------------------------------------

    async handleWorkflowList(params: Record<string, unknown>): Promise<unknown> {
        const includeBuiltin = (params.includeBuiltin as boolean) ?? true;
        const includeCustom = (params.includeCustom as boolean) ?? true;
        const extensionPath = await this.resolveExtensionPath();

        const allWorkflows = await discoverWorkflows({
            extensionPath,
            workspaceRoot: this.ctx.workspaceRoot,
            customWorkflowsFolder:
                (this.ctx.config.get('lanes.customWorkflowsFolder') as string) ??
                '.lanes/workflows',
        });

        const workflows = allWorkflows.filter((w) => {
            if (w.isBuiltIn && !includeBuiltin) {
                return false;
            }
            if (!w.isBuiltIn && !includeCustom) {
                return false;
            }
            return true;
        });

        return {
            workflows: workflows.map((w) => ({
                name: w.name,
                path: w.path,
                description: w.description,
                isBuiltin: w.isBuiltIn,
            })),
        };
    }

    async handleWorkflowValidate(params: Record<string, unknown>): Promise<unknown> {
        const workflowPath = params.workflowPath as string;

        if (!workflowPath) {
            throw new Error('Missing required parameter: workflowPath');
        }

        if (path.isAbsolute(workflowPath)) {
            this.assertPathWithinWorkspace(workflowPath, 'Workflow path');
        } else if (workflowPath.split(/[\\/]/).includes('..')) {
            throw new Error('Workflow path must not contain parent directory traversal');
        }

        const extensionPath = await this.resolveExtensionPath();
        const result = await validateWorkflow(
            workflowPath,
            extensionPath,
            this.ctx.workspaceRoot
        );

        return {
            isValid: result.isValid,
            errors: result.isValid
                ? []
                : [
                      `Workflow not found. Available: ${result.availableWorkflows.join(
                          ', '
                      )}`,
                  ],
        };
    }

    async handleWorkflowCreate(params: Record<string, unknown>): Promise<unknown> {
        const name = params.name as string;
        const content = params.content as string;

        if (!name || !content) {
            throw new Error('Missing required parameters: name and content');
        }
        validateWorkflowName(name);

        const customWorkflowsFolder =
            (this.ctx.config.get('lanes.customWorkflowsFolder') as string) ?? '.lanes/workflows';
        const workflowsDir = path.join(this.ctx.workspaceRoot, customWorkflowsFolder);
        const workflowPath = path.join(workflowsDir, `${name}.yaml`);

        await fs.mkdir(workflowsDir, { recursive: true });
        await fs.writeFile(workflowPath, content, 'utf-8');

        return { path: workflowPath };
    }

    async handleWorkflowGetState(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);
        const statePath = path.join(worktreePath, 'workflow-state.json');

        try {
            const state = await readJson(statePath);
            return { state: state ?? null };
        } catch {
            return { state: null };
        }
    }

    // ---------------------------------------------------------------------------
    // Agent handlers
    // ---------------------------------------------------------------------------

    async handleAgentList(_params: Record<string, unknown>): Promise<unknown> {
        const agentNames = getAvailableAgents();
        const agents = agentNames
            .map((name) => {
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
                    logoSvg: undefined,
                    permissionModes: agent
                        .getPermissionModes()
                        .map((pm: { id: string; label: string; flag?: string }) => ({
                            id: pm.id,
                            label: pm.label,
                            flag: pm.flag,
                        })),
                };
            })
            .filter(Boolean);

        return { agents };
    }

    async handleAgentGetConfig(params: Record<string, unknown>): Promise<unknown> {
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
                permissionModes: agent
                    .getPermissionModes()
                    .map((pm: { id: string; label: string; flag?: string }) => ({
                        id: pm.id,
                        label: pm.label,
                        flag: pm.flag,
                    })),
            },
        };
    }

    // ---------------------------------------------------------------------------
    // Config handlers
    // ---------------------------------------------------------------------------

    async handleConfigGet(params: Record<string, unknown>): Promise<unknown> {
        const key = params.key as string;

        if (!key) {
            throw new Error('Missing required parameter: key');
        }

        if (!VALID_CONFIG_KEYS.includes(key)) {
            throw new JsonRpcHandlerError(
                -32602,
                `Invalid config key: ${key}. Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`
            );
        }

        const value = this.ctx.config.get(key);
        return { value: value ?? null };
    }

    async handleConfigSet(params: Record<string, unknown>): Promise<unknown> {
        const key = params.key as string;
        const value = params.value;

        if (!key || value === undefined) {
            throw new Error('Missing required parameters: key and value');
        }

        if (!VALID_CONFIG_KEYS.includes(key)) {
            throw new Error(`Unknown configuration key: ${key}`);
        }

        await this.ctx.config.set(key, value);
        return { success: true };
    }

    async handleConfigGetAll(params: Record<string, unknown>): Promise<unknown> {
        const prefix = params.prefix as string | undefined;
        const config = this.ctx.config.getAll(prefix);
        return { config };
    }

    // ---------------------------------------------------------------------------
    // Terminal handlers
    // ---------------------------------------------------------------------------

    async handleTerminalCreate(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);
        const command = params.command as string | undefined;

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const sanitizedName = TmuxService.sanitizeTmuxSessionName(sessionName);
        await TmuxService.createSession(sanitizedName, worktreePath);

        if (command) {
            await TmuxService.sendCommand(sanitizedName, command);
        }

        return {
            terminalName: sanitizedName,
            attachCommand: `tmux attach-session -t "${sanitizedName}"`,
        };
    }

    async handleTerminalSend(params: Record<string, unknown>): Promise<unknown> {
        const terminalName = params.terminalName as string;
        validateTerminalName(terminalName);
        const text = params.text as string;

        if (!text) {
            throw new Error('Missing required parameter: text');
        }

        await TmuxService.sendCommand(terminalName, text);
        return { success: true };
    }

    async handleTerminalList(params: Record<string, unknown>): Promise<unknown> {
        const sessionNameFilter = params.sessionName as string | undefined;
        const sessionNames = await TmuxService.listSessions();

        const terminals = sessionNames
            .filter((name) => !sessionNameFilter || name === sessionNameFilter)
            .map((name) => ({ name, sessionName: name }));

        return { terminals };
    }

    // ---------------------------------------------------------------------------
    // File watcher handlers
    // ---------------------------------------------------------------------------

    async handleFileWatcherWatch(params: Record<string, unknown>): Promise<unknown> {
        const basePath = params.basePath as string;
        const pattern = params.pattern as string;

        if (!basePath || !pattern) {
            throw new Error('Missing required parameters: basePath and pattern');
        }
        this.validateWatchPath(basePath);
        this.validateWatchPattern(pattern);

        const watchId = this.ctx.fileWatchManager.watch(basePath, pattern);
        return { watchId };
    }

    async handleFileWatcherUnwatch(params: Record<string, unknown>): Promise<unknown> {
        const watchId = params.watchId as string;

        if (!watchId) {
            throw new Error('Missing required parameter: watchId');
        }

        const success = await this.ctx.fileWatchManager.unwatch(watchId);
        return { success };
    }
}
