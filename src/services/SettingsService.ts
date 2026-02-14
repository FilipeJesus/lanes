/**
 * SettingsService - Extension settings and repo path utilities
 *
 * This service provides functions for managing extension settings,
 * determining repository paths, and generating file watch patterns.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { execGit } from '../gitService';
import { CodeAgent, McpConfig } from '../codeAgents';
import { getSettingsFormat, JsonSettingsFormat } from './SettingsFormatService';
import {
    getSessionId,
    getPromptsPath,
    getBaseRepoPathForStorage,
    getSessionNameFromWorktree,
    getRepoIdentifier,
    getSessionWorkflow,
    saveSessionWorkflow,
    getStatusFilePath,
    getSessionFilePath,
    isGlobalStorageEnabled,
    getGlobalStorageUri,
    getWorktreesFolder,
    getGlobalCodeAgent,
    DEFAULTS
} from '../AgentSessionProvider';

/**
 * Check if the given path is a git worktree and return the base repo path.
 * Uses `git rev-parse --git-common-dir` to detect worktrees.
 *
 * - In a regular repo, this returns `.git` (relative) or `/path/to/repo/.git`
 * - In a worktree, this returns `/path/to/repo/.git` (the main repo's .git dir)
 *
 * @param workspacePath The current workspace path
 * @returns The base repo path if in a worktree, or the original path if not
 */
export async function getBaseRepoPath(workspacePath: string): Promise<string> {
    try {
        // Get the common git directory (shared across all worktrees)
        const gitCommonDir = await execGit(['rev-parse', '--git-common-dir'], workspacePath);
        const trimmedGitDir = gitCommonDir.trim();

        // If we get just '.git', we're in a regular repo (not a worktree)
        if (trimmedGitDir === '.git') {
            return workspacePath;
        }

        // We're in a worktree - resolve the base repo path
        // gitCommonDir will be an absolute path like:
        // - /path/to/repo/.git (for regular repos when run with absolute paths)
        // - /path/to/repo/.git (for worktrees - always absolute)

        // Resolve to absolute path if relative
        const absoluteGitDir = path.isAbsolute(trimmedGitDir)
            ? trimmedGitDir
            : path.resolve(workspacePath, trimmedGitDir);

        // The base repo is the parent of the .git directory
        // Handle both cases:
        // - /path/to/repo/.git -> /path/to/repo
        // - /path/to/repo/.git/worktrees/branch-name -> (needs to go up to .git, then to repo)

        // Normalize the path to handle any trailing slashes
        const normalizedGitDir = path.normalize(absoluteGitDir);

        // Check if this looks like a worktree git dir (contains /worktrees/)
        if (normalizedGitDir.includes(path.join('.git', 'worktrees'))) {
            // This is the worktree-specific git dir, go up to the main .git
            // e.g., /repo/.git/worktrees/branch -> /repo/.git -> /repo
            const gitDirIndex = normalizedGitDir.indexOf(path.join('.git', 'worktrees'));
            const mainGitDir = normalizedGitDir.substring(0, gitDirIndex + '.git'.length);
            return path.dirname(mainGitDir);
        }

        // Standard case: just get parent of .git
        if (normalizedGitDir.endsWith('.git') || normalizedGitDir.endsWith('.git' + path.sep)) {
            return path.dirname(normalizedGitDir);
        }

        // Fallback: return original path if we can't determine the base
        return workspacePath;

    } catch (err) {
        // Not a git repository or git command failed - return original path
        console.warn('Lanes: getBaseRepoPath failed:', err);
        return workspacePath;
    }
}

/**
 * Get the glob pattern for watching status files based on configuration.
 * When global storage is enabled, returns pattern for global storage.
 * When disabled, returns pattern for .lanes/session_management with wildcard subdirectories.
 * Uses CodeAgent method to determine the status file name, falling back to DEFAULTS.
 * @returns Glob pattern for watching status files
 */
export function getStatusWatchPattern(): string {
    const statusFileName = getGlobalCodeAgent()?.getStatusFileName() || DEFAULTS.statusFileName;
    if (isGlobalStorageEnabled()) {
        // For global storage, files are watched by the global storage file watcher
        // Return minimal pattern since global storage handles watching differently
        return '**/' + statusFileName;
    }
    // Non-global mode: watch .lanes/session_management/**/*/<statusFileName>
    return '.lanes/session_management/**/*/' + statusFileName;
}

/**
 * Get the glob pattern for watching session files based on configuration.
 * When global storage is enabled, returns pattern for global storage.
 * When disabled, returns pattern for .lanes/session_management with wildcard subdirectories.
 * Uses CodeAgent method to determine the session file name, falling back to DEFAULTS.
 * @returns Glob pattern for watching session files
 */
export function getSessionWatchPattern(): string {
    const sessionFileName = getGlobalCodeAgent()?.getSessionFileName() || DEFAULTS.sessionFileName;
    if (isGlobalStorageEnabled()) {
        // For global storage, files are watched by the global storage file watcher
        // Return minimal pattern since global storage handles watching differently
        return '**/' + sessionFileName;
    }
    // Non-global mode: watch .lanes/session_management/**/*/<sessionFileName>
    return '.lanes/session_management/**/*/' + sessionFileName;
}

/**
 * Get the repository name from a path.
 * @param repoPath Path to the repository
 * @returns The repository folder name
 */
export function getRepoName(repoPath: string): string {
    return path.basename(repoPath);
}

/**
 * Interface for Claude settings.json structure
 */
interface ClaudeSettings {
    hooks?: {
        SessionStart?: HookEntry[];
        Stop?: HookEntry[];
        UserPromptSubmit?: HookEntry[];
        Notification?: HookEntry[];
        PreToolUse?: HookEntry[];
        [key: string]: HookEntry[] | undefined;
    };
    mcpServers?: {
        [name: string]: {
            command: string;
            args: string[];
        };
    };
    [key: string]: unknown;
}

interface HookEntry {
    matcher?: string;
    hooks: { type: string; command: string }[];
}

/**
 * Creates or updates the extension settings file in global storage.
 * This file contains hooks for status tracking and session ID capture.
 * When a workflow is specified, it also includes MCP server configuration.
 * The file is stored at: globalStorageUri/<repo-identifier>/<session-name>/claude-settings.json
 *
 * @param worktreePath Path to the worktree
 * @param workflow Optional workflow template name. When provided, includes MCP server config.
 * @param codeAgent Optional CodeAgent instance for agent-specific configuration
 * @returns The absolute path to the settings file
 */
export async function getOrCreateExtensionSettingsFile(
    worktreePath: string,
    workflow?: string | null,
    codeAgent?: CodeAgent,
    mcpConfig?: McpConfig | null
): Promise<string> {
    // Get the session name from the worktree path
    const sessionName = getSessionNameFromWorktree(worktreePath);

    // Validate session name to prevent path traversal and command injection
    // Session names should only contain [a-zA-Z0-9_\-./] (enforced by sanitizeSessionName at creation)
    if (!sessionName || sessionName.includes('..') || !/^[a-zA-Z0-9_\-./]+$/.test(sessionName)) {
        throw new Error(`Invalid session name derived from worktree path: ${sessionName}`);
    }

    // If workflow not provided, try to restore from saved session data
    let effectiveWorkflow = workflow;
    if (!effectiveWorkflow) {
        const savedWorkflow = await getSessionWorkflow(worktreePath);
        if (savedWorkflow) {
            effectiveWorkflow = savedWorkflow;
            console.log(`Lanes: Restored workflow '${effectiveWorkflow}' from session data`);
        }
    }

    const globalStorageUriObj = getGlobalStorageUri();
    const baseRepoPath = getBaseRepoPathForStorage();

    if (!globalStorageUriObj || !baseRepoPath) {
        throw new Error('Global storage not initialized. Cannot create extension settings file.');
    }

    const repoIdentifier = getRepoIdentifier(baseRepoPath);
    const globalSettingsDir = path.join(globalStorageUriObj.fsPath, repoIdentifier, sessionName);

    // Determine settings file location:
    // Agents that load settings from well-known project paths (e.g., Cortex Code)
    // need the file written to their project settings directory.
    // Others use global storage and pass the path via CLI flag.
    const projectSettingsPath = codeAgent?.getProjectSettingsPath(worktreePath);
    let settingsDir: string;
    let settingsFilePath: string;
    if (projectSettingsPath) {
        settingsFilePath = projectSettingsPath;
        settingsDir = path.dirname(settingsFilePath);
    } else {
        settingsDir = globalSettingsDir;
        const settingsFileName = codeAgent ? codeAgent.getSettingsFileName() : 'claude-settings.json';
        settingsFilePath = path.join(settingsDir, settingsFileName);
    }

    // Ensure directories exist
    await fsPromises.mkdir(settingsDir, { recursive: true });
    if (settingsDir !== globalSettingsDir) {
        await fsPromises.mkdir(globalSettingsDir, { recursive: true });
    }

    // Generate the artefact registration hook script only for agents that support hooks
    // Hook script always goes to global storage (referenced by absolute path in hooks)
    let hookScriptPath: string | undefined;
    if (!codeAgent || codeAgent.supportsHooks()) {
        hookScriptPath = path.join(globalSettingsDir, 'register-artefact.sh');
        const hookScriptContent = `#!/bin/bash

# Read hook input from stdin
INPUT=$(cat)
WORKTREE_PATH="$(echo "$INPUT" | jq -r '.cwd // empty')"

# Only register if we're in a worktree with an active workflow
if [ -n "$WORKTREE_PATH" ] && [ -f "$WORKTREE_PATH/workflow-state.json" ]; then
    # Check if artefact tracking is enabled for the current step
    ARTEFACTS_ENABLED="$(jq -r '.currentStepArtefacts // false' "$WORKTREE_PATH/workflow-state.json")"

    if [ "$ARTEFACTS_ENABLED" = "true" ]; then
        # Extract the file path from Write tool input (FIXED: use tool_input.file_path)
        FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')"

        if [ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ]; then
            # Add the file to artefacts array if not already present
            STATE_FILE="$WORKTREE_PATH/workflow-state.json"
            tmp=$(mktemp)
            jq --arg path "$FILE_PATH" \\
                'if .artefacts == null then .artefacts = [] end |
                 if .artefacts | index($path) == null then .artefacts += [$path] else . end' \\
                "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"
        fi
    fi
fi

exit 0
`;

        // Write the hook script with executable permissions
        await fsPromises.writeFile(hookScriptPath, hookScriptContent, { mode: 0o755 });
    }

    // Determine status and session file paths using the helper functions
    // These functions handle both global and non-global modes automatically
    const statusFilePath = getStatusFilePath(worktreePath);
    const sessionFilePath = getSessionFilePath(worktreePath);

    // Ensure the directories exist for both files
    await fsPromises.mkdir(path.dirname(statusFilePath), { recursive: true });
    await fsPromises.mkdir(path.dirname(sessionFilePath), { recursive: true });


    // Build hooks configuration (only for agents that support hooks)
    let hooks: ClaudeSettings['hooks'];

    if (codeAgent && !codeAgent.supportsHooks()) {
        // Hookless agents (e.g., Codex) get settings without hooks
        hooks = undefined;
    } else if (codeAgent) {
        // Use CodeAgent to generate hooks
        // Pass effectiveWorkflow to enable workflow status hook
        // Pass hookScriptPath to enable PostToolUse artefact registration hook
        // Convert null to undefined for type compatibility
        const workflowParam = effectiveWorkflow || undefined;
        const hookConfigs = codeAgent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, workflowParam, hookScriptPath);

        // Convert HookConfig[] to ClaudeSettings hooks format
        hooks = {};
        for (const hookConfig of hookConfigs) {
            const entry: HookEntry = {
                hooks: hookConfig.commands
            };
            if (hookConfig.matcher) {
                entry.matcher = hookConfig.matcher;
            }

            if (!hooks[hookConfig.event]) {
                hooks[hookConfig.event] = [];
            }
            hooks[hookConfig.event]!.push(entry);
        }
    } else {
        // Fallback to hardcoded hooks for backward compatibility
        const statusWriteWaiting = {
            type: 'command',
            command: `echo '{"status":"waiting_for_user"}' > "${statusFilePath}"`
        };

        const statusWriteWorking = {
            type: 'command',
            command: `echo '{"status":"working"}' > "${statusFilePath}"`
        };

        // Session ID is provided via stdin as JSON: {"session_id": "...", ...}
        // The hook merges with existing file data to preserve workflow and other metadata
        const sessionIdCapture = {
            type: 'command',
            command: `old=$(cat "${sessionFilePath}" 2>/dev/null || echo '{}'); jq -r --argjson old "$old" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '$old + {sessionId: .session_id, timestamp: $ts}' > "${sessionFilePath}"`
        };

        hooks = {
            SessionStart: [{ hooks: [sessionIdCapture] }],
            Stop: [{ hooks: [statusWriteWaiting] }],
            UserPromptSubmit: [{ hooks: [statusWriteWorking] }],
            Notification: [{ matcher: 'permission_prompt', hooks: [statusWriteWaiting] }],
            PreToolUse: [{ matcher: '.*', hooks: [statusWriteWorking] }]
        };
    }

    // Build the settings object - include hooks/mcp only when defined
    const settings: ClaudeSettings = {};
    if (hooks !== undefined) {
        settings.hooks = hooks;
    }
    // Use agent-specific MCP format when available (e.g., OpenCode uses 'mcp' key with array commands)
    if (mcpConfig?.mcpServers) {
        if (codeAgent && codeAgent.getMcpConfigDelivery() === 'settings') {
            const formatted = codeAgent.formatMcpForSettings(mcpConfig);
            Object.assign(settings, formatted);
        } else {
            settings.mcpServers = mcpConfig.mcpServers;
        }
    }

    // Save workflow path to session file for future restoration (MCP is passed via --mcp-config flag)
    // effectiveWorkflow is now the full path to the workflow YAML file
    if (effectiveWorkflow) {
        // Validate workflow path to prevent command injection
        // Must be an absolute path ending in .yaml
        if (!path.isAbsolute(effectiveWorkflow)) {
            throw new Error(`Invalid workflow path: ${effectiveWorkflow}. Must be an absolute path.`);
        }
        if (!effectiveWorkflow.endsWith('.yaml')) {
            throw new Error(`Invalid workflow path: ${effectiveWorkflow}. Must end with .yaml`);
        }

        // Save workflow path to session file for future restoration
        // Only save if this is a new workflow (not restored from session data)
        if (workflow) {
            await saveSessionWorkflow(worktreePath, effectiveWorkflow);
        }
        // Note: MCP server config is now passed via --mcp-config flag in openAgentTerminal()
        // instead of being included in the settings file
    }

    // For project settings paths, merge our hooks into any existing user settings
    // to avoid overwriting user configuration (model preferences, env vars, etc.)
    if (projectSettingsPath) {
        try {
            // Use format-aware reading to handle JSONC comments, TOML, etc.
            const format = codeAgent ? getSettingsFormat(codeAgent) : new JsonSettingsFormat();
            const existingSettings = await format.read(settingsFilePath);
            // Start from existing settings, then overlay hooks/mcp as needed
            for (const key of Object.keys(existingSettings)) {
                (settings as Record<string, unknown>)[key] = existingSettings[key];
            }

            // If hooks were explicitly computed, override existing hooks
            if (hooks !== undefined) {
                (settings as Record<string, unknown>).hooks = hooks;
            }

            // Merge MCP servers (preserve existing, add/override ours)
            // Use agent-specific format when available
            if (mcpConfig?.mcpServers) {
                if (codeAgent && codeAgent.getMcpConfigDelivery() === 'settings') {
                    const formatted = codeAgent.formatMcpForSettings(mcpConfig);
                    for (const [key, value] of Object.entries(formatted)) {
                        const existingValue = (existingSettings as Record<string, unknown>)[key];
                        if (existingValue && typeof existingValue === 'object' && typeof value === 'object') {
                            (settings as Record<string, unknown>)[key] = {
                                ...(existingValue as Record<string, unknown>),
                                ...(value as Record<string, unknown>)
                            };
                        } else {
                            (settings as Record<string, unknown>)[key] = value;
                        }
                    }
                } else {
                    const existingMcp = (existingSettings as Record<string, unknown>).mcpServers;
                    const existingMcpServers = (existingMcp && typeof existingMcp === 'object')
                        ? existingMcp as Record<string, unknown>
                        : {};
                    (settings as Record<string, unknown>).mcpServers = {
                        ...existingMcpServers,
                        ...mcpConfig.mcpServers
                    };
                }
            }
        } catch {
            // File doesn't exist or isn't valid JSON - write fresh
        }
    }

    // Write the settings file atomically with cleanup on failure
    // Use format-aware writing when CodeAgent is available (JSON for Claude, TOML for Codex)
    const tempPath = path.join(settingsDir, `${path.basename(settingsFilePath)}.${Date.now()}.tmp`);
    try {
        if (codeAgent) {
            const format = getSettingsFormat(codeAgent);
            await format.write(tempPath, settings as Record<string, unknown>);
        } else {
            // Fallback to JSON when no CodeAgent is provided
            await fsPromises.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
        }
        await fsPromises.rename(tempPath, settingsFilePath);
    } catch (err) {
        // Clean up temp file on failure
        await fsPromises.unlink(tempPath).catch(() => {});
        throw err;
    }

    // For project settings paths, ensure the file is gitignored in the worktree
    // so users don't accidentally commit our generated settings
    if (projectSettingsPath) {
        const relativePath = path.relative(worktreePath, projectSettingsPath);
        const gitignorePath = path.join(worktreePath, '.gitignore');
        try {
            let content = '';
            try {
                content = await fsPromises.readFile(gitignorePath, 'utf-8');
            } catch {
                // .gitignore doesn't exist yet
            }
            const lines = content.split('\n');
            if (!lines.some(line => line.trim() === relativePath)) {
                const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
                await fsPromises.appendFile(gitignorePath, `${separator}${relativePath}\n`);
            }
        } catch {
            // Non-critical - log and continue
            console.warn(`Lanes: Could not update .gitignore for ${relativePath}`);
        }
    }

    return settingsFilePath;
}
