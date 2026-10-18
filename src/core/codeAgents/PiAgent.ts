import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    CodeAgent, CapturedSession, SessionData, AgentStatus, PermissionMode,
    HookConfig, StartCommandOptions, ResumeCommandOptions, McpConfig, McpConfigDelivery
} from './CodeAgent';

/** Pi uses native project MCP configuration and JSONL sessions, without command hooks. */
export class PiAgent extends CodeAgent {
    private static readonly SESSION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/;

    constructor() {
        super({
            name: 'pi',
            displayName: 'Pi',
            cliCommand: 'pi',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'mcp.json',
            defaultDataDir: '.pi',
            logoSvg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M8 7v12M16 7v9c0 3 3 3 4 2"/></svg>'
        });
    }

    getSessionFileName(): string { return this.config.sessionFileExtension; }
    getStatusFileName(): string { return this.config.statusFileExtension; }
    getSettingsFileName(): string { return this.config.settingsFileName; }
    getDataDirectory(): string { return this.config.defaultDataDir; }
    getTerminalName(sessionName: string): string { return `Pi: ${sessionName}`; }
    getTerminalIcon(): { id: string; color?: string } {
        return { id: 'robot', color: 'terminal.ansiYellow' };
    }

    getLocalSettingsFiles(): Array<{ dir: string; file: string }> {
        return [{ dir: '.pi', file: 'settings.json' }, { dir: '.pi', file: 'mcp.json' }];
    }

    private isSessionPath(value: string): boolean {
        return path.isAbsolute(value) && value.endsWith('.jsonl') && !/[\x00-\x1f\x7f]/.test(value);
    }

    private validateSession(session: string): void {
        if (!PiAgent.SESSION_ID_PATTERN.test(session) && !this.isSessionPath(session)) {
            throw new Error('Invalid Pi session: expected a session ID or absolute JSONL path.');
        }
    }

    createSessionIdentity(sessionDirectory: string): CapturedSession {
        const sessionPath = path.resolve(sessionDirectory, `pi-${randomUUID()}.jsonl`);
        return { sessionId: sessionPath, logPath: sessionPath };
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts = [this.cliCommand];
        if (options.sessionPath) {
            if (!this.isSessionPath(options.sessionPath)) {
                throw new Error('Pi requires an absolute JSONL session path.');
            }
            parts.push('--session', `'${this.escapeForSingleQuotes(options.sessionPath)}'`);
        }
        if (options.promptFilePath) {
            if (!path.isAbsolute(options.promptFilePath)) {
                throw new Error('Pi requires an absolute prompt file path.');
            }
            // Pi treats @-prefixed positionals as attachments even after --.
            parts.push('--', `" $(cat '${this.escapeForSingleQuotes(options.promptFilePath)}')"`);
        } else if (options.prompt) {
            // Raw prompts are always data, even when they begin with a shell expression.
            // A leading space also prevents Pi from interpreting @ as an attachment.
            parts.push('--', `' ${this.escapeForSingleQuotes(options.prompt)}'`);
        }
        return parts.join(' ');
    }

    buildResumeCommand(sessionId: string, options: ResumeCommandOptions): string {
        this.validateSession(sessionId);
        if (options.sessionPath && !this.isSessionPath(options.sessionPath)) {
            throw new Error('Pi requires an absolute JSONL session path.');
        }
        const session = options.sessionPath || sessionId;
        this.validateSession(session);
        return `${this.cliCommand} --session '${this.escapeForSingleQuotes(session)}'`;
    }

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);
            if (typeof data.sessionId !== 'string') { return null; }
            this.validateSession(data.sessionId);
            return {
                sessionId: data.sessionId,
                timestamp: data.timestamp,
                workflow: data.workflow,
                agentName: this.name,
                isChimeEnabled: data.isChimeEnabled
            };
        } catch { return null; }
    }

    parseStatus(content: string): AgentStatus | null {
        try {
            const data = JSON.parse(content);
            if (!this.getValidStatusStates().includes(data.status)) { return null; }
            return { status: data.status, timestamp: data.timestamp, message: data.message };
        } catch { return null; }
    }

    getValidStatusStates(): string[] { return ['active', 'idle', 'working', 'waiting_for_user']; }
    getPermissionModes(): PermissionMode[] {
        return [{ id: 'bypassPermissions', label: 'Full Access (Pi has no permission restrictions)' }];
    }
    validatePermissionMode(mode: string): boolean { return mode === 'bypassPermissions'; }
    getPermissionFlag(_mode: string): string { return ''; }
    getHookEvents(): string[] { return []; }
    generateHooksConfig(
        _worktreePath: string, _sessionFilePath: string, _statusFilePath: string,
        _workflowPath?: string, _hookScriptPath?: string
    ): HookConfig[] { return []; }

    // Integration configuration belongs in mcp.json; never rewrite Pi's settings.json.
    getProjectSettingsPath(worktreePath: string): string { return path.join(worktreePath, '.pi', 'mcp.json'); }
    supportsMcp(): boolean { return true; }
    getMcpConfigDelivery(): McpConfigDelivery { return 'settings'; }
    getMcpConfig(worktreePath: string, workflowPath: string, repoRoot: string): McpConfig {
        return {
            mcpServers: {
                'lanes-workflow': {
                    command: process.versions.electron ? 'node' : process.execPath,
                    args: [path.join(__dirname, 'mcp', 'server.js'), '--worktree', worktreePath,
                        '--workflow-path', workflowPath, '--repo-root', repoRoot]
                }
            }
        };
    }
    formatMcpForSettings(mcpConfig: McpConfig): Record<string, unknown> {
        return {
            mcpServers: Object.fromEntries(Object.entries(mcpConfig.mcpServers).map(([name, server]) =>
                [name, { ...server, exposure: 'direct' }]))
        };
    }

    /** Discover only files whose native header identifies this exact worktree. */
    async captureSessionIdForWorktree(
        beforeTimestamp: Date, worktreePath: string, timeoutMs = 10_000, pollIntervalMs = 500
    ): Promise<CapturedSession | null> {
        const resolvedWorktree = path.resolve(worktreePath);
        const expandHome = (value: string): string => value.startsWith('~/')
            ? path.join(os.homedir(), value.slice(2)) : value;
        const agentDirectory = path.resolve(worktreePath,
            expandHome(process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi', 'agent')));
        const encodedWorktree = `--${resolvedWorktree.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
        const sessionsDirectory = process.env.PI_CODING_AGENT_SESSION_DIR
            ? path.resolve(worktreePath, expandHome(process.env.PI_CODING_AGENT_SESSION_DIR))
            : path.join(agentDirectory, 'sessions', encodedWorktree);
        const deadline = Date.now() + timeoutMs;
        do {
            try {
                const entries = await fs.readdir(sessionsDirectory, { withFileTypes: true });
                const candidates: Array<{ session: CapturedSession; timestamp: number }> = [];
                for (const entry of entries) {
                    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) { continue; }
                    const logPath = path.join(sessionsDirectory, entry.name);
                    try {
                        // Read only the header, not an entire conversation log.
                        const handle = await fs.open(logPath, 'r');
                        let header: { type?: string; id?: string; cwd?: string; timestamp?: string };
                        try {
                            const buffer = Buffer.alloc(16 * 1024);
                            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                            header = JSON.parse(buffer.toString('utf8', 0, bytesRead).split('\n')[0]);
                        } finally { await handle.close(); }
                        const timestamp = Date.parse(header.timestamp || '');
                        if (header.type === 'session' && typeof header.id === 'string'
                            && PiAgent.SESSION_ID_PATTERN.test(header.id)
                            && typeof header.cwd === 'string' && path.isAbsolute(header.cwd)
                            && path.resolve(header.cwd) === resolvedWorktree
                            && timestamp >= beforeTimestamp.getTime()) {
                            candidates.push({ session: { sessionId: header.id, logPath }, timestamp });
                        }
                    } catch { /* A file may still be being written; retry. */ }
                }
                candidates.sort((a, b) => b.timestamp - a.timestamp);
                if (candidates[0]) { return candidates[0].session; }
            } catch { /* The session directory may not exist yet. */ }
            if (Date.now() >= deadline) { break; }
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        } while (Date.now() < deadline);
        return null;
    }

    buildPromptImproveCommand(prompt: string): { command: string; args: string[] } {
        const metaPrompt = `Improve the following starting prompt for an AI coding assistant. Keep the same intent, make it clear and specific, and reply with only the improved prompt.\n\nOriginal prompt:\n${prompt}`;
        return { command: this.cliCommand, args: ['--print', '--no-session', '--', metaPrompt] };
    }
}
