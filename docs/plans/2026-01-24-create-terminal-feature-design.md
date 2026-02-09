# Create Terminal Context Menu Feature - Design Document

**Date:** 2026-01-24
**Status:** Design Approved
**Author:** Claude (Superpowers Brainstorming)

## Overview

Add a "Create Terminal" option to the session context menu that creates a new plain shell terminal in the session's worktree directory. The terminal is named with the format `Session Name [n]` where n is the number of terminals currently open for that session.

## Requirements

### Functional Requirements
- FR1: User can right-click on a session in the sessions view to access "Create Terminal"
- FR2: New terminal opens in the session's worktree directory
- FR3: Terminal name format: `Session Name [n]` where n increments for each new terminal
- FR4: Terminal is a plain shell (no Claude Code auto-start)
- FR5: No limit on number of terminals per session

### Non-Functional Requirements
- NFR1: Terminal numbering continues incrementally even after terminals are closed
- NFR2: Handle session names with special characters
- NFR3: Graceful error handling for edge cases

## Architecture

### Components

#### 1. Command Definition (`package.json`)

```json
"claudeWorktrees.createTerminal": {
  "title": "Create Terminal",
  "icon": "$(terminal)"
}
```

#### 2. Context Menu Entry (`package.json`)

```json
{
  "command": "claudeWorktrees.createTerminal",
  "when": "view == claudeSessionsView && viewItem == sessionItem",
  "group": "inline@3"
}
```

#### 3. Command Handler (`extension.ts`)

```typescript
async function createTerminalForSession(item: SessionItem): Promise<void>
```

### Data Flow

```
User right-clicks session
    ↓
Context menu shows "Create Terminal"
    ↓
User clicks "Create Terminal"
    ↓
Command handler receives SessionItem
    ↓
Extract session name and worktree path
    ↓
Count existing terminals for this session
    ↓
Create terminal with name "{Session Name} [{n}]"
    ↓
Set working directory to worktree path
    ↓
Show terminal to user
```

### Terminal Counting Logic

To determine the next terminal number:

1. Get all terminals: `vscode.window.terminals`
2. Filter for names matching pattern: `^{sessionName} \[(\d+)\]$`
3. Extract numbers from matching terminals
4. Next number = max(extracted numbers) + 1, or 1 if no matches

## Implementation Details

### Files to Modify

1. **`package.json`**
   - Add command `claudeWorktrees.createTerminal`
   - Add context menu entry in `menus.view.item.context`

2. **`src/extension.ts`**
   - Add `createTerminalForSession()` function
   - Register command handler

### Code Structure

```typescript
async function createTerminalForSession(item: SessionItem): Promise<void> {
    const sessionName = item.label;
    const worktreePath = item.resourceUri?.fsPath;

    // Validation
    if (!worktreePath) {
        vscode.window.showErrorMessage("Cannot determine worktree path for this session");
        return;
    }

    // Count existing terminals for this session
    const terminalCount = countTerminalsForSession(sessionName);

    // Create terminal
    const terminalName = `${sessionName} [${terminalCount + 1}]`;
    const terminal = vscode.window.createTerminal({
        name: terminalName,
        cwd: worktreePath
    });

    terminal.show();
}

function countTerminalsForSession(sessionName: string): number {
    const pattern = new RegExp(`^${escapeRegExp(sessionName)} \\[(\\d+)\\]$`);
    const numbers: number[] = [];

    for (const terminal of vscode.window.terminals) {
        const match = terminal.name.match(pattern);
        if (match) {
            numbers.push(parseInt(match[1], 10));
        }
    }

    return numbers.length > 0 ? Math.max(...numbers) : 0;
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

## Error Handling

| Error Condition | Handling |
|-----------------|----------|
| `item.resourceUri` is undefined | Show error: "Cannot determine worktree path for this session" |
| Worktree directory doesn't exist | Show error: "Worktree directory no longer exists" |
| Terminal creation fails | Try/catch with error message |

## Testing

### Manual Testing Checklist

- [ ] Right-click on a session → "Create Terminal" appears in context menu
- [ ] Click "Create Terminal" → new terminal opens with correct name
- [ ] Terminal is in the correct worktree directory (verify with `pwd`)
- [ ] Create multiple terminals → numbers increment correctly ([1], [2], [3]...)
- [ ] Close a terminal and create new one → number continues correctly
- [ ] Terminal is a plain shell (Claude Code not auto-started)
- [ ] Test with session names containing spaces
- [ ] Test with session names containing special characters
- [ ] Test on session with no existing terminals
- [ ] Test error handling when worktree path is missing

### Unit Tests (if applicable)

- Test terminal counting logic with various name patterns
- Test regex escaping for special characters
- Test edge cases (no terminals, closed terminals)

## Success Criteria

- User can create unlimited terminals per session via context menu
- Terminals open in the correct worktree directory
- Terminal names follow the `Session Name [n]` format consistently
- No breaking changes to existing functionality
