import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
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
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
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
