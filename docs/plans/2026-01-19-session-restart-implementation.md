# Session Restart Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a "session restart" feature that creates a fresh Claude session with no conversation history while preserving workflow state, replacing the broken `context: clear` slash command approach.

**Architecture:** Add a new VS Code command `claudeWorktrees.restartSession` that closes the current Claude terminal and starts a new one with a fresh session ID. The new session has no conversation history but the existing SessionStart hook ensures workflow_status is called to restore context from the persisted workflow-state.json.

**Tech Stack:** TypeScript, Node.js, VS Code Extension API, MCP SDK, Mocha test framework

---

## Task 1: Add VS Code Command to Restart Session

**Files:**
- Modify: `src/extension.ts`

**Step 1: Add restartSession command registration**

Find the command registration section (around line 1410 after the toggleChimeDisposable registration) and add:

```typescript
// 15. Register RESTART SESSION Command
const restartSessionDisposable = vscode.commands.registerCommand('claudeWorktrees.restartSession', async (item: SessionItem) => {
    if (!item || !item.worktreePath) {
        vscode.window.showErrorMessage('Please right-click on a session to restart it.');
        return;
    }

    try {
        const sessionName = path.basename(item.worktreePath);
        const termName = `Claude: ${sessionName}`;

        // Find and close the existing terminal
        const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
        if (existingTerminal) {
            existingTerminal.dispose();
            // Brief delay to ensure terminal is closed
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Open a new terminal with fresh session
        await openClaudeTerminal(sessionName, item.worktreePath, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath);

        vscode.window.showInformationMessage(`Session '${sessionName}' restarted with fresh context.`);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to restart session: ${getErrorMessage(err)}`);
    }
});
context.subscriptions.push(restartSessionDisposable);
```

**Step 2: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add restart session command"
```

---

## Task 2: Add Context Menu Item for Restart

**Files:**
- Modify: `package.json`

**Step 1: Find the menus section in package.json**

Search for the `menus` section (around line 200) and find the `claudeSessionsView/context` section.

**Step 2: Add restart menu item**

Add the restart menu item after the toggle chime entry:

```json
{
    "command": "claudeWorktrees.restartSession",
    "group": "inline@4",
    "when": "view == claudeSessionsView"
}
```

**Step 3: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Test the command manually**

1. Open VS Code with the extension loaded
2. Right-click on a session in the sidebar
3. Verify "Restart Session" option appears in context menu

**Step 5: Commit**

```bash
git add package.json
git commit -m "feat: add restart session to context menu"
```

---

## Task 3: Add MCP Tool for Session Restart

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Add session_restart tool to the tools list**

Find the `ListToolsRequestSchema` handler (around line 129) and add the new tool definition after the `session_create` tool:

```typescript
{
  name: 'session_restart',
  description:
    'Restart the current Claude session with a fresh context. ' +
    'The existing terminal will be closed and a new one created with no conversation history. ' +
    'Workflow state is preserved and will be restored via the SessionStart hook.',
  inputSchema: {
    type: 'object' as const,
    properties: {},
    required: [],
  },
},
```

**Step 2: Add session_restart case to CallToolRequestSchema handler**

Find the `CallToolRequestSchema` handler (around line 269) and add the case after `session_create`:

```typescript
case 'session_restart': {
  // Write a restart request file that the VS Code extension will process
  const result = await tools.restartSession(worktreePath);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}
```

**Step 3: Run TypeScript compilation**

Run: `npm run compile`
Expected: Error about `tools.restartSession` not existing (we'll add it next)

**Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: add session_restart tool to MCP server"
```

---

## Task 4: Implement restartSession Tool Handler

**Files:**
- Modify: `src/mcp/tools.ts`

**Step 1: Add restartSession function**

Add this function after the `createSession` function (around line 358):

```typescript
/**
 * Restart request configuration.
 * Written to a JSON file for the VS Code extension to process.
 */
export interface RestartSessionConfig {
  worktreePath: string;
  requestedAt: string;
}

/**
 * Request a session restart with fresh context.
 * Writes a config file that the VS Code extension will process.
 *
 * @param worktreePath The worktree root path
 * @returns Result object with success status
 */
export async function restartSession(
  worktreePath: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // 1. Validate worktreePath exists
    if (!fs.existsSync(worktreePath)) {
      return {
        success: false,
        error: `Worktree path does not exist: ${worktreePath}`
      };
    }

    // 2. Ensure restart requests directory exists
    const repoRoot = path.dirname(path.dirname(worktreePath)); // Go up from .worktrees/session-name
    const restartDir = path.join(repoRoot, '.lanes', 'restart-requests');
    if (!fs.existsSync(restartDir)) {
      fs.mkdirSync(restartDir, { recursive: true });
    }

    // 3. Create config object
    const sessionName = path.basename(worktreePath);
    const config: RestartSessionConfig = {
      worktreePath,
      requestedAt: new Date().toISOString()
    };

    // 4. Write config file with unique name
    const configId = `${sessionName}-${Date.now()}`;
    const configPath = path.join(restartDir, `${configId}.json`);
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

    // 5. Return success
    return {
      success: true,
      message: `Session restart requested for '${sessionName}'. The terminal will be closed and a new session started.`
    };

  } catch (err) {
    return {
      success: false,
      error: `Failed to request session restart: ${err instanceof Error ? err.message : String(err)}`
    };
  }
}
```

**Step 2: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 3: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat: implement restartSession tool handler"
```

---

## Task 5: Add File Watcher for Restart Requests

**Files:**
- Modify: `src/extension.ts`

**Step 1: Add helper function to process restart requests**

Add this function before the `activate` function (around line 665):

```typescript
/**
 * Process a pending session restart request from the MCP server.
 * Closes the existing terminal and opens a new one with fresh context.
 */
async function processRestartRequest(
    configPath: string,
    codeAgent: CodeAgent,
    baseRepoPath: string | undefined,
    sessionProvider: ClaudeSessionProvider
): Promise<void> {
    try {
        // Read and parse the config file
        const configContent = await fsPromises.readFile(configPath, 'utf-8');
        const config: RestartSessionConfig = JSON.parse(configContent);

        console.log(`Processing restart request for: ${config.worktreePath}`);

        // Delete the config file first to prevent re-processing
        await fsPromises.unlink(configPath);

        const sessionName = path.basename(config.worktreePath);
        const termName = codeAgent ? codeAgent.getTerminalName(sessionName) : `Claude: ${sessionName}`;

        // Find and close the existing terminal
        const existingTerminal = vscode.window.terminals.find(t => t.name === termName);
        if (existingTerminal) {
            existingTerminal.dispose();
            // Brief delay to ensure terminal is closed
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Open a new terminal with fresh session
        // No prompt, so it starts completely fresh
        await openClaudeTerminal(sessionName, config.worktreePath, undefined, undefined, undefined, undefined, codeAgent, baseRepoPath);

        console.log(`Session restarted: ${sessionName}`);

    } catch (err) {
        console.error(`Failed to process restart request ${configPath}:`, err);
        // Try to delete the config file even on error to prevent infinite retries
        try {
            await fsPromises.unlink(configPath);
        } catch {
            // Ignore deletion errors
        }
        vscode.window.showErrorMessage(`Failed to restart session: ${getErrorMessage(err)}`);
    }
}
```

**Step 2: Add RestartSessionConfig interface**

Add this interface near the top of the file with other interfaces (around line 45 after `PendingSessionConfig`):

```typescript
/**
 * Restart session request from MCP server.
 */
export interface RestartSessionConfig {
    worktreePath: string;
    requestedAt: string;
}
```

**Step 3: Add file watcher for restart requests**

Find the pending session watcher section (around line 889) and add a similar watcher for restart requests:

```typescript
// Watch for session restart requests from MCP
if (baseRepoPath) {
    const restartRequestsDir = path.join(baseRepoPath, '.lanes', 'restart-requests');
    // Ensure the directory exists for the watcher
    if (!fs.existsSync(restartRequestsDir)) {
        fs.mkdirSync(restartRequestsDir, { recursive: true });
    }

    const restartRequestWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(restartRequestsDir, '*.json')
    );

    restartRequestWatcher.onDidCreate(async (uri) => {
        console.log(`Restart request file detected: ${uri.fsPath}`);
        await processRestartRequest(uri.fsPath, codeAgent, baseRepoPath, sessionProvider);
    });

    context.subscriptions.push(restartRequestWatcher);
}
```

**Step 4: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 5: Commit**

```bash
git add src/extension.ts
git commit -m "feat: add file watcher for session restart requests"
```

---

## Task 6: Update Workflow YAML to Use context: restart

**Files:**
- Modify: `src/workflow/types.ts`
- Modify: `src/workflow/loader.ts`
- Modify: `workflows/context-example.yaml`

**Step 1: Update StepContextAction type to include 'restart'**

Modify the type in `src/workflow/types.ts` (around line 17):

```typescript
/**
 * Context action to perform before executing a step.
 */
export type StepContextAction = 'compact' | 'clear' | 'restart';
```

**Step 2: Update validation in loader.ts**

Find the context validation in `validateStep` function (around line 729) and update to include 'restart':

```typescript
if (step.context !== 'compact' && step.context !== 'clear' && step.context !== 'restart') {
  throw new WorkflowValidationError(
    `Step '${stepId}' context must be either 'compact', 'clear', or 'restart', got: ${step.context}`
  );
}
```

Do the same for `validateLoopStep`.

**Step 3: Update context-example.yaml to demonstrate restart**

Add a step using `context: restart`:

```yaml
steps:
  - id: brainstorm
    type: action
    context: restart
    instructions: |
      Start with a completely fresh session.
      This will restart the Claude session with no conversation history.
      The workflow state is preserved and will be restored.
```

**Step 4: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/workflow/types.ts src/workflow/loader.ts workflows/context-example.yaml
git commit -m "feat: add 'restart' as a context action option"
```

---

## Task 7: Update MCP Server to Handle context: restart

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Update workflow_start handler to call session_restart**

Find the context action check in `workflow_start` (around line 296) and modify:

```typescript
// Check for pending context action
const contextAction = machine.getContextActionIfNeeded();
if (contextAction) {
  machine.markContextActionExecuted();
  await tools.saveState(worktreePath, machine.getState());

  if (contextAction === 'restart') {
    // Call session_restart tool
    const result = await tools.restartSession(worktreePath);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          sessionRestart: true,
          message: result.message || 'Session restart requested. Please wait for the new session to start.',
          result
        }, null, 2)
      }]
    };
  }

  const command = contextAction === 'compact' ? '/compact' : '/clear';
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        contextAction: command,
        message: `Please run \`${command}\` first, then call workflow_status again.`
      }, null, 2)
    }]
  };
}
```

**Step 2: Update workflow_advance handler similarly**

Find the context action check in `workflow_advance` (around line 416) and apply the same changes.

**Step 3: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: handle restart context action in MCP server"
```

---

## Task 8: Add Tests for Session Restart

**Files:**
- Modify: `src/test/workflow.test.ts`

**Step 1: Add test for restart context action**

Add to the Context Management suite:

```typescript
test('Returns restart action when step has context: restart', () => {
  // Arrange
  const template = loadWorkflowTemplateFromString(`
name: test
description: Test
steps:
  - id: step1
    type: action
    context: restart
    instructions: Restart first
`);
  const machine = new WorkflowStateMachine(template);
  machine.start();

  // Act
  const action = machine.getContextActionIfNeeded();

  // Assert
  assert.strictEqual(action, 'restart');
});
```

**Step 2: Add tests for restartSession tool**

Create a new test file `src/test/session-restart.test.ts`:

```typescript
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { restartSession } from '../mcp/tools';

suite('Session Restart Tool', () => {
  let tempDir: string;
  let worktreePath: string;

  setup(() => {
    // Create a temporary directory for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-test-'));
    worktreePath = path.join(tempDir, '.worktrees', 'test-session');
    fs.mkdirSync(worktreePath, { recursive: true });
  });

  teardown(() => {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('restartSession creates restart request file', async () => {
    // Act
    const result = await restartSession(worktreePath);

    // Assert
    assert.strictEqual(result.success, true);
    assert.ok(result.message);

    // Verify the request file was created
    const repoRoot = path.dirname(path.dirname(worktreePath));
    const restartDir = path.join(repoRoot, '.lanes', 'restart-requests');
    assert.ok(fs.existsSync(restartDir));

    const files = fs.readdirSync(restartDir);
    assert.ok(files.length > 0);

    // Verify file contents
    const configPath = path.join(restartDir, files[0]);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.worktreePath, worktreePath);
    assert.ok(config.requestedAt);
  });

  test('restartSession fails for non-existent worktree', async () => {
    // Arrange
    const nonExistentPath = path.join(tempDir, 'does-not-exist');

    // Act
    const result = await restartSession(nonExistentPath);

    // Assert
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error?.includes('does not exist'));
  });
});
```

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/test/workflow.test.ts src/test/session-restart.test.ts
git commit -m "test: add tests for session restart feature"
```

---

## Task 9: Integration Testing

**Step 1: Compile everything**

Run: `npm run compile`
Expected: No errors

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Test end-to-end with VS Code**

1. Load the extension in VS Code (F5)
2. Create a session with the context-example workflow
3. When workflow reaches the `context: restart` step, verify:
   - MCP server returns session restart message
   - Terminal closes
   - New terminal opens
   - SessionStart hook fires
   - workflow_status is called
   - New session continues from current step

**Step 4: Test context menu restart**

1. Right-click on a session
2. Select "Restart Session"
3. Verify terminal closes and reopens

**Step 5: Check git diff**

Run: `git diff`
Expected: Only planned changes

**Step 6: Final commit if needed**

```bash
git add -A
git commit -m "chore: final adjustments for session restart feature"
```

---

## Task 10: Documentation

**Files:**
- Create: `docs/plans/2026-01-19-session-restart-design.md`

**Step 1: Create design documentation**

```markdown
# Session Restart Feature Design

**Date:** 2026-01-19
**Status:** Implemented

## Overview

The session restart feature provides a reliable way to clear conversation context without relying on automatic slash commands. When a workflow step specifies `context: restart`, a fresh Claude session is created with no conversation history while workflow state is preserved.

## Problem Solved

The original `context: clear` feature was broken because Claude cannot automatically execute slash commands like `/clear`. The restart feature achieves the same goal by creating a new session.

## How It Works

1. Workflow step specifies `context: restart`
2. MCP server's `workflow_status` detects the pending restart action
3. MCP server calls `restartSession()` which writes a config file
4. VS Code extension's file watcher detects the config file
5. Extension closes the existing terminal and opens a new one
6. New session has no conversation history
7. SessionStart hook fires, telling Claude to run `workflow_status`
8. Claude reads workflow state and continues from current step

## Usage

### In Workflow YAML

```yaml
steps:
  - id: brainstorm
    type: action
    context: restart
    instructions: |
      Start with a completely fresh perspective.
```

### From Context Menu

Right-click on a session in the sidebar and select "Restart Session".

## Files Modified

- `src/extension.ts` - Added restartSession command and file watcher
- `src/mcp/server.ts` - Added session_restart tool
- `src/mcp/tools.ts` - Added restartSession handler
- `src/workflow/types.ts` - Added 'restart' to StepContextAction
- `package.json` - Added context menu item
```

**Step 2: Commit**

```bash
git add docs/plans/2026-01-19-session-restart-design.md
git commit -m "docs: add session restart design documentation"
```

---

## Summary

This implementation plan adds a session restart feature to replace the broken `context: clear` functionality in 10 tasks:

1. **VS Code command** - Add `claudeWorktrees.restartSession` command
2. **Context menu** - Add "Restart Session" to right-click menu
3. **MCP tool** - Add `session_restart` tool to MCP server
4. **Tool handler** - Implement `restartSession()` function
5. **File watcher** - Watch for restart request files
6. **YAML updates** - Add 'restart' as context action option
7. **MCP integration** - Handle restart in workflow_start/advance
8. **Tests** - Comprehensive test coverage
9. **Integration** - End-to-end testing
10. **Documentation** - Design doc and usage guide

The design ensures that sessions can be restarted with a fresh context while preserving workflow state, providing a reliable alternative to the broken slash command approach.
