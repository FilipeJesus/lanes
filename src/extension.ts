import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { ClaudeSessionProvider, SessionItem } from './ClaudeSessionProvider'; // Import the new class

const WORKTREE_FOLDER = '.worktrees';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, "Claude Orchestra" is now active!'); // Check Debug Console for this

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    
    // DEBUG: Check if we found a workspace
    if (!workspaceRoot) {
        console.error("No workspace detected!");
    } else {
        console.log(`Workspace detected: ${workspaceRoot}`);
    }

    // Initialize Provider
    const sessionProvider = new ClaudeSessionProvider(workspaceRoot);
    vscode.window.registerTreeDataProvider('claudeSessionsView', sessionProvider);

    // Watch for .claude-status file changes to refresh the sidebar
    if (workspaceRoot) {
        const statusWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, '.worktrees/**/.claude-status')
        );

        // Refresh on any status file change
        statusWatcher.onDidChange(() => sessionProvider.refresh());
        statusWatcher.onDidCreate(() => sessionProvider.refresh());
        statusWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(statusWatcher);

        // Also watch for features.json changes to refresh the sidebar
        const featuresWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceRoot, '.worktrees/**/features.json')
        );

        featuresWatcher.onDidChange(() => sessionProvider.refresh());
        featuresWatcher.onDidCreate(() => sessionProvider.refresh());
        featuresWatcher.onDidDelete(() => sessionProvider.refresh());

        context.subscriptions.push(featuresWatcher);
    }

    // 2. Register CREATE Command
    let createDisposable = vscode.commands.registerCommand('claudeWorktrees.createSession', async () => {
        console.log("Create Session Command Triggered!"); // <--- LOOK FOR THIS

        // 1. Check Workspace
        if (!workspaceRoot) {
            vscode.window.showErrorMessage("Error: You must open a folder/workspace first!");
            return;
        }

        // 2. Check Git Status
        const isGit = fs.existsSync(path.join(workspaceRoot, '.git'));
        if (!isGit) {
            vscode.window.showErrorMessage("Error: Current folder is not a git repository. Run 'git init' first.");
            return;
        }

        // 3. Get Input
        const name = await vscode.window.showInputBox({ 
            prompt: "Session Name (creates new branch)",
            placeHolder: "fix-login" 
        });
        
        console.log(`User entered name: ${name}`);

        if (!name) {
            vscode.window.showInformationMessage("Creation cancelled");
            return;
        }

        const worktreePath = path.join(workspaceRoot, '.worktrees', name);
        console.log(`Target path: ${worktreePath}`);

        try {
            // 4. Create Worktree
            vscode.window.showInformationMessage(`Creating session '${name}'...`); // Feedback to user
            
            await ensureWorktreeDirExists(workspaceRoot);
            
            // Log the command we are about to run
            const gitCmd = `git worktree add "${worktreePath}" -b "${name}"`;
            console.log(`Running: ${gitCmd}`);
            
            await execShell(gitCmd, workspaceRoot);

            // 5. Setup status hooks before opening Claude
            await setupStatusHooks(worktreePath);

            // 6. Success
            sessionProvider.refresh();
            openClaudeTerminal(name, worktreePath);
            vscode.window.showInformationMessage(`Session '${name}' Ready!`);
            
        } catch (err: any) {
            console.error(err);
            vscode.window.showErrorMessage(`Git Error: ${err.message}`);
        }
    });

    // 3. Register OPEN/RESUME Command
    let openDisposable = vscode.commands.registerCommand('claudeWorktrees.openSession', (item: SessionItem) => {
        openClaudeTerminal(item.label, item.worktreePath);
    });

    // ---------------------------------------------------------
    // 4. INSERT DELETE COMMAND HERE (New Code)
    // ---------------------------------------------------------
    let deleteDisposable = vscode.commands.registerCommand('claudeWorktrees.deleteSession', async (item: SessionItem) => {
        
        // A. Confirm with user
        const answer = await vscode.window.showWarningMessage(
            `Delete session '${item.label}'?`, 
            { modal: true }, 
            "Delete"
        );
        if (answer !== "Delete") {
            return;
        }

        try {
            // B. Kill Terminal
            const termName = `Claude: ${item.label}`;
            const terminal = vscode.window.terminals.find(t => t.name === termName);
            if (terminal) {
                terminal.dispose();
            }

            // C. Remove Worktree
            if (workspaceRoot) {
                // --force is required if the worktree is not clean, but usually safe for temp agent work
                await execShell(`git worktree remove "${item.worktreePath}" --force`, workspaceRoot);
            }

            // D. Refresh List
            sessionProvider.refresh();
            vscode.window.showInformationMessage(`Deleted session: ${item.label}`);

        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to delete: ${err.message}`);
        }
    });

    // 5. Register SETUP STATUS HOOKS Command
    let setupHooksDisposable = vscode.commands.registerCommand('claudeWorktrees.setupStatusHooks', async (item?: SessionItem) => {
        if (!item) {
            vscode.window.showErrorMessage('Please right-click on a session to setup status hooks.');
            return;
        }
        try {
            await setupStatusHooks(item.worktreePath);
            vscode.window.showInformationMessage(`Status hooks configured for '${item.label}'`);
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to setup hooks: ${err.message}`);
        }
    });

    context.subscriptions.push(createDisposable);
    context.subscriptions.push(openDisposable);
    context.subscriptions.push(deleteDisposable);
    context.subscriptions.push(setupHooksDisposable);
}

// THE CORE FUNCTION: Manages the Terminal Tabs
function openClaudeTerminal(taskName: string, worktreePath: string) {
    const terminalName = `Claude: ${taskName}`;

    // A. Check if this terminal already exists to avoid duplicates
    const existingTerminal = vscode.window.terminals.find(t => t.name === terminalName);
    
    if (existingTerminal) {
        // Just bring it to the front!
        existingTerminal.show();
        return;
    }

    // B. Create a Brand New Terminal Tab
    const terminal = vscode.window.createTerminal({
        name: terminalName,      // <--- This sets the tab name in the UI
        cwd: worktreePath,       // <--- Starts shell directly inside the isolated worktree
        iconPath: new vscode.ThemeIcon('robot'), // Gives it a cool robot icon
        color: new vscode.ThemeColor('terminal.ansiGreen') // Optional: Color code the tab
    });

    terminal.show();
    
    // C. Auto-start Claude
    // We send the command immediately. Since cwd is set above, it runs in the right place.
    terminal.sendText("claude");
}

// Helper for shell commands
function execShell(cmd: string, cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
        cp.exec(cmd, { cwd }, (err, stdout, stderr) => {
            if (err) {
                return reject(stderr || err.message);
            }
            resolve(stdout);
        });
    });
}

function ensureWorktreeDirExists(root: string) {
    const dir = path.join(root, WORKTREE_FOLDER);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
    }
}

/**
 * Interface for Claude settings.json structure
 */
interface ClaudeSettings {
    hooks?: {
        Stop?: HookEntry[];
        UserPromptSubmit?: HookEntry[];
        [key: string]: HookEntry[] | undefined;
    };
    [key: string]: unknown;
}

interface HookEntry {
    matcher?: string;
    hooks: { type: string; command: string }[];
}

/**
 * Sets up Claude hooks for status file updates in a worktree.
 * Merges with existing hooks without overwriting user configuration.
 */
async function setupStatusHooks(worktreePath: string): Promise<void> {
    const claudeDir = path.join(worktreePath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');

    // Ensure .claude directory exists
    if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Read existing settings or start fresh
    let settings: ClaudeSettings = {};
    if (fs.existsSync(settingsPath)) {
        try {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            settings = JSON.parse(content);
        } catch {
            // If invalid JSON, start fresh but warn user
            const answer = await vscode.window.showWarningMessage(
                'Existing .claude/settings.json is invalid. Overwrite?',
                'Overwrite',
                'Cancel'
            );
            if (answer !== 'Overwrite') {
                throw new Error('Setup cancelled - invalid existing settings');
            }
        }
    }

    // Initialize hooks object if needed
    if (!settings.hooks) {
        settings.hooks = {};
    }

    // Define our status hooks
    const statusWriteWaiting = {
        type: 'command',
        command: "echo '{\"status\":\"waiting_for_user\"}' > .claude-status"
    };

    const statusWriteWorking = {
        type: 'command',
        command: "echo '{\"status\":\"working\"}' > .claude-status"
    };

    // Helper to check if our hook already exists
    const hookExists = (entries: HookEntry[] | undefined): boolean => {
        if (!entries) {return false;}
        return entries.some(entry =>
            entry.hooks.some(h => h.command.includes('.claude-status'))
        );
    };

    // Add Stop hook (fires when Claude finishes responding = waiting for user)
    if (!settings.hooks.Stop) {
        settings.hooks.Stop = [];
    }
    if (!hookExists(settings.hooks.Stop)) {
        settings.hooks.Stop.push({
            hooks: [statusWriteWaiting]
        });
    }

    // Add UserPromptSubmit hook (fires when user submits = Claude starts working)
    if (!settings.hooks.UserPromptSubmit) {
        settings.hooks.UserPromptSubmit = [];
    }
    if (!hookExists(settings.hooks.UserPromptSubmit)) {
        settings.hooks.UserPromptSubmit.push({
            hooks: [statusWriteWorking]
        });
    }

    // Add Notification hook for permission prompts (fires when Claude asks for permission)
    if (!settings.hooks.Notification) {
        settings.hooks.Notification = [];
    }
    if (!hookExists(settings.hooks.Notification)) {
        settings.hooks.Notification.push({
            matcher: 'permission_prompt',
            hooks: [statusWriteWaiting]
        });
    }

    // Add PreToolUse hook (fires before any tool = Claude is working)
    if (!settings.hooks.PreToolUse) {
        settings.hooks.PreToolUse = [];
    }
    if (!hookExists(settings.hooks.PreToolUse)) {
        settings.hooks.PreToolUse.push({
            matcher: '.*',
            hooks: [statusWriteWorking]
        });
    }

    // Write updated settings
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}