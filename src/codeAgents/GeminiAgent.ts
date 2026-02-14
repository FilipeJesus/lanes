/**
 * GeminiAgent - Implementation of CodeAgent for Gemini CLI
 *
 * Provides Gemini-specific implementations for command building,
 * session management, and MCP configuration delivery.
 */

import * as path from 'path';
import {
    CodeAgent,
    SessionData,
    AgentStatus,
    PermissionMode,
    HookCommand,
    HookConfig,
    StartCommandOptions,
    ResumeCommandOptions,
    McpConfig,
    McpConfigDelivery
} from './CodeAgent';

/**
 * Gemini CLI implementation of the CodeAgent interface
 *
 * Notes:
 * - MCP configuration is delivered via settings.json (project-level).
 * - Prompts are sent via stdin (no positional prompt support).
 */
export class GeminiAgent extends CodeAgent {
    private static readonly UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    private static readonly INDEX_PATTERN = /^\d+$/;
    private static readonly LATEST_SENTINEL = 'latest';

    constructor() {
        super({
            name: 'gemini',
            displayName: 'Gemini CLI',
            cliCommand: 'gemini',
            sessionFileExtension: '.claude-session',
            statusFileExtension: '.claude-status',
            settingsFileName: 'settings.json',
            defaultDataDir: '.gemini',
            logoSvg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1Q12 12 23 12Q12 12 12 23Q12 12 1 12Q12 12 12 1Z"/></svg>'
        });
    }

    // --- File Naming ---

    getSessionFileName(): string {
        return this.config.sessionFileExtension;
    }

    getStatusFileName(): string {
        return this.config.statusFileExtension;
    }

    getSettingsFileName(): string {
        return this.config.settingsFileName;
    }

    getDataDirectory(): string {
        return this.config.defaultDataDir;
    }

    // --- Local Settings ---

    getLocalSettingsFiles(): Array<{ dir: string; file: string }> {
        return [{ dir: '.gemini', file: 'settings.json' }];
    }

    // --- Terminal Configuration ---

    getTerminalName(sessionName: string): string {
        return `Gemini: ${sessionName}`;
    }

    getTerminalIcon(): { id: string; color?: string } {
        return {
            id: 'robot',
            color: 'terminal.ansiYellow'
        };
    }

    // --- Command Building ---

    private isValidSessionId(sessionId: string): boolean {
        return (
            GeminiAgent.UUID_PATTERN.test(sessionId) ||
            GeminiAgent.INDEX_PATTERN.test(sessionId) ||
            sessionId === GeminiAgent.LATEST_SENTINEL
        );
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts: string[] = [this.config.cliCommand];

        if (options.permissionMode) {
            const flag = this.getPermissionFlag(options.permissionMode);
            if (flag) {
                parts.push(flag);
            }
        }

        if (options.prompt) {
            parts.push(this.formatPromptForShell(options.prompt));
        }

        return parts.join(' ');
    }

    buildResumeCommand(sessionId: string, _options: ResumeCommandOptions): string {
        if (!this.isValidSessionId(sessionId)) {
            throw new Error(`Invalid session ID format: ${sessionId}. Expected UUID, numeric index, or 'latest'.`);
        }

        const parts: string[] = [this.config.cliCommand, '--resume'];
        if (sessionId !== GeminiAgent.LATEST_SENTINEL) {
            parts.push(sessionId);
        }

        return parts.join(' ');
    }

    // --- Session/Status Parsing ---

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);

            if (!data.sessionId || typeof data.sessionId !== 'string') {
                return null;
            }

            if (!this.isValidSessionId(data.sessionId)) {
                return null;
            }

            return {
                sessionId: data.sessionId,
                timestamp: data.timestamp,
                workflow: data.workflow,
                agentName: this.config.name,
                isChimeEnabled: data.isChimeEnabled
            };
        } catch {
            return null;
        }
    }

    parseStatus(content: string): AgentStatus | null {
        try {
            const data = JSON.parse(content);

            if (!data.status || typeof data.status !== 'string') {
                return null;
            }

            return {
                status: data.status,
                timestamp: data.timestamp,
                message: data.message
            };
        } catch {
            return null;
        }
    }

    getValidStatusStates(): string[] {
        return ['working', 'waiting_for_user', 'idle', 'error'];
    }

    // --- Permission Modes ---

    getPermissionModes(): PermissionMode[] {
        return [
            { id: 'acceptEdits', label: 'Accept Edits', flag: '--approval-mode auto_edit' },
            { id: 'bypassPermissions', label: 'Bypass Permissions', flag: '--approval-mode yolo' }
        ];
    }

    validatePermissionMode(mode: string): boolean {
        return this.getPermissionModes().some(m => m.id === mode);
    }

    getPermissionFlag(mode: string): string {
        const permissionMode = this.getPermissionModes().find(m => m.id === mode);
        return permissionMode?.flag || '';
    }

    // --- Hooks ---

    getHookEvents(): string[] {
        return [
            'SessionStart',
            'SessionEnd',
            'BeforeAgent',
            'AfterAgent',
            'BeforeTool',
            'AfterTool',
            'Notification'
        ];
    }

    generateHooksConfig(
        _worktreePath: string,
        _sessionFilePath: string,
        _statusFilePath: string,
        _workflowPath?: string,
        _hookScriptPath?: string
    ): HookConfig[] {
        const sessionFilePath = _sessionFilePath;
        const statusFilePath = _statusFilePath;

        const sessionCapture = this.buildSessionCaptureCommand(sessionFilePath);
        const statusWaiting = this.buildStatusCommand(statusFilePath, 'waiting_for_user');
        const statusWorking = this.buildStatusCommand(statusFilePath, 'working');
        const statusIdle = this.buildStatusCommand(statusFilePath, 'idle');

        return [
            {
                event: 'SessionStart',
                matcher: 'startup',
                commands: [sessionCapture, statusWaiting]
            },
            {
                event: 'SessionStart',
                matcher: 'resume',
                commands: [sessionCapture, statusWaiting]
            },
            {
                event: 'SessionStart',
                matcher: 'clear',
                commands: [sessionCapture, statusWaiting]
            },
            {
                event: 'BeforeAgent',
                commands: [statusWorking]
            },
            {
                event: 'AfterAgent',
                commands: [statusWaiting]
            },
            {
                event: 'BeforeTool',
                matcher: '.*',
                commands: [statusWorking]
            },
            {
                event: 'AfterTool',
                matcher: '.*',
                commands: [statusWorking]
            },
            {
                event: 'Notification',
                matcher: '*',
                commands: [statusWaiting]
            },
            {
                event: 'SessionEnd',
                matcher: '*',
                commands: [statusIdle]
            }
        ];
    }

    // --- Prompt Passing ---

    supportsPromptInCommand(): boolean {
        return true;
    }

    // --- Settings Delivery ---

    getProjectSettingsPath(worktreePath: string): string {
        return path.join(worktreePath, '.gemini', 'settings.json');
    }

    // --- MCP Support ---

    supportsMcp(): boolean {
        return true;
    }

    getMcpConfigDelivery(): McpConfigDelivery {
        return 'settings';
    }

    getMcpConfig(worktreePath: string, workflowPath: string, repoRoot: string): McpConfig | null {
        const mcpServerPath = path.join(__dirname, 'mcp', 'server.js');
        return {
            mcpServers: {
                'lanes-workflow': {
                    command: 'node',
                    args: [mcpServerPath, '--worktree', worktreePath, '--workflow-path', workflowPath, '--repo-root', repoRoot]
                }
            }
        };
    }

    // --- Hook Helpers ---

    private escapeForBashDoubleQuotes(value: string): string {
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\$/g, '\\$')
            .replace(/`/g, '\\`');
    }

    private buildAllowCommand(body: string): string {
        const escapedBody = this.escapeForBashDoubleQuotes(body);
        return `bash -lc "${escapedBody}"`;
    }

    private buildStatusCommand(statusFilePath: string, status: string): HookCommand {
        const body = `printf '{\"status\":\"${status}\"}' > \"${statusFilePath}\"; printf '{}'`;
        return {
            type: 'command',
            command: this.buildAllowCommand(body)
        };
    }

    private buildSessionCaptureCommand(sessionFilePath: string): HookCommand {
        const escapedPath = sessionFilePath.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');
        const nodeScript = [
            "const fs=require('fs');",
            `const p='${escapedPath}';`,
            "let input='';",
            "process.stdin.on('data',c=>input+=c);",
            "process.stdin.on('end',()=>{",
            "let data={};",
            "try{data=JSON.parse(fs.readFileSync(p,'utf8'))}catch{}",
            "try{const hook=JSON.parse(input);if(hook.session_id){data.sessionId=hook.session_id;}}catch{}",
            "data.timestamp=new Date().toISOString();",
            "fs.writeFileSync(p,JSON.stringify(data));",
            "process.stdout.write('{}');",
            "});"
        ].join('');
        return {
            type: 'command',
            command: `bash -lc "node -e \\"${nodeScript}\\""`
        };
    }

    // --- Prompt Improvement (Headless) ---

    buildPromptImproveCommand(prompt: string): { command: string; args: string[] } | null {
        const metaPrompt = `You are a prompt engineer. The user wants to send the following text as a starting prompt to an AI coding assistant session. Your job is to improve and restructure this prompt to be clearer, more specific, and better organized. Keep the same intent but make it more effective. Reply with the improved prompt only — no preamble, no explanation, no surrounding quotes, no "Here is the improved prompt:" prefix.

Original prompt:
${prompt}`;
        return { command: this.config.cliCommand, args: ['--prompt', metaPrompt, '--output-format', 'text'] };
    }
}
