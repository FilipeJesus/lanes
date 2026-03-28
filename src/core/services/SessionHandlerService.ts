/**
 * SessionHandlerService - Protocol-agnostic handler layer.
 *
 * Encapsulates all request-handler methods behind a reusable service class.
 * By depending only on the IHandlerContext interfaces, the same business
 * logic can be reused by the daemon transport and any future adapters.
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
import * as os from 'os';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { execGit } from '../gitService';
import {
    getSessionFilePath,
    getAgentStatus,
    getSessionId,
    clearSessionId,
    getSessionChimeEnabled,
    getSessionNameFromWorktree,
    getWorktreesFolder,
    getWorkflowStatus,
    saveSessionWorkflow,
    saveSessionPermissionMode,
    saveSessionTerminalMode,
    saveSessionTmuxName,
    setSessionChimeEnabled,
    getSessionTmuxName,
    getSessionTerminalMode,
    getSessionAgentName,
} from '../session/SessionDataService';
import { ValidationError } from '../errors/ValidationError';
import * as TmuxService from './TmuxService';
import { TmuxTerminalIOProvider } from './TmuxTerminalIOProvider';
import * as DiffService from './DiffService';
import * as BrokenWorktreeService from './BrokenWorktreeService';
import { discoverWorkflows } from '../workflow/discovery';
import { loadWorkflowTemplateFromString, WorkflowValidationError } from '../workflow';
import { BLANK_WORKFLOW_TEMPLATE, validateWorkflow } from './WorkflowService';
import { assemblePrompt, writePromptFile } from './PromptService';
import { getAgent, getAvailableAgents } from '../codeAgents';
import { readJson, writeJson } from './FileService';
import { buildAgentLaunchCommand, prepareAgentLaunchContext } from './AgentLaunchSetupService';
import * as PreflightService from './PreflightService';
import { IHandlerContext } from '../interfaces/IHandlerContext';
import { validateSessionName as coreValidateSessionName, validateComparisonRef } from '../validation';
import { generateInsights, formatInsightsReport, SessionInsights } from './InsightsService';
import { analyzeInsights } from './InsightsAnalyzer';
import type { SettingsScope, SettingsView } from './UnifiedSettingsService';
import { CodeAgent } from '../codeAgents/CodeAgent';

const MAX_SESSION_FORM_ATTACHMENTS = 20;
const MAX_PROMPT_IMPROVE_STDOUT = 1024 * 1024;

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
 * the transport layer (daemon, tests, future adapters, etc.).
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
            // Backward compatibility for legacy IDE-backed config values.
            return 'vscode';
        }
        return mode ?? 'vscode';
    }

    private getDefaultAgentName(): string {
        return (this.ctx.config.get('lanes.defaultAgent') as string | undefined) ?? 'claude';
    }

    private resolveLaunchAgent(agentName?: string): CodeAgent {
        const defaultAgentName = this.getDefaultAgentName();
        return getAgent(agentName ?? defaultAgentName)
            ?? getAgent(defaultAgentName)
            ?? getAgent('claude')!;
    }

    private async assertSessionLaunchPrerequisites(
        codeAgent: CodeAgent,
        preferredTerminalMode?: string | null
    ): Promise<void> {
        const terminalMode = this.normalizeTerminalMode(
            preferredTerminalMode ?? this.ctx.config.get('lanes.terminalMode') as string | undefined
        );

        await PreflightService.assertSessionLaunchPrerequisites({
            codeAgent,
            terminalMode,
        });
    }

    private async prepareTerminalLaunch(
        sessionName: string,
        worktreePath: string,
        agentCommand: string,
        preferredTerminalMode?: string | null,
        codeAgent?: ReturnType<typeof getAgent>
    ): Promise<{
        terminalMode: 'vscode' | 'tmux';
        command: string;
        attachCommand?: string;
        tmuxSessionName?: string;
    }> {
        const terminalMode = this.normalizeTerminalMode(
            preferredTerminalMode ?? this.ctx.config.get('lanes.terminalMode') as string | undefined
        );

        if (TmuxService.isTmuxMode(terminalMode)) {
            const tmuxInstalled = await TmuxService.isTmuxInstalled();
            if (!tmuxInstalled) {
                throw new Error('tmux is not installed. Install tmux or switch lanes.terminalMode to vscode.');
            }

            const beforeLaunchTimestamp = codeAgent && !codeAgent.supportsHooks() ? new Date() : undefined;
            const tmuxResult = await TmuxService.launchInTmux({
                sessionName,
                worktreePath,
                command: agentCommand,
            });
            await saveSessionTerminalMode(worktreePath, 'tmux');
            await saveSessionTmuxName(worktreePath, tmuxResult.tmuxSessionName);
            if (codeAgent && !codeAgent.supportsHooks() && beforeLaunchTimestamp) {
                this.captureHooklessTmuxSession(worktreePath, codeAgent, beforeLaunchTimestamp);
            }
            return {
                terminalMode: 'tmux',
                command: tmuxResult.attachCommand,
                attachCommand: tmuxResult.attachCommand,
                tmuxSessionName: tmuxResult.tmuxSessionName,
            };
        }

        await saveSessionTerminalMode(worktreePath, 'vscode');
        return {
            terminalMode: 'vscode',
            command: agentCommand,
        };
    }

    private captureHooklessTmuxSession(
        worktreePath: string,
        codeAgent: NonNullable<ReturnType<typeof getAgent>>,
        beforeTimestamp: Date
    ): void {
        void (async () => {
            try {
                const result = await codeAgent.captureSessionId(beforeTimestamp);
                if (!result) {
                    return;
                }

                const sessionFilePath = getSessionFilePath(worktreePath);
                let existingData: Record<string, unknown> = {};
                const parsed = await readJson<Record<string, unknown>>(sessionFilePath);
                if (parsed) {
                    existingData = parsed;
                }

                await writeJson(sessionFilePath, {
                    ...existingData,
                    sessionId: result.sessionId,
                    logPath: result.logPath,
                    timestamp: new Date().toISOString(),
                });
            } catch (err) {
                console.warn('Lanes: Failed to capture tmux session metadata for hookless agent:', err);
            }
        })();
    }

    private buildCreateSessionPrompt(
        prompt: string | undefined,
        effectiveWorkflow: string | null,
        attachments: string[] = []
    ): string | undefined {
        return assemblePrompt({
            userPrompt: this.assembleSessionPrompt(prompt, attachments),
            effectiveWorkflow
        });
    }

    private assembleSessionPrompt(prompt: string | undefined, attachments: string[]): string | undefined {
        const validAttachments = attachments
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .filter((value) => value.length > 0);
        const trimmedPrompt = prompt?.trim() || '';
        let combined = '';

        if (validAttachments.length > 0) {
            combined += 'Attached files:\n';
            for (const filePath of validAttachments) {
                combined += `- ${filePath}\n`;
            }
            combined += '\n';
        }

        if (trimmedPrompt) {
            combined += trimmedPrompt;
        }

        return combined || undefined;
    }

    private getWebAttachmentDirectory(): string {
        const workspaceHash = createHash('sha256')
            .update(this.ctx.workspaceRoot)
            .digest('hex')
            .slice(0, 12);
        return path.join(os.tmpdir(), 'lanes-web-attachments', workspaceHash);
    }

    private sanitizeAttachmentFilename(name: string): string {
        const baseName = path.basename(name).trim();
        const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-');
        return sanitized || 'attachment';
    }

    private async validateSessionAttachmentPaths(rawAttachments: unknown): Promise<string[]> {
        if (!Array.isArray(rawAttachments)) {
            return [];
        }
        if (rawAttachments.length > MAX_SESSION_FORM_ATTACHMENTS) {
            throw new Error(`Too many attachments. Maximum ${MAX_SESSION_FORM_ATTACHMENTS} files allowed.`);
        }

        const uploadRoot = path.resolve(this.getWebAttachmentDirectory());
        const resolvedAttachments: string[] = [];

        for (const entry of rawAttachments) {
            if (typeof entry !== 'string') {
                throw new Error('Attachment paths must be strings');
            }

            const trimmed = entry.trim();
            if (!trimmed) {
                continue;
            }

            const normalized = path.resolve(trimmed);
            const relative = path.relative(uploadRoot, normalized);
            if (relative.startsWith('..') || path.isAbsolute(relative)) {
                throw new Error('Invalid attachment path');
            }

            const stat = await fs.stat(normalized).catch(() => null);
            if (!stat || !stat.isFile()) {
                throw new Error(`Attachment file not found: ${path.basename(normalized)}`);
            }

            resolvedAttachments.push(normalized);
        }

        return resolvedAttachments;
    }

    private async runPromptImproveCommand(command: string, args: string[]): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const child = execFile(
                command,
                args,
                {
                    timeout: 60000,
                    maxBuffer: MAX_PROMPT_IMPROVE_STDOUT,
                },
                (error, stdout) => {
                    if (error) {
                        const execError = error as { killed?: boolean; signal?: string };
                        if (execError.killed || execError.signal === 'SIGTERM') {
                            reject(new Error('Agent command timed out'));
                            return;
                        }
                        reject(new Error(`Agent command failed: ${error.message}`));
                        return;
                    }

                    const result = stdout.trim();
                    if (!result) {
                        reject(new Error('Agent returned empty response'));
                        return;
                    }

                    resolve(result);
                }
            );

            child.stdin?.end();
        });
    }

    private async buildSessionResponse(sessionName: string, worktreePath: string): Promise<{
        name: string;
        worktreePath: string;
        branch: string;
        data: Awaited<ReturnType<typeof getSessionId>>;
        status: Awaited<ReturnType<typeof getAgentStatus>>;
        workflowStatus: Awaited<ReturnType<typeof getWorkflowStatus>>;
        isPinned: boolean;
        notificationsEnabled: boolean;
    }> {
        const pinnedSessions =
            (this.ctx.config.get('lanes.pinnedSessions') as string[] | undefined) ?? [];

        return {
            name: sessionName,
            worktreePath,
            branch: sessionName,
            data: await getSessionId(worktreePath),
            status: await getAgentStatus(worktreePath),
            workflowStatus: await getWorkflowStatus(worktreePath),
            isPinned: pinnedSessions.includes(sessionName),
            notificationsEnabled: await getSessionChimeEnabled(worktreePath),
        };
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

    private async assertSessionExists(sessionName: string, worktreePath: string): Promise<void> {
        try {
            const stat = await fs.stat(worktreePath);
            if (!stat.isDirectory()) {
                throw new JsonRpcHandlerError(-32601, `Session not found: ${sessionName}`);
            }
        } catch (err) {
            if (err instanceof JsonRpcHandlerError) {
                throw err;
            }
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                throw new JsonRpcHandlerError(-32601, `Session not found: ${sessionName}`);
            }
            throw err;
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

    private parseConfigView(scope: unknown): SettingsView {
        if (scope === undefined || scope === null || scope === '') {
            return 'effective';
        }
        if (scope === 'effective' || scope === 'global' || scope === 'local') {
            return scope;
        }
        throw new JsonRpcHandlerError(-32602, 'Invalid config scope. Valid scopes: effective, global, local');
    }

    private parseConfigWriteScope(scope: unknown): SettingsScope {
        if (scope === undefined || scope === null || scope === '') {
            return 'local';
        }
        if (scope === 'global' || scope === 'local') {
            return scope;
        }
        throw new JsonRpcHandlerError(-32602, 'Invalid config write scope. Valid scopes: global, local');
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
                const session = await this.buildSessionResponse(sessionName, worktreePath);

                if (!includeInactive && !this.isSessionActive(session.status as { status?: string } | null)) {
                    continue;
                }

                sessions.push(session);
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
        const attachments = await this.validateSessionAttachmentPaths(params.attachments);

        if (!name) {
            throw new Error('Missing required parameter: name');
        }
        validateSessionName(name);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, name);
        const codeAgent = this.resolveLaunchAgent(agent);

        await this.assertSessionLaunchPrerequisites(codeAgent);

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
                defaultAgentName: this.getDefaultAgentName(),
                repoRoot: this.ctx.workspaceRoot,
                workflowResolver: (name: string) => this.resolveWorkflowPath(name),
            });
            const startPrompt = this.buildCreateSessionPrompt(
                prompt,
                launchContext.effectiveWorkflow,
                attachments
            );
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

            const terminalLaunch = await this.prepareTerminalLaunch(
                name,
                worktreePath,
                launch.command,
                undefined,
                launchContext.codeAgent
            );

            this.ctx.notificationEmitter.sessionCreated(name, worktreePath);

            return {
                sessionName: name,
                worktreePath,
                sessionId,
                command: terminalLaunch.command,
                terminalMode: terminalLaunch.terminalMode,
                attachCommand: terminalLaunch.attachCommand,
                tmuxSessionName: terminalLaunch.tmuxSessionName,
            };
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

    async handleSessionFormPromptImprove(params: Record<string, unknown>): Promise<unknown> {
        const prompt = typeof params.prompt === 'string' ? params.prompt.trim() : '';
        const requestedAgent = typeof params.agent === 'string' ? params.agent.trim() : '';
        if (!prompt) {
            throw new Error('Missing required parameter: prompt');
        }

        const defaultAgentName =
            (this.ctx.config.get('lanes.defaultAgent') as string | undefined) ?? 'claude';
        const agent = getAgent(requestedAgent || defaultAgentName) ?? getAgent(defaultAgentName);
        if (!agent) {
            throw new Error('Failed to resolve code agent for prompt improvement');
        }

        const command = agent.buildPromptImproveCommand(prompt);
        if (!command) {
            throw new Error(`${agent.displayName} does not support prompt improvement`);
        }

        const improvedPrompt = await this.runPromptImproveCommand(command.command, command.args);
        return { improvedPrompt };
    }

    async handleSessionFormAttachmentUpload(params: Record<string, unknown>): Promise<unknown> {
        const rawFiles = params.files;
        if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
            throw new Error('Missing required parameter: files');
        }
        if (rawFiles.length > MAX_SESSION_FORM_ATTACHMENTS) {
            throw new Error(`Too many attachments. Maximum ${MAX_SESSION_FORM_ATTACHMENTS} files allowed.`);
        }

        const targetDir = this.getWebAttachmentDirectory();
        await fs.mkdir(targetDir, { recursive: true });

        const files: Array<Record<string, unknown>> = [];
        for (const rawFile of rawFiles) {
            if (!rawFile || typeof rawFile !== 'object' || Array.isArray(rawFile)) {
                throw new Error('Each attachment must be an object');
            }

            const name = typeof rawFile.name === 'string' ? rawFile.name.trim() : '';
            const data = typeof rawFile.data === 'string' ? rawFile.data.trim() : '';
            const sourceKey = typeof rawFile.sourceKey === 'string' ? rawFile.sourceKey : undefined;
            if (!name || !data) {
                throw new Error('Attachment must include name and data');
            }
            if (!/^[A-Za-z0-9+/=]+$/.test(data)) {
                throw new Error(`Attachment ${name} is not valid base64 data`);
            }

            const buffer = Buffer.from(data, 'base64');
            const safeName = this.sanitizeAttachmentFilename(name);
            const storedPath = path.join(targetDir, `${randomUUID()}-${safeName}`);
            await fs.writeFile(storedPath, buffer);

            files.push({
                name,
                path: storedPath,
                size: buffer.byteLength,
                sourceKey,
            });
        }

        return { files };
    }

    async handleSessionDelete(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);
        const deleteWorktree = (params.deleteWorktree as boolean) ?? true;

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        const tmuxSessionName =
            (await getSessionTmuxName(worktreePath))
            ?? TmuxService.sanitizeTmuxSessionName(sessionName);
        await TmuxService.killSession(tmuxSessionName);

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
        const savedTerminalMode = await getSessionTerminalMode(worktreePath);
        const sessionAgentName = await getSessionAgentName(worktreePath);

        await this.assertSessionLaunchPrerequisites(
            this.resolveLaunchAgent(sessionAgentName),
            savedTerminalMode
        );

        const launchContext = await prepareAgentLaunchContext({
            worktreePath,
            workflow: null,
            permissionMode: undefined,
            agentName: sessionAgentName,
            defaultAgentName: this.getDefaultAgentName(),
            repoRoot: this.ctx.workspaceRoot,
            workflowResolver: (name: string) => this.resolveWorkflowPath(name),
        });
        const launch = await buildAgentLaunchCommand(launchContext);

        const terminalLaunch = await this.prepareTerminalLaunch(
            sessionName,
            worktreePath,
            launch.command,
            savedTerminalMode,
            launchContext.codeAgent
        );

        return {
            success: true,
            worktreePath,
            command: terminalLaunch.command,
            terminalMode: terminalLaunch.terminalMode,
            attachCommand: terminalLaunch.attachCommand,
            tmuxSessionName: terminalLaunch.tmuxSessionName,
        };
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

    async handleSessionEnableNotifications(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        await this.assertSessionExists(sessionName, worktreePath);
        await setSessionChimeEnabled(worktreePath, true);

        return this.buildSessionResponse(sessionName, worktreePath);
    }

    async handleSessionDisableNotifications(params: Record<string, unknown>): Promise<unknown> {
        const sessionName = params.sessionName as string;
        validateSessionName(sessionName);

        const worktreesFolder = getWorktreesFolder();
        const worktreePath = path.join(this.ctx.workspaceRoot, worktreesFolder, sessionName);

        await this.assertSessionExists(sessionName, worktreePath);
        await setSessionChimeEnabled(worktreePath, false);

        return this.buildSessionResponse(sessionName, worktreePath);
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
                steps: w.steps,
            })),
        };
    }

    async handleWorkflowValidate(params: Record<string, unknown>): Promise<unknown> {
        const workflowPath = params.workflowPath as string | undefined;
        const content = params.content as string | undefined;

        if (content !== undefined) {
            try {
                const template = loadWorkflowTemplateFromString(content);
                return {
                    isValid: true,
                    errors: [],
                    workflowName: template.name,
                };
            } catch (error) {
                const message = error instanceof WorkflowValidationError
                    ? error.message
                    : `Invalid YAML: ${error instanceof Error ? error.message : String(error)}`;
                return {
                    isValid: false,
                    errors: [message],
                };
            }
        }

        if (!workflowPath) {
            throw new Error('Missing required parameter: workflowPath or content');
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
        const sourceWorkflowName = params.from as string | undefined;
        let content = params.content as string | undefined;

        if (!name) {
            throw new Error('Missing required parameter: name');
        }
        validateWorkflowName(name);

        const customWorkflowsFolder =
            (this.ctx.config.get('lanes.customWorkflowsFolder') as string) ?? '.lanes/workflows';
        const workflowsDir = path.join(this.ctx.workspaceRoot, customWorkflowsFolder);
        const workflowPath = path.join(workflowsDir, `${name}.yaml`);

        if (!content && sourceWorkflowName) {
            const extensionPath = await this.resolveExtensionPath();
            const templates = await discoverWorkflows({
                extensionPath,
                workspaceRoot: this.ctx.workspaceRoot,
                customWorkflowsFolder,
            });
            const source = templates.find((template) => template.name === sourceWorkflowName);
            if (!source) {
                throw new Error(
                    `Template '${sourceWorkflowName}' not found. Run 'lanes workflow list' to see available templates.`
                );
            }
            const sourceContent = await fs.readFile(source.path, 'utf-8');
            content = sourceContent.replace(/^name:\s*.+$/m, `name: ${name}`);
        }

        if (!content) {
            content = BLANK_WORKFLOW_TEMPLATE.replace('name: my-workflow', `name: ${name}`);
        }

        await fs.mkdir(workflowsDir, { recursive: true });
        try {
            await fs.access(workflowPath);
            throw new Error(`Workflow '${name}' already exists at ${workflowPath}`);
        } catch (error) {
            const maybeNodeError = error as NodeJS.ErrnoException;
            if (maybeNodeError.code !== 'ENOENT') {
                throw error;
            }
        }
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
        const scope = this.parseConfigView(params.scope);

        if (!key) {
            throw new Error('Missing required parameter: key');
        }

        if (!VALID_CONFIG_KEYS.includes(key)) {
            throw new JsonRpcHandlerError(
                -32602,
                `Invalid config key: ${key}. Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`
            );
        }

        const value = this.ctx.config.get(key, scope);
        return { value: value ?? null, scope };
    }

    async handleConfigSet(params: Record<string, unknown>): Promise<unknown> {
        const key = params.key as string;
        const value = params.value;
        const scope = this.parseConfigWriteScope(params.scope);

        if (!key || value === undefined) {
            throw new Error('Missing required parameters: key and value');
        }

        if (!VALID_CONFIG_KEYS.includes(key)) {
            throw new JsonRpcHandlerError(
                -32602,
                `Invalid config key: ${key}. Valid keys: ${VALID_CONFIG_KEYS.join(', ')}`
            );
        }

        await this.ctx.config.set(key, value, scope);
        return { success: true, scope };
    }

    async handleConfigGetAll(params: Record<string, unknown>): Promise<unknown> {
        const prefix = params.prefix as string | undefined;
        const scope = this.parseConfigView(params.scope);
        const config = this.ctx.config.getAll(prefix, scope);
        return { config, scope };
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

    async handleTerminalOutput(params: Record<string, unknown>): Promise<unknown> {
        const name = params.name as string;
        validateTerminalName(name);

        const provider = new TmuxTerminalIOProvider();
        const outputData = await provider.readOutput(name);

        return outputData;
    }

    async handleTerminalResize(params: Record<string, unknown>): Promise<unknown> {
        const name = params.name as string;
        validateTerminalName(name);

        const cols = params.cols as number | undefined;
        const rows = params.rows as number | undefined;

        if (cols === undefined || rows === undefined) {
            throw new Error('Missing required parameters: cols and rows');
        }

        if (typeof cols !== 'number' || typeof rows !== 'number') {
            throw new Error('Parameters cols and rows must be numbers');
        }

        if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
            throw new Error('Parameters cols and rows must be integers');
        }

        if (cols < 1 || cols > 10000 || rows < 1 || rows > 10000) {
            throw new Error('Parameters cols and rows must be between 1 and 10000');
        }

        const provider = new TmuxTerminalIOProvider();
        await provider.resize(name, cols, rows);

        return { success: true };
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
