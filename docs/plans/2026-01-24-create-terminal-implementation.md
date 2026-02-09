# Create Terminal Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a context menu option to create additional plain shell terminals for a session, named "Session Name [n]" where n is the terminal count.

**Architecture:**
- Add command definition in `package.json`
- Register command handler in `extension.ts` that creates terminals with incremental numbering
- Terminals open in the session's worktree directory (plain shell, no Claude Code auto-start)

**Tech Stack:** TypeScript, VS Code Extension API

---

### Task 1: Add Command Definition to package.json

**Files:**
- Modify: `package.json:75-139`

**Step 1: Add the createTerminal command**

Add this entry to the `commands` array (after line 137, before the closing bracket):

```json
{
  "command": "claudeWorktrees.createTerminal",
  "title": "Create Terminal",
  "icon": "$(terminal)"
}
```

**Step 2: Add the context menu entry**

Add this entry to the `menus.view.item.context` array (after line 177, before the closing bracket of `menus.view.item.context`):

```json
{
  "command": "claudeWorktrees.createTerminal",
  "when": "view == claudeSessionsView && viewItem == sessionItem",
  "group": "inline@3"
}
```

**Step 3: Verify JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"`
Expected: No output (valid JSON)

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add create terminal command definition"
```

---

### Task 2: Add Helper Function to Count Terminals

**Files:**
- Modify: `src/extension.ts:2802` (add before the `openClaudeTerminal` function)

**Step 1: Write the countTerminalsForSession helper function**

Add this function before `openClaudeTerminal`:

```typescript
/**
 * Count existing terminals for a session to determine the next terminal number.
 * Counts terminals matching the pattern "{sessionName} [n]" where n is a number.
 * @param sessionName The session name to count terminals for
 * @returns The highest terminal number found, or 0 if none exist
 */
function countTerminalsForSession(sessionName: string): number {
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
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Success, no errors

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add helper to count session terminals"
```

---

### Task 3: Implement createTerminalForSession Function

**Files:**
- Modify: `src/extension.ts:2802` (add after the `countTerminalsForSession` function)

**Step 1: Write the createTerminalForSession function**

Add this function after `countTerminalsForSession`:

```typescript
/**
 * Create a new plain shell terminal for a session.
 * The terminal is named "{sessionName} [n]" where n is the terminal count.
 * @param item The SessionItem to create a terminal for
 */
async function createTerminalForSession(item: SessionItem): Promise<void> {
    // Validate worktree path
    if (!item.resourceUri) {
        vscode.window.showErrorMessage("Cannot determine worktree path for this session");
        return;
    }

    const worktreePath = item.resourceUri.fsPath;
    const sessionName = item.label;

    // Verify worktree exists
    if (!fs.existsSync(worktreePath)) {
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
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Success, no errors

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: implement create terminal function"
```

---

### Task 4: Register the Command Handler

**Files:**
- Modify: `src/extension.ts:1566` (add after the clearSessionDisposable registration)

**Step 1: Register the createTerminal command**

Add this code after line 1566 (after `context.subscriptions.push(clearSessionDisposable);`):

```typescript
    // 16. Register CREATE TERMINAL Command
    const createTerminalDisposable = vscode.commands.registerCommand('claudeWorktrees.createTerminal', async (item: SessionItem) => {
        if (!item || !item.resourceUri) {
            vscode.window.showErrorMessage('Please right-click on a session to create a terminal.');
            return;
        }

        await createTerminalForSession(item);
    });
    context.subscriptions.push(createTerminalDisposable);
```

**Step 2: Compile**

Run: `npm run compile`
Expected: Success, no errors

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: register create terminal command"
```

---

### Task 5: Manual Testing

**Files:**
- Test: Manual testing in VS Code

**Step 1: Press F5 to launch Extension Development Host**

Run: Press `F5` in VS Code
Expected: New VS Code window opens with extension loaded

**Step 2: Create a test session**

1. In the new window, find the "Lanes" sidebar
2. Click "New Session"
3. Enter a session name (e.g., "test-terminals")
4. Click submit

**Step 3: Right-click on the session**

1. Find your session in "Active Sessions"
2. Right-click on it
3. Verify "Create Terminal" appears in context menu

**Step 4: Create multiple terminals**

1. Click "Create Terminal"
2. Verify terminal opens with name "test-terminals [1]"
3. Verify `pwd` shows the worktree directory
4. Right-click the session again
5. Click "Create Terminal" again
6. Verify terminal opens with name "test-terminals [2]"
7. Verify terminal is a plain shell (Claude Code not auto-started)

**Step 5: Test edge cases**

1. Close terminal [2]
2. Create another terminal
3. Verify it's named "test-terminals [3]" (numbering continues)
4. Test with session name containing special characters (e.g., "my-test_session.01")

**Step 6: Report results**

If all tests pass, proceed to commit. If any fail, note the failure and fix.

---

### Task 6: Run Pre-commit Checks

**Files:**
- Test: Run full test suite

**Step 1: Run linter**

Run: `npm run lint`
Expected: Success, no errors

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Final compile**

Run: `npm run compile`
Expected: Success, no errors

**Step 4: Commit if all checks pass**

```bash
# If all checks pass, the implementation is complete
# No additional commit needed - work was already committed per task
```

---

### Task 7: Clean Up and Finalize

**Files:**
- Documentation: Update progress tracking

**Step 1: Update claude-progress.txt**

Add to `claude-progress.txt`:

```
## Session: 2026-01-24

### Completed
- Added "Create Terminal" context menu option for sessions
- Terminals named "Session Name [n]" with incremental numbering
- Terminals open in worktree directory as plain shells

### Next Steps
- Consider adding keyboard shortcut for creating terminals
- Consider adding terminal limit warning (if user feedback suggests need)
```

**Step 2: Verify all commits**

Run: `git log --oneline -5`
Expected: See your implementation commits

**Step 3: Ready for PR**

When satisfied, create a PR or merge to main.
