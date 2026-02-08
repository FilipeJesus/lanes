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
import { ClaudeCodeAgent, CodeAgent } from '../codeAgents';
import {
    getSessionId,
    getPromptsPath,
    getBaseRepoPathForStorage,
    getSessionNameFromWorktree,
    getRepoIdentifier,
    getSessionWorkflow,
    saveSessionWorkflow,
    getClaudeStatusPath,
    getClaudeSessionPath,
    isGlobalStorageEnabled,
    getGlobalStorageUri,
    getWorktreesFolder
} from '../ClaudeSessionProvider';

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
 * Get the glob pattern for watching .claude-status based on configuration.
 * When global storage is enabled, returns pattern for global storage.
 * When disabled, returns pattern for .lanes/session_management with wildcard subdirectories.
 * @returns Glob pattern for watching .claude-status
 */
export function getStatusWatchPattern(): string {
    if (isGlobalStorageEnabled()) {
        // For global storage, files are watched by the global storage file watcher
        // Return minimal pattern since global storage handles watching differently
        return '**/.claude-status';
    }
    // Non-global mode: watch .lanes/session_management/**/*/.claude-status
    return '.lanes/session_management/**/*/.claude-status';
}

/**
 * Get the glob pattern for watching .claude-session based on configuration.
 * When global storage is enabled, returns pattern for global storage.
 * When disabled, returns pattern for .lanes/session_management with wildcard subdirectories.
 * @returns Glob pattern for watching .claude-session
 */
export function getSessionWatchPattern(): string {
    if (isGlobalStorageEnabled()) {
        // For global storage, files are watched by the global storage file watcher
        // Return minimal pattern since global storage handles watching differently
        return '**/.claude-session';
    }
    // Non-global mode: watch .lanes/session_management/**/*/.claude-session
    return '.lanes/session_management/**/*/.claude-session';
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
export async function getOrCreateExtensionSettingsFile(worktreePath: string, workflow?: string | null, codeAgent?: CodeAgent): Promise<string> {
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
        const savedWorkflow = getSessionWorkflow(worktreePath);
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
    const settingsDir = path.join(globalStorageUriObj.fsPath, repoIdentifier, sessionName);
    // Use CodeAgent for settings file naming if available, otherwise fallback to hardcoded
    const settingsFileName = codeAgent ? codeAgent.getSettingsFileName() : 'claude-settings.json';
    const settingsFilePath = path.join(settingsDir, settingsFileName);

    // Ensure the directory exists
    await fsPromises.mkdir(settingsDir, { recursive: true });

    // Generate the artefact registration hook script in global storage
    const hookScriptPath = path.join(settingsDir, 'register-artefact.sh');
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

    // Determine status and session file paths using the helper functions
    // These functions handle both global and non-global modes automatically
    const statusFilePath = getClaudeStatusPath(worktreePath);
    const sessionFilePath = getClaudeSessionPath(worktreePath);

    // Ensure the directories exist for both files
    await fsPromises.mkdir(path.dirname(statusFilePath), { recursive: true });
    await fsPromises.mkdir(path.dirname(sessionFilePath), { recursive: true });


    // Build hooks configuration
    let hooks: ClaudeSettings['hooks'];

    if (codeAgent) {
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

    // Build the settings object
    const settings: ClaudeSettings = {
        hooks
    };

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
            saveSessionWorkflow(worktreePath, effectiveWorkflow);
        }
        // Note: MCP server config is now passed via --mcp-config flag in openClaudeTerminal()
        // instead of being included in the settings file
    }

    // Write the settings file atomically with cleanup on failure
    const tempPath = path.join(settingsDir, `${settingsFileName}.${Date.now()}.tmp`);
    try {
        await fsPromises.writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf-8');
        await fsPromises.rename(tempPath, settingsFilePath);
    } catch (err) {
        // Clean up temp file on failure
        await fsPromises.unlink(tempPath).catch(() => {});
        throw err;
    }

    return settingsFilePath;
}
