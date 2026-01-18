# Session Start Hook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a Session Start hook that ensures workflow status synchronization whenever a Claude Code session starts or resumes.

**Architecture:** Extend the existing `ClaudeCodeAgent` hook generation system to conditionally add a SessionStart hook that outputs JSON with `additionalContext` instructing the AI to call `workflow_status` immediately. The hook is only added when a workflow is active.

**Tech Stack:** TypeScript, VS Code Extension API, Claude Code Hooks system

---

## Overview

This feature adds automatic workflow status checking to Lanes sessions. When a user creates a session with a workflow template, the SessionStart hook ensures that whenever the AI agent starts or resumes (including after `/clear` or `/compact`), it immediately checks the current workflow status before proceeding with any work.

### Key Implementation Points

1. **Inline Hook Generation**: No external script files - hook command is generated inline in `ClaudeCodeAgent.generateHooksConfig()`
2. **Conditional Activation**: Hook only added when `workflow` parameter is truthy
3. **JSON Output**: Hook outputs properly escaped JSON with `additionalContext` field
4. **Matcher Pattern**: Uses `startup|resume|clear|compact` to trigger on all session start events

---

## Task 1: Update ClaudeCodeAgent.generateHooksConfig() signature

**Files:**
- Modify: `src/codeAgents/ClaudeCodeAgent.ts:236-240`

**Step 1: Write the failing test**

Create new test file: `src/test/codeAgent.test.ts`

```typescript
import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import { ClaudeCodeAgent } from '../codeAgents/ClaudeCodeAgent';

suite('ClaudeCodeAgent Hooks', () => {
    let tempDir: string;
    let sessionFilePath: string;
    let statusFilePath: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-code-agent-test-'));
        sessionFilePath = path.join(tempDir, '.claude-session');
        statusFilePath = path.join(tempDir, '.claude-status');
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('generateHooksConfig should accept optional workflow parameter', () => {
        // Arrange
        const agent = new ClaudeCodeAgent();
        const worktreePath = tempDir;

        // Act & Assert - should not throw with workflow parameter
        const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, undefined);

        // Should return array of hook configs
        assert.ok(Array.isArray(hooks));
        assert.ok(hooks.length > 0);
    });

    test('generateHooksConfig should include workflow status hook when workflow is provided', () => {
        // Arrange
        const agent = new ClaudeCodeAgent();
        const worktreePath = tempDir;
        const workflowPath = '/absolute/path/to/workflow.yaml';

        // Act
        const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, workflowPath);

        // Assert - should have SessionStart hook with workflow check
        const sessionStartHook = hooks.find(h => h.event === 'SessionStart');
        assert.ok(sessionStartHook, 'Should have SessionStart hook');

        // Should have multiple commands: session ID capture + workflow status check
        assert.ok(sessionStartHook!.commands.length >= 2, 'SessionStart should have at least 2 commands');
    });

    test('generateHooksConfig should NOT include workflow status hook when workflow is undefined', () => {
        // Arrange
        const agent = new ClaudeCodeAgent();
        const worktreePath = tempDir;

        // Act
        const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, undefined);

        // Assert - SessionStart should only have session ID capture
        const sessionStartHook = hooks.find(h => h.event === 'SessionStart');
        assert.ok(sessionStartHook, 'Should have SessionStart hook');
        assert.strictEqual(sessionStartHook!.commands.length, 1, 'SessionStart should only have 1 command (session ID capture)');
    });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/.worktrees/feat-session-start
npm test -- src/test/codeAgent.test.ts
```

Expected: FAIL - `generateHooksConfig()` doesn't accept workflow parameter yet

**Step 3: Write minimal implementation**

Modify `src/codeAgents/ClaudeCodeAgent.ts`:

```typescript
// Update the method signature
generateHooksConfig(
    worktreePath: string,
    sessionFilePath: string,
    statusFilePath: string,
    workflowPath?: string
): HookConfig[] {
    // ... existing code
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- src/test/codeAgent.test.ts
```

Expected: PASS (some tests may still fail until full implementation)

**Step 5: Commit**

```bash
git add src/codeAgents/ClaudeCodeAgent.ts src/test/codeAgent.test.ts
git commit -m "feat: add workflow parameter to ClaudeCodeAgent.generateHooksConfig()"
```

---

## Task 2: Add workflow status hook command generation

**Files:**
- Modify: `src/codeAgents/ClaudeCodeAgent.ts:236-283`

**Step 1: Write the failing test**

Update `src/test/codeAgent.test.ts`:

```typescript
test('workflow status hook command should output valid JSON', () => {
    // Arrange
    const agent = new ClaudeCodeAgent();
    const worktreePath = tempDir;
    const workflowPath = '/absolute/path/to/workflow.yaml';

    // Act
    const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, workflowPath);
    const sessionStartHook = hooks.find(h => h.event === 'SessionStart');

    // Assert - get the second command (workflow status check)
    const workflowCmd = sessionStartHook!.commands.find((c, i) => i === 1);
    assert.ok(workflowCmd, 'Should have workflow status command');

    // Command should be an echo with JSON
    assert.ok(workflowCmd!.command.includes('echo'), 'Command should use echo');
    assert.ok(workflowCmd!.command.includes('additionalContext'), 'Command should include additionalContext');
    assert.ok(workflowCmd!.command.includes('workflow_status'), 'Command should mention workflow_status');
});

test('workflow status hook should escape JSON properly', () => {
    // Arrange
    const agent = new ClaudeCodeAgent();
    const worktreePath = tempDir;
    const workflowPath = '/absolute/path/to/workflow.yaml';

    // Act
    const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, workflowPath);
    const sessionStartHook = hooks.find(h => h.event === 'SessionStart');
    const workflowCmd = sessionStartHook!.commands.find((c, i) => i === 1);

    // Assert - JSON should be properly escaped for shell
    const cmd = workflowCmd!.command;
    // Should have proper quotes and escapes
    assert.ok(cmd.includes('"'), 'Command should have quotes for JSON');
    assert.ok(cmd.includes('{'), 'Command should have opening brace');
    assert.ok(cmd.includes('}'), 'Command should have closing brace');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/test/codeAgent.test.ts
```

Expected: FAIL - workflow status hook not implemented yet

**Step 3: Write minimal implementation**

Modify `src/codeAgents/ClaudeCodeAgent.ts` in the `generateHooksConfig` method:

```typescript
generateHooksConfig(
    worktreePath: string,
    sessionFilePath: string,
    statusFilePath: string,
    workflowPath?: string
): HookConfig[] {
    // Status update hooks
    const statusWriteWaiting: HookCommand = {
        type: 'command',
        command: `echo '{"status":"waiting_for_user"}' > "${statusFilePath}"`
    };

    const statusWriteWorking: HookCommand = {
        type: 'command',
        command: `echo '{"status":"working"}' > "${statusFilePath}"`
    };

    // Session ID capture hook
    const sessionIdCapture: HookCommand = {
        type: 'command',
        command: `old=$(cat "${sessionFilePath}" 2>/dev/null || echo '{}'); jq -r --argjson old "$old" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '$old + {sessionId: .session_id, timestamp: $ts}' > "${sessionFilePath}"`
    };

    // Build SessionStart hooks array
    const sessionStartCommands: HookCommand[] = [sessionIdCapture];

    // Add workflow status hook if workflow is active
    if (workflowPath) {
        const workflowStatusCheck: HookCommand = {
            type: 'command',
            command: `echo '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<system-reminder>\\nLanes Workflow Engine is active.\\nTo ensure context synchronization, you MUST run the workflow_status tool immediately.\\nDo not proceed with user requests until the workflow state is confirmed.\\n</system-reminder>"}}'`
        };
        sessionStartCommands.push(workflowStatusCheck);
    }

    return [
        {
            event: 'SessionStart',
            commands: sessionStartCommands
        },
        {
            event: 'Stop',
            commands: [statusWriteWaiting]
        },
        {
            event: 'UserPromptSubmit',
            commands: [statusWriteWorking]
        },
        {
            event: 'Notification',
            matcher: 'permission_prompt',
            commands: [statusWriteWaiting]
        },
        {
            event: 'PreToolUse',
            matcher: '.*',
            commands: [statusWriteWorking]
        }
    ];
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- src/test/codeAgent.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/codeAgents/ClaudeCodeAgent.ts src/test/codeAgent.test.ts
git commit -m "feat: add workflow status check hook to SessionStart"
```

---

## Task 3: Update getOrCreateExtensionSettingsFile to pass workflow to generateHooksConfig

**Files:**
- Modify: `src/extension.ts:2183-2203`

**Step 1: Write the failing test**

Update `src/test/extension.test.ts`:

```typescript
test('should include workflow status hook when workflow is specified', async () => {
    // Arrange
    const sessionName = 'workflow-session';
    const worktreePath = path.join(worktreesDir, sessionName);
    fs.mkdirSync(worktreePath, { recursive: true });

    const workflowPath = path.join(tempDir, 'workflows', 'test-workflow.yaml');
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    fs.writeFileSync(workflowPath, 'name: test\nsteps: []');

    // Act
    const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath, workflowPath);

    // Assert
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);

    // Should have SessionStart hook with multiple commands
    assert.ok(settings.hooks.SessionStart, 'Should have SessionStart hook');
    assert.ok(settings.hooks.SessionStart[0].hooks.length >= 2, 'SessionStart should have at least 2 commands when workflow is active');

    // Second command should be the workflow status check
    const workflowHookCmd = settings.hooks.SessionStart[0].hooks[1];
    assert.ok(workflowHookCmd.command.includes('workflow_status'), 'Second command should check workflow status');
});

test('should NOT include workflow status hook when workflow is not specified', async () => {
    // Arrange
    const sessionName = 'no-workflow-session';
    const worktreePath = path.join(worktreesDir, sessionName);
    fs.mkdirSync(worktreePath, { recursive: true });

    // Act - no workflow parameter
    const settingsPath = await getOrCreateExtensionSettingsFile(worktreePath);

    // Assert
    const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(settingsContent);

    // SessionStart should only have session ID capture
    assert.ok(settings.hooks.SessionStart, 'Should have SessionStart hook');
    assert.strictEqual(settings.hooks.SessionStart[0].hooks.length, 1, 'SessionStart should only have 1 command when no workflow');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/test/extension.test.ts -g "should include workflow status hook"
```

Expected: FAIL - `effectiveWorkflow` not passed to `generateHooksConfig` yet

**Step 3: Write minimal implementation**

Modify `src/extension.ts` around line 2186:

```typescript
if (codeAgent) {
    // Use CodeAgent to generate hooks
    // Pass effectiveWorkflow to enable workflow status hook
    const hookConfigs = codeAgent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, effectiveWorkflow);

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
}
```

**Step 4: Run test to verify it passes**

```bash
npm test -- src/test/extension.test.ts -g "should include workflow status hook"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/extension.ts src/test/extension.test.ts
git commit -m "feat: pass workflow to generateHooksConfig for status hook"
```

---

## Task 4: Add matcher pattern to SessionStart hook

**Files:**
- Modify: `src/codeAgents/ClaudeCodeAgent.ts:259-263`

**Step 1: Write the failing test**

Update `src/test/codeAgent.test.ts`:

```typescript
test('SessionStart hook should have correct matcher pattern', () => {
    // Arrange
    const agent = new ClaudeCodeAgent();
    const worktreePath = tempDir;

    // Act
    const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath, undefined);
    const sessionStartHook = hooks.find(h => h.event === 'SessionStart');

    // Assert - should have matcher for startup|resume|clear|compact
    assert.ok(sessionStartHook, 'Should have SessionStart hook');
    assert.strictEqual(sessionStartHook!.matcher, 'startup|resume|clear|compact', 'Matcher should match all session start events');
});
```

**Step 2: Run test to verify it fails**

```bash
npm test -- src/test/codeAgent.test.ts -g "matcher pattern"
```

Expected: FAIL - matcher not set on SessionStart hook yet

**Step 3: Write minimal implementation**

Modify `src/codeAgents/ClaudeCodeAgent.ts`:

```typescript
return [
    {
        event: 'SessionStart',
        matcher: 'startup|resume|clear|compact',
        commands: sessionStartCommands
    },
    // ... rest of hooks
];
```

**Step 4: Run test to verify it passes**

```bash
npm test -- src/test/codeAgent.test.ts -g "matcher pattern"
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/codeAgents/ClaudeCodeAgent.ts src/test/codeAgent.test.ts
git commit -m "feat: add matcher to SessionStart hook for all session events"
```

---

## Task 5: Run full test suite and fix any issues

**Files:**
- Test: All test files

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass (or note any failures to fix)

**Step 2: Fix any failing tests**

If any tests fail, investigate and fix them. Common issues:
- Missing imports
- Type mismatches
- Mock data inconsistencies

**Step 3: Run tests again**

```bash
npm test
```

Expected: All tests pass

**Step 4: Run linter**

```bash
npm run lint
```

Expected: No errors (fix any warnings/errors)

**Step 5: Commit**

```bash
git add .
git commit -m "test: ensure all tests pass for session start hook feature"
```

---

## Task 6: Manual testing and verification

**Files:**
- Manual verification steps

**Step 1: Compile the extension**

```bash
npm run compile
```

Expected: Successful compilation with no errors

**Step 2: Create a test session with workflow**

Using the VS Code extension:
1. Create a new session with any workflow (e.g., "superpowers")
2. Open the session terminal
3. Check the generated settings file in global storage

**Step 3: Verify the settings file**

```bash
# Find the settings file (path will be in global storage)
cat ~/Library/Application\ Support/Code/User/globalStorage/lanes.<repo-id>/<session-name>/claude-settings.json
```

Expected output should include:
```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "old=$(cat \"...\" ..."
          },
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{...}}'"
          }
        ]
      }
    ]
  }
}
```

**Step 4: Test the hook execution**

In the Claude session terminal, the hook should automatically:
1. Capture the session ID on first start
2. Output the workflow status reminder

**Step 5: Test session resume**

1. Close and reopen the session
2. Verify the workflow status reminder appears again

**Step 6: Test without workflow**

Create a session without selecting a workflow. Verify that:
- Settings file only has session ID capture (1 command)
- No workflow status check present

**Step 7: Document findings**

Create a brief test report in `claude-progress.txt`:

```
## Session: 2026-01-18

### Completed
- Implemented Session Start hook for workflow status checking
- Hook only activates when workflow is specified
- Tests passing for new functionality
- Manual testing verified hook works correctly

### Next Steps
- Consider adding similar hooks for other workflow events
- Monitor for any edge cases in production use
```

**Step 8: Commit**

```bash
git add claude-progress.txt
git commit -m "docs: update progress with session start hook completion"
```

---

## Task 7: Update documentation (optional)

**Files:**
- Modify: `CLAUDE.md` or create `docs/workflow-hooks.md`

**Step 1: Decide if documentation is needed**

The feature is mostly internal, but documenting it could help users understand:
- What the workflow status hook does
- When it activates
- How to troubleshoot issues

**Step 2: Write documentation** (if needed)

Add to `CLAUDE.md` in the Workflow System section:

```markdown
## Workflow Status Hooks

When you create a session with a workflow template, Lanes automatically adds a SessionStart hook that ensures workflow synchronization. This hook:

- Runs on session startup, resume, clear, and compact events
- Instructs Claude to check workflow status immediately
- Only activates when a workflow is specified

This ensures that whenever you return to a session, the AI agent first checks the current workflow state before proceeding with work.
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document workflow status hook behavior"
```

---

## Summary

This implementation plan adds automatic workflow status checking to Lanes sessions through the SessionStart hook. The key benefits are:

1. **Automatic synchronization**: AI always checks workflow state on session start/resume
2. **Conditional activation**: Only runs when a workflow is specified
3. **No external files**: Everything generated inline using existing patterns
4. **Comprehensive coverage**: Works on startup, resume, clear, and compact events

The implementation follows existing patterns in the codebase and requires no external script files, making it maintainable and consistent with the current architecture.
