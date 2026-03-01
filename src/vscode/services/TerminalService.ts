/**
 * TerminalService - Terminal creation and management for Claude sessions
 *
 * This service handles the core terminal management logic, including:
 * - Creating Claude Code terminals with proper configuration
 * - Managing terminal lifecycle (resume, start fresh)
 * - Counting and naming terminals for sessions
 * - Setting up MCP server integration for workflows
 * - Writing prompts to files for history
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { fileExists, ensureDir, writeJson, readJson } from '../../core/services/FileService';
import { SessionItem, getStatusFilePath, getSessionFilePath } from '../providers/AgentSessionProvider';
import { PermissionMode, isValidPermissionMode } from '../providers/SessionFormProvider';
import { CodeAgent, McpConfig } from '../../core/codeAgents';
import * as TmuxService from '../../core/services/TmuxService';
import { startPolling, stopPolling } from './PollingStatusService';
import { getErrorMessage } from '../../core/utils';
import { prepareAgentLaunchContext } from '../../core/services/AgentLaunchService';
import { assemblePrompt, writePromptFile } from '../../core/services/PromptService';
import {
    saveSessionPermissionMode,
    saveSessionTerminalMode,
    getSessionTerminalMode,
    getOrCreateTaskListId,
} from '../providers/AgentSessionProvider';

// Terminal close delay constant
const TERMINAL_CLOSE_DELAY_MS = 200; // Delay to ensure terminal is closed before reopening

// Track hookless agent terminals for lifecycle-based status updates
// Maps terminal instances to their worktree paths for status file management
const hooklessTerminals = new Map<vscode.Terminal, string>();

/**
 * Register terminal lifecycle tracking for hookless agents.
 * Listens to terminal close events to update status files when a hookless
 * agent's terminal is closed (sets status to 'idle').
 *
 * Must be called once during extension activation.
 * @param context The extension context to register the disposable
 */
export function registerHooklessTerminalTracking(context: vscode.ExtensionContext): void {
    const disposable = vscode.window.onDidCloseTerminal(async (terminal) => {
        const worktreePath = hooklessTerminals.get(terminal);
        if (!worktreePath) { return; }

        // Stop polling before writing idle status
        stopPolling(terminal);

        // Terminal closed - write idle status
        try {
            const statusPath = getStatusFilePath(worktreePath);
            await ensureDir(path.dirname(statusPath));
            await writeJson(statusPath, {
                status: 'idle',
                timestamp: new Date().toISOString()
            });
        } catch (err) {
            console.warn('Lanes: Failed to write idle status for hookless terminal:', getErrorMessage(err));
        }

        // Clean up the tracking entry
        hooklessTerminals.delete(terminal);
    });

    context.subscriptions.push(disposable);
}

/**
 * Track a hookless agent terminal for lifecycle-based status updates.
 * Writes 'active' status on tracking start. The registered close listener
 * will write 'idle' status when the terminal is closed.
 *
 * @param terminal The VS Code terminal to track
 * @param worktreePath The worktree path associated with this terminal
 */
export async function trackHooklessTerminal(terminal: vscode.Terminal, worktreePath: string): Promise<void> {
    // Register the terminal for close tracking
    hooklessTerminals.set(terminal, worktreePath);

    // Write active status immediately
    try {
        const statusPath = getStatusFilePath(worktreePath);
        await ensureDir(path.dirname(statusPath));
        await writeJson(statusPath, {
            status: 'active',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.warn('Lanes: Failed to write active status for hookless terminal:', getErrorMessage(err));
    }
}


/**
 * Count existing terminals for a session to determine the next terminal number.
 * Counts terminals matching the pattern "{sessionName} [n]" where n is a number.
 * @param sessionName The session name to count terminals for
 * @returns The highest terminal number found, or 0 if none exist
 */
export function countTerminalsForSession(sessionName: string): number {
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
export async function createTerminalForSession(item: SessionItem): Promise<void> {
    // Validate worktree path
    if (!item.worktreePath) {
        vscode.window.showErrorMessage("Cannot determine worktree path for this session");
        return;
    }

    const worktreePath = item.worktreePath;
    const sessionName = item.label;

    // Verify worktree exists
    if (!await fileExists(worktreePath)) {
        vscode.window.showErrorMessage(`Worktree path does not exist: ${worktreePath}`);
        return;
    }

    try {
        // Count existing terminals for this session
        const terminalCount = countTerminalsForSession(sessionName);
        const nextNumber = terminalCount + 1;

        // Create terminal with incremented name
        const terminalName = `${sessionName} [${nextNumber}]`;

        const useTmux = (await getSessionTerminalMode(item.worktreePath)) === 'tmux';

        if (useTmux) {
            // Check if tmux is installed
            if (!await TmuxService.isTmuxInstalled()) {
                vscode.window.showErrorMessage(
                    "Tmux is not installed. Please install tmux or change 'Lanes: Terminal Mode' setting to 'vscode'."
                );
                return;
            }

            // Sanitize session name for tmux
            const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(`${sessionName}-${nextNumber}`);

            // Create tmux session
            await TmuxService.createSession(tmuxSessionName, worktreePath);

            // Create VS Code terminal attached to tmux session
            const terminal = vscode.window.createTerminal({
                name: terminalName,
                shellPath: 'tmux',
                shellArgs: ['attach-session', '-t', tmuxSessionName],
                cwd: worktreePath,
                iconPath: new vscode.ThemeIcon('terminal')
            });

            terminal.show();
        } else {
            // Standard vscode mode
            const terminal = vscode.window.createTerminal({
                name: terminalName,
                cwd: worktreePath,
                iconPath: new vscode.ThemeIcon('terminal')
            });

            terminal.show();
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to create terminal: ${getErrorMessage(err)}`);
    }
}

/**
 * Open a Claude Code terminal using tmux backend.
 * This is the tmux-specific implementation of openClaudeTerminal.
 */
async function openClaudeTerminalTmux(
    taskName: string,
    worktreePath: string,
    prompt?: string,
    permissionMode?: PermissionMode,
    workflow?: string | null,
    codeAgent?: CodeAgent,
    repoRoot?: string,
    skipWorkflowPrompt?: boolean
): Promise<void> {
    // Check if tmux is installed
    if (!await TmuxService.isTmuxInstalled()) {
        vscode.window.showErrorMessage(
            "Tmux is not installed. Please install tmux or change 'Lanes: Terminal Mode' setting to 'vscode'."
        );
        return;
    }

    // Use CodeAgent for terminal naming if available, otherwise fallback to hardcoded
    const terminalName = codeAgent ? codeAgent.getTerminalName(taskName) : `Claude: ${taskName}`;

    // Sanitize session name for tmux
    const tmuxSessionName = TmuxService.sanitizeTmuxSessionName(taskName);

    // Get or create a unique task list ID for this session
    const taskListId = await getOrCreateTaskListId(worktreePath, taskName);

    // Check if tmux session already exists
    const tmuxSessionExists = await TmuxService.sessionExists(tmuxSessionName);

    // Use CodeAgent for terminal icon configuration if available
    const iconConfig = codeAgent ? codeAgent.getTerminalIcon() : { id: 'robot', color: 'terminal.ansiGreen' };

    if (tmuxSessionExists) {
        // Tmux session exists - just attach to it
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            shellPath: 'tmux',
            shellArgs: ['attach-session', '-t', tmuxSessionName],
            cwd: worktreePath,
            iconPath: new vscode.ThemeIcon(iconConfig.id),
            color: iconConfig.color ? new vscode.ThemeColor(iconConfig.color) : new vscode.ThemeColor('terminal.ansiGreen')
        });
        terminal.show();
        return;
    }

    // Create new tmux session
    await TmuxService.createSession(tmuxSessionName, worktreePath);

    // Export env vars in the initial shell (set-environment only affects new windows/panes)
    await TmuxService.sendCommand(tmuxSessionName, `export CLAUDE_CODE_TASK_LIST_ID='${taskListId}'`);

    try {
        const launch = await prepareAgentLaunchContext({
            worktreePath,
            workflow,
            permissionMode,
            codeAgent,
            repoRoot,
            onWarning: (message) => console.warn(`Lanes: ${message}`),
            fallbackMcpConfigFactory: ({ worktreePath: wtPath, workflowPath, repoRoot: effectiveRepoRoot }) => {
                const mcpServerPath = path.join(__dirname, 'mcp', 'server.js');
                const fallback: McpConfig = {
                    mcpServers: {
                        'lanes-workflow': {
                            command: process.versions.electron ? 'node' : process.execPath,
                            args: [mcpServerPath, '--worktree', wtPath, '--workflow-path', workflowPath, '--repo-root', effectiveRepoRoot]
                        }
                    }
                };
                return fallback;
            }
        });

        let shouldStartFresh = true;

        if (launch.sessionData?.sessionId) {
            // Try to resume existing session
            if (codeAgent) {
                try {
                    // Use CodeAgent to build resume command
                    const resumeCommand = codeAgent.buildResumeCommand(launch.sessionData.sessionId, {
                        settingsPath: launch.settingsPath,
                        mcpConfigPath: launch.mcpConfigPath,
                        mcpConfigOverrides: launch.mcpConfigOverrides
                    });
                    await TmuxService.sendCommand(tmuxSessionName, resumeCommand);
                    shouldStartFresh = false;
                } catch (err) {
                    // Invalid session ID format - log and start fresh session
                    console.error('Failed to build resume command, starting fresh session:', getErrorMessage(err));
                }
            } else {
                // Fallback to hardcoded command construction
                const mcpConfigFlag = launch.mcpConfigPath ? `--mcp-config "${launch.mcpConfigPath}" ` : '';
                const settingsFlag = launch.settingsPath ? `--settings "${launch.settingsPath}" ` : '';
                await TmuxService.sendCommand(tmuxSessionName, `claude ${mcpConfigFlag}${settingsFlag}--resume ${launch.sessionData.sessionId}`.trim());
                shouldStartFresh = false;
            }
        }

        if (shouldStartFresh) {
            // Validate permissionMode to prevent command injection from untrusted webview input
            const validatedMode = isValidPermissionMode(launch.effectivePermissionMode) ? launch.effectivePermissionMode : 'acceptEdits';

            // Persist permission mode and terminal mode for future session clears/restarts
            await saveSessionPermissionMode(worktreePath, validatedMode);
            await saveSessionTerminalMode(worktreePath, 'tmux');

            const combinedPrompt = assemblePrompt({
                userPrompt: prompt,
                effectiveWorkflow: launch.effectiveWorkflow,
                isCleared: skipWorkflowPrompt,
            }) || '';

            // Write prompt to file for history and to avoid terminal buffer issues
            let promptFileCommand: string | undefined;
            if (combinedPrompt) {
                const repoRootForPrompt = path.dirname(path.dirname(worktreePath));
                const result = await writePromptFile(combinedPrompt, taskName, repoRootForPrompt);
                promptFileCommand = result?.commandArg;
            }

            if (codeAgent) {
                // Use CodeAgent to build start command (each agent handles prompt formatting)
                const startCommand = codeAgent.buildStartCommand({
                    permissionMode: validatedMode,
                    settingsPath: launch.settingsPath,
                    mcpConfigPath: launch.mcpConfigPath,
                    mcpConfigOverrides: launch.mcpConfigOverrides,
                    prompt: promptFileCommand || combinedPrompt || undefined
                });
                await TmuxService.sendCommand(tmuxSessionName, startCommand);

                // Agents that can't include prompt in CLI (e.g., Cortex) need it via stdin
                if (!codeAgent.supportsPromptInCommand() && combinedPrompt) {
                    await TmuxService.sendCommand(tmuxSessionName, combinedPrompt);
                }
            } else {
                // Fallback to hardcoded command construction
                const mcpConfigFlag = launch.mcpConfigPath ? `--mcp-config "${launch.mcpConfigPath}" ` : '';
                const settingsFlag = launch.settingsPath ? `--settings "${launch.settingsPath}" ` : '';
                const permissionFlag = `--permission-mode ${validatedMode} `;

                if (promptFileCommand) {
                    // Pass prompt file content as argument using command substitution
                    await TmuxService.sendCommand(tmuxSessionName, `claude ${mcpConfigFlag}${settingsFlag}${permissionFlag}${promptFileCommand}`);
                } else if (combinedPrompt) {
                    // Fallback: pass prompt directly if path resolution failed
                    // Escape single quotes in the prompt for shell safety
                    const escapedPrompt = combinedPrompt.replace(/'/g, "'\\''");
                    await TmuxService.sendCommand(tmuxSessionName, `claude ${mcpConfigFlag}${settingsFlag}${permissionFlag}'${escapedPrompt}'`);
                } else {
                    // Start new session without prompt
                    await TmuxService.sendCommand(tmuxSessionName, `claude ${mcpConfigFlag}${settingsFlag}${permissionFlag}`.trim());
                }
            }
        }

        // Create VS Code terminal attached to tmux session
        const terminal = vscode.window.createTerminal({
            name: terminalName,
            shellPath: 'tmux',
            shellArgs: ['attach-session', '-t', tmuxSessionName],
            cwd: worktreePath,
            iconPath: new vscode.ThemeIcon(iconConfig.id),
            color: iconConfig.color ? new vscode.ThemeColor(iconConfig.color) : new vscode.ThemeColor('terminal.ansiGreen')
        });

        terminal.show();
    } catch (err) {
        // Clean up orphaned tmux session on failure
        await TmuxService.killSession(tmuxSessionName).catch(() => {});
        vscode.window.showErrorMessage(`Failed to open tmux terminal: ${getErrorMessage(err)}`);
    }
}

/**
 * THE CORE FUNCTION: Manages the Terminal Tabs
 *
 * Opens a Claude Code terminal for a session. If the terminal already exists,
 * it brings it to the front. Otherwise, it creates a new terminal with the
 * appropriate configuration.
 *
 * The terminal automatically resumes existing sessions or starts fresh based
 * on session ID persistence.
 *
 * @param taskName The name of the session/task
 * @param worktreePath The path to the worktree
 * @param prompt Optional starting prompt for Claude
 * @param permissionMode Permission mode for Claude CLI
 * @param workflow Optional workflow template path
 * @param codeAgent Optional CodeAgent for custom agent behavior
 * @param repoRoot Optional repository root path
 * @param skipWorkflowPrompt If true, don't add workflow prompt (for cleared sessions)
 */
export async function openAgentTerminal(
    taskName: string,
    worktreePath: string,
    prompt?: string,
    permissionMode?: PermissionMode,
    workflow?: string | null,
    codeAgent?: CodeAgent,
    repoRoot?: string,
    skipWorkflowPrompt?: boolean
): Promise<void> {
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

    // Determine terminal mode: persisted value wins, legacy sessions default to vscode,
    // brand new sessions (no session file yet) use the global setting.
    const savedTerminalMode = await getSessionTerminalMode(worktreePath);
    let useTmux: boolean;
    if (savedTerminalMode !== null) {
        useTmux = savedTerminalMode === 'tmux';
    } else {
        const sessionPath = getSessionFilePath(worktreePath);
        const sessionExists = await fileExists(sessionPath);
        const terminalMode = vscode.workspace.getConfiguration('lanes').get<string>('terminalMode', 'vscode');
        useTmux = !sessionExists && TmuxService.isTmuxMode(terminalMode);
    }

    if (useTmux) {
        await openClaudeTerminalTmux(
            taskName,
            worktreePath,
            prompt,
            permissionMode,
            workflow,
            codeAgent,
            repoRoot,
            skipWorkflowPrompt
        );
        return;
    }

    // B. Create a Brand New Terminal Tab
    // Use CodeAgent for terminal icon configuration if available
    const iconConfig = codeAgent ? codeAgent.getTerminalIcon() : { id: 'robot', color: 'terminal.ansiGreen' };

    // Get or create a unique task list ID for this session
    const taskListId = await getOrCreateTaskListId(worktreePath, taskName);

    const terminal = vscode.window.createTerminal({
        name: terminalName,      // <--- This sets the tab name in the UI
        cwd: worktreePath,       // <--- Starts shell directly inside the isolated worktree
        iconPath: new vscode.ThemeIcon(iconConfig.id), // Terminal icon
        color: iconConfig.color ? new vscode.ThemeColor(iconConfig.color) : new vscode.ThemeColor('terminal.ansiGreen'), // Color code the tab
        env: { CLAUDE_CODE_TASK_LIST_ID: taskListId } // Enable Claude Code task persistence with unique ID
    });

    terminal.show();

    // B2. Track hookless agent terminals for lifecycle-based status updates
    if (codeAgent && !codeAgent.supportsHooks()) {
        await trackHooklessTerminal(terminal, worktreePath);
    }

    const launch = await prepareAgentLaunchContext({
        worktreePath,
        workflow,
        permissionMode,
        codeAgent,
        repoRoot,
        onWarning: (message) => console.warn(`Lanes: ${message}`),
        fallbackMcpConfigFactory: ({ worktreePath: wtPath, workflowPath, repoRoot: effectiveRepoRoot }) => {
            const mcpServerPath = path.join(__dirname, 'mcp', 'server.js');
            const fallback: McpConfig = {
                mcpServers: {
                    'lanes-workflow': {
                        command: process.versions.electron ? 'node' : process.execPath,
                        args: [mcpServerPath, '--worktree', wtPath, '--workflow-path', workflowPath, '--repo-root', effectiveRepoRoot]
                    }
                }
            };
            return fallback;
        }
    });

    // D. Auto-start agent - resume if session ID exists, otherwise start fresh
    let shouldStartFresh = true;

    if (launch.sessionData?.sessionId) {
        // Try to resume existing session
        if (codeAgent) {
            try {
                // Use CodeAgent to build resume command
                const resumeCommand = codeAgent.buildResumeCommand(launch.sessionData.sessionId, {
                    settingsPath: launch.settingsPath,
                    mcpConfigPath: launch.mcpConfigPath,
                    mcpConfigOverrides: launch.mcpConfigOverrides
                });
                terminal.sendText(resumeCommand);
                shouldStartFresh = false;

                // For hookless agents resuming, start polling if we have a saved logPath
                if (!codeAgent.supportsHooks() && launch.sessionData.logPath) {
                    startPolling(terminal, launch.sessionData.logPath, worktreePath);
                }
            } catch (err) {
                // Invalid session ID format - log and start fresh session
                console.error('Failed to build resume command, starting fresh session:', getErrorMessage(err));
            }
        } else {
            // Fallback to hardcoded command construction
            const mcpConfigFlag = launch.mcpConfigPath ? `--mcp-config "${launch.mcpConfigPath}" ` : '';
            const settingsFlag = launch.settingsPath ? `--settings "${launch.settingsPath}" ` : '';
            terminal.sendText(`claude ${mcpConfigFlag}${settingsFlag}--resume ${launch.sessionData.sessionId}`.trim());
            shouldStartFresh = false;
        }
    }

    if (shouldStartFresh) {
        // Capture timestamp before sending start command (for hookless session ID capture)
        const beforeStartTimestamp = new Date();

        // Validate permissionMode to prevent command injection from untrusted webview input
        const validatedMode = isValidPermissionMode(launch.effectivePermissionMode) ? launch.effectivePermissionMode : 'acceptEdits';

        // Persist permission mode and terminal mode for future session clears/restarts
        await saveSessionPermissionMode(worktreePath, validatedMode);
        await saveSessionTerminalMode(worktreePath, 'code');

        const combinedPrompt = assemblePrompt({
            userPrompt: prompt,
            effectiveWorkflow: launch.effectiveWorkflow,
            isCleared: skipWorkflowPrompt,
        }) || '';

        // Write prompt to file for history and to avoid terminal buffer issues
        let promptFileCommand: string | undefined;
        if (combinedPrompt) {
            const repoRootForPrompt = path.dirname(path.dirname(worktreePath));
            const result = await writePromptFile(combinedPrompt, taskName, repoRootForPrompt);
            promptFileCommand = result?.commandArg;
        }

        if (codeAgent) {
            // Use CodeAgent to build start command (each agent handles prompt formatting)
            const startCommand = codeAgent.buildStartCommand({
                permissionMode: validatedMode,
                settingsPath: launch.settingsPath,
                mcpConfigPath: launch.mcpConfigPath,
                mcpConfigOverrides: launch.mcpConfigOverrides,
                prompt: promptFileCommand || combinedPrompt || undefined
            });
            terminal.sendText(startCommand);

            // Agents that can't include prompt in CLI (e.g., Cortex) need it via stdin
            if (!codeAgent.supportsPromptInCommand() && combinedPrompt) {
                terminal.sendText(combinedPrompt);
            }
        } else {
            // Fallback to hardcoded command construction
            const mcpConfigFlag = launch.mcpConfigPath ? `--mcp-config "${launch.mcpConfigPath}" ` : '';
            const settingsFlag = launch.settingsPath ? `--settings "${launch.settingsPath}" ` : '';
            const permissionFlag = `--permission-mode ${validatedMode} `;

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

        // For hookless agents, capture session ID asynchronously after start
        if (codeAgent && !codeAgent.supportsHooks()) {
            captureHooklessSessionId(codeAgent, worktreePath, beforeStartTimestamp, terminal);
        }
    }
}

/**
 * Asynchronously capture session ID for a hookless agent and write it to the session file.
 * This is designed to be called fire-and-forget -- errors are logged but don't block terminal creation.
 *
 * When a session ID is successfully captured, this also starts polling the agent's
 * session log file for activity-based status updates (working / waiting_for_user).
 *
 * LOCKED DECISION: If capture fails, show error to user suggesting to start a new session.
 * Do NOT silently fall back to --last.
 */
async function captureHooklessSessionId(
    codeAgent: CodeAgent,
    worktreePath: string,
    beforeTimestamp: Date,
    terminal: vscode.Terminal
): Promise<void> {
    try {
        const result = await codeAgent.captureSessionId(beforeTimestamp);
        if (!result) {
            // Show warning only for agents that are hookless (they need session capture to work)
            if (!codeAgent.supportsHooks()) {
                vscode.window.showWarningMessage(
                    `Lanes: Could not capture ${codeAgent.displayName} session ID. Resume may not work for this session. ` +
                    'If you need to resume, try starting a new session.'
                );
            }
            return;
        }

        // Write captured session ID and log path back to the session file (merge with existing data)
        const sessionFilePath = getSessionFilePath(worktreePath);
        let existingData: Record<string, unknown> = {};
        const parsed = await readJson<Record<string, unknown>>(sessionFilePath);
        if (parsed) { existingData = parsed; }
        await writeJson(sessionFilePath, {
            ...existingData,
            sessionId: result.sessionId,
            logPath: result.logPath,
            timestamp: new Date().toISOString()
        });

        // Start polling the session log file for activity-based status updates
        startPolling(terminal, result.logPath, worktreePath);
    } catch (err) {
        console.error('Lanes: Failed to capture hookless session ID:', getErrorMessage(err));
    }
}

// Export the constant for external use
export { TERMINAL_CLOSE_DELAY_MS };
