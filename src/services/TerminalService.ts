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
import * as fsPromises from 'fs/promises';

import { fileExists } from './FileService';
import { SessionItem } from '../ClaudeSessionProvider';
import { PermissionMode, isValidPermissionMode } from '../SessionFormProvider';
import { ClaudeCodeAgent, CodeAgent } from '../codeAgents';
import * as SettingsService from './SettingsService';
import { getErrorMessage } from '../utils';
import {
    getSessionId,
    getSessionWorkflow,
    getOrCreateTaskListId,
    getPromptsPath
} from '../ClaudeSessionProvider';

// Terminal close delay constant
const TERMINAL_CLOSE_DELAY_MS = 200; // Delay to ensure terminal is closed before reopening

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
 * @param acceptanceCriteria Optional acceptance criteria for Claude
 * @param permissionMode Permission mode for Claude CLI
 * @param workflow Optional workflow template path
 * @param codeAgent Optional CodeAgent for custom agent behavior
 * @param repoRoot Optional repository root path
 * @param skipWorkflowPrompt If true, don't add workflow prompt (for cleared sessions)
 */
export async function openClaudeTerminal(
    taskName: string,
    worktreePath: string,
    prompt?: string,
    acceptanceCriteria?: string,
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

    // C. Get or create the extension settings file with hooks
    let settingsPath: string | undefined;
    let mcpConfigPath: string | undefined;

    // Determine effective workflow: use provided workflow or restore from session data
    let effectiveWorkflow = workflow;
    if (!effectiveWorkflow) {
        const savedWorkflow = await getSessionWorkflow(worktreePath);
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
    const sessionData = await getSessionId(worktreePath);
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
            const repoRootForPrompt = path.dirname(path.dirname(worktreePath));
            const promptPathInfo = getPromptsPath(taskName, repoRootForPrompt);
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

// Export the constant for external use
export { TERMINAL_CLOSE_DELAY_MS };
