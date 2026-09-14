import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
    AgentStatus,
    CapturedSession,
    CodeAgent,
    HookConfig,
    McpConfig,
    McpConfigDelivery,
    PermissionMode,
    ResumeCommandOptions,
    SessionData,
    StartCommandOptions,
} from "./CodeAgent";

/** Google Antigravity CLI (`agy`) integration. */
export class AntigravityAgent extends CodeAgent {
    private static readonly SESSION_ID_PATTERN =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    constructor() {
        super({
            name: "antigravity",
            displayName: "Antigravity CLI",
            cliCommand: "agy",
            sessionFileExtension: ".claude-session",
            statusFileExtension: ".claude-status",
            settingsFileName: "mcp_config.json",
            defaultDataDir: ".gemini/antigravity-cli",
            logoSvg:
                '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 10 10h-4a6 6 0 1 1-6-6V2Zm1 0v9h9A10 10 0 0 0 13 2Z"/></svg>',
        });
    }

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
    getLocalSettingsFiles(): Array<{ dir: string; file: string }> {
        return [];
    }

    getTerminalName(sessionName: string): string {
        return `Antigravity: ${sessionName}`;
    }
    getTerminalIcon(): { id: string; color?: string } {
        return { id: "rocket", color: "terminal.ansiBlue" };
    }

    buildStartCommand(options: StartCommandOptions): string {
        const parts = [this.config.cliCommand];
        const permissionFlag =
            options.permissionMode &&
            this.getPermissionFlag(options.permissionMode);
        if (permissionFlag) {
            parts.push(permissionFlag);
        }
        if (options.prompt) {
            parts.push(
                "--prompt-interactive",
                this.formatPromptForShell(options.prompt),
            );
        }
        return parts.join(" ");
    }

    buildResumeCommand(
        sessionId: string,
        options: ResumeCommandOptions,
    ): string {
        if (!AntigravityAgent.SESSION_ID_PATTERN.test(sessionId)) {
            throw new Error(
                `Invalid session ID format: ${sessionId}. Expected UUID format.`,
            );
        }
        const parts = [this.config.cliCommand];
        const permissionFlag =
            options.permissionMode &&
            this.getPermissionFlag(options.permissionMode);
        if (permissionFlag) {
            parts.push(permissionFlag);
        }
        parts.push("--conversation", sessionId);
        return parts.join(" ");
    }

    parseSessionData(content: string): SessionData | null {
        try {
            const data = JSON.parse(content);
            if (
                typeof data.sessionId !== "string" ||
                !AntigravityAgent.SESSION_ID_PATTERN.test(data.sessionId)
            ) {
                return null;
            }
            return {
                ...data,
                sessionId: data.sessionId,
                agentName: this.config.name,
            };
        } catch {
            return null;
        }
    }

    parseStatus(content: string): AgentStatus | null {
        try {
            const data = JSON.parse(content);
            return typeof data.status === "string" ? data : null;
        } catch {
            return null;
        }
    }

    getValidStatusStates(): string[] {
        return ["active", "idle", "working", "waiting_for_user"];
    }
    getPermissionModes(): PermissionMode[] {
        return [
            {
                id: "acceptEdits",
                label: "Accept Edits",
                flag: "--mode accept-edits",
            },
            {
                id: "bypassPermissions",
                label: "Bypass Permissions",
                flag: "--dangerously-skip-permissions",
            },
        ];
    }
    validatePermissionMode(mode: string): boolean {
        return this.getPermissionModes().some((item) => item.id === mode);
    }
    getPermissionFlag(mode: string): string {
        return (
            this.getPermissionModes().find((item) => item.id === mode)?.flag ||
            ""
        );
    }

    getHookEvents(): string[] {
        return [];
    }
    generateHooksConfig(): HookConfig[] {
        return [];
    }

    getProjectSettingsPath(worktreePath: string): string {
        if (
            !path.isAbsolute(worktreePath) ||
            worktreePath.split(path.sep).includes("..")
        ) {
            throw new Error(
                "Antigravity settings require an absolute worktree path.",
            );
        }
        return `${worktreePath}${path.sep}.agents${path.sep}mcp_config.json`;
    }
    supportsMcp(): boolean {
        return true;
    }
    getMcpConfigDelivery(): McpConfigDelivery {
        return "settings";
    }
    getMcpConfig(
        worktreePath: string,
        workflowPath: string,
        repoRoot: string,
    ): McpConfig {
        const mcpServerPath = path.join(__dirname, "mcp", "server.js");
        return {
            mcpServers: {
                "lanes-workflow": {
                    command: process.versions.electron
                        ? "node"
                        : process.execPath,
                    args: [
                        mcpServerPath,
                        "--worktree",
                        worktreePath,
                        "--workflow-path",
                        workflowPath,
                        "--repo-root",
                        repoRoot,
                    ],
                },
            },
        };
    }

    async captureSessionIdForWorktree(
        beforeTimestamp: Date,
        worktreePath: string,
        timeoutMs = 15000,
        pollIntervalMs = 500,
    ): Promise<CapturedSession | null> {
        const root = path.join(os.homedir(), this.config.defaultDataDir);
        const cachePath = path.join(root, "cache", "last_conversations.json");
        const timeoutAt = Date.now() + timeoutMs;
        while (Date.now() < timeoutAt) {
            try {
                const stat = await fs.stat(cachePath);
                const conversations = JSON.parse(
                    await fs.readFile(cachePath, "utf8"),
                ) as Record<string, string>;
                const expectedDirectory = worktreePath.replace(/[\\/]+$/, "");
                const sessionId = Object.entries(conversations).find(
                    ([directory]) =>
                        directory.replace(/[\\/]+$/, "") === expectedDirectory,
                )?.[1];
                if (
                    stat.mtimeMs >= beforeTimestamp.getTime() &&
                    sessionId &&
                    AntigravityAgent.SESSION_ID_PATTERN.test(sessionId)
                ) {
                    return {
                        sessionId,
                        logPath: path.join(
                            root,
                            "brain",
                            sessionId,
                            ".system_generated",
                            "logs",
                            "transcript.jsonl",
                        ),
                    };
                }
            } catch {
                // Retry while Antigravity creates or updates the conversation cache.
            }
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
        return null;
    }

    buildPromptImproveCommand(prompt: string): {
        command: string;
        args: string[];
    } {
        const metaPrompt = `Improve this coding-assistant prompt. Preserve its intent and return only the rewritten prompt:\n\n${prompt}`;
        return {
            command: this.config.cliCommand,
            args: ["--print", metaPrompt],
        };
    }
}
