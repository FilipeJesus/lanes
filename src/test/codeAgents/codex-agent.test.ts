import * as assert from 'assert';
import { CodexAgent } from '../../codeAgents/CodexAgent';

suite('CodexAgent Command Building', () => {
    let agent: CodexAgent;

    setup(() => {
        agent = new CodexAgent();
    });

    test('buildStartCommand with acceptEdits permission', () => {
        const command = agent.buildStartCommand({ permissionMode: 'acceptEdits' });
        assert.ok(command.includes('codex'), 'Command should include codex');
        assert.ok(command.includes('--sandbox workspace-write'), 'Should include sandbox flag');
        assert.ok(command.includes('--ask-for-approval on-failure'), 'Should include approval flag');
    });

    test('buildStartCommand with bypassPermissions', () => {
        const command = agent.buildStartCommand({ permissionMode: 'bypassPermissions' });
        assert.ok(command.includes('codex'), 'Command should include codex');
        assert.ok(command.includes('--sandbox danger-full-access'), 'Should include danger sandbox flag');
        assert.ok(command.includes('--ask-for-approval never'), 'Should include never approval flag');
    });

    test('buildStartCommand with prompt containing single quotes', () => {
        const command = agent.buildStartCommand({ prompt: "Fix user's code" });
        assert.ok(command.includes('codex'), 'Command should include codex');
        // Should escape single quote as '\'' pattern (close quote, escaped quote, open quote)
        assert.ok(command.includes("'Fix user'\\''s code'"), 'Should escape single quotes properly');
    });

    test('buildStartCommand with no permission mode and no prompt', () => {
        const command = agent.buildStartCommand({});
        assert.strictEqual(command, 'codex', 'Command should be just codex');
    });

    test('buildStartCommand with both permission mode and prompt', () => {
        const command = agent.buildStartCommand({
            permissionMode: 'acceptEdits',
            prompt: 'Implement feature X'
        });
        assert.ok(command.includes('codex'), 'Command should include codex');
        assert.ok(command.includes('--sandbox workspace-write'), 'Should include sandbox flag');
        assert.ok(command.includes('--ask-for-approval on-failure'), 'Should include approval flag');
        assert.ok(command.includes("'Implement feature X'"), 'Should include escaped prompt');
    });

    test('buildStartCommand includes mcp config overrides when provided', () => {
        const command = agent.buildStartCommand({
            mcpConfigOverrides: [
                'mcp_servers.\"lanes-workflow\".command=\"node\"',
                'mcp_servers.\"lanes-workflow\".args=[\"/path/to/server.js\"]'
            ]
        });
        assert.ok(command.includes("-c 'mcp_servers.\"lanes-workflow\".command=\"node\"'"), 'Should include MCP command override');
        assert.ok(command.includes("-c 'mcp_servers.\"lanes-workflow\".args=[\"/path/to/server.js\"]'"), 'Should include MCP args override');
    });

    test('buildResumeCommand with valid UUID', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
        const command = agent.buildResumeCommand(uuid, {});
        assert.strictEqual(command, `codex resume ${uuid}`, 'Should build resume command correctly');
    });

    test('buildResumeCommand with valid UUID uppercase', () => {
        const uuid = 'A1B2C3D4-E5F6-7890-1234-567890ABCDEF';
        const command = agent.buildResumeCommand(uuid, {});
        assert.strictEqual(command, `codex resume ${uuid}`, 'Should accept uppercase UUIDs');
    });

    test('buildResumeCommand includes mcp config overrides when provided', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
        const command = agent.buildResumeCommand(uuid, {
            mcpConfigOverrides: [
                'mcp_servers.\"lanes-workflow\".command=\"node\"',
                'mcp_servers.\"lanes-workflow\".args=[\"/path/to/server.js\"]'
            ]
        });
        assert.strictEqual(
            command,
            `codex -c 'mcp_servers.\"lanes-workflow\".command=\"node\"' -c 'mcp_servers.\"lanes-workflow\".args=[\"/path/to/server.js\"]' resume ${uuid}`,
            'Should include MCP overrides before resume'
        );
    });

    test('buildResumeCommand with invalid UUID throws error', () => {
        const invalidId = 'not-a-uuid';
        assert.throws(
            () => agent.buildResumeCommand(invalidId, {}),
            /Invalid session ID format/,
            'Should throw error for invalid UUID'
        );
    });

    test('buildResumeCommand with invalid UUID format throws error', () => {
        const invalidUuid = '12345678-1234-1234-1234-12345678'; // Too short
        assert.throws(
            () => agent.buildResumeCommand(invalidUuid, {}),
            /Invalid session ID format/,
            'Should throw error for malformed UUID'
        );
    });
});

suite('CodexAgent Permission Modes', () => {
    let agent: CodexAgent;

    setup(() => {
        agent = new CodexAgent();
    });

    test('getPermissionModes returns 2 modes with correct ids', () => {
        const modes = agent.getPermissionModes();
        assert.strictEqual(modes.length, 2, 'Should have exactly 2 permission modes');

        const ids = modes.map(m => m.id);
        assert.ok(ids.includes('acceptEdits'), 'Should include acceptEdits mode');
        assert.ok(ids.includes('bypassPermissions'), 'Should include bypassPermissions mode');
    });

    test('validatePermissionMode accepts valid modes', () => {
        assert.strictEqual(agent.validatePermissionMode('acceptEdits'), true, 'Should accept acceptEdits');
        assert.strictEqual(agent.validatePermissionMode('bypassPermissions'), true, 'Should accept bypassPermissions');
    });

    test('validatePermissionMode rejects invalid modes', () => {
        assert.strictEqual(agent.validatePermissionMode('invalid'), false, 'Should reject invalid mode');
        assert.strictEqual(agent.validatePermissionMode('default'), false, 'Should reject default mode');
        assert.strictEqual(agent.validatePermissionMode(''), false, 'Should reject empty string');
    });

    test('getPermissionFlag returns correct dual-flag string for acceptEdits', () => {
        const acceptEditsFlag = agent.getPermissionFlag('acceptEdits');
        assert.ok(acceptEditsFlag.includes('--sandbox workspace-write'), 'acceptEdits should have workspace-write');
        assert.ok(acceptEditsFlag.includes('--ask-for-approval on-failure'), 'acceptEdits should have on-failure');
    });

    test('getPermissionFlag returns correct dual-flag string for bypassPermissions', () => {
        const bypassFlag = agent.getPermissionFlag('bypassPermissions');
        assert.ok(bypassFlag.includes('--sandbox danger-full-access'), 'bypassPermissions should have danger access');
        assert.ok(bypassFlag.includes('--ask-for-approval never'), 'bypassPermissions should have never');
    });

    test('getPermissionFlag returns empty string for invalid mode', () => {
        const invalidFlag = agent.getPermissionFlag('invalid-mode');
        assert.strictEqual(invalidFlag, '', 'Should return empty string for invalid mode');
    });
});

suite('CodexAgent Configuration', () => {
    let agent: CodexAgent;

    setup(() => {
        agent = new CodexAgent();
    });

    test('agent has correct name', () => {
        assert.strictEqual(agent.name, 'codex', 'Agent name should be codex');
    });

    test('agent has correct display name', () => {
        assert.strictEqual(agent.displayName, 'Codex CLI', 'Display name should be Codex CLI');
    });

    test('agent has correct CLI command', () => {
        assert.strictEqual(agent.cliCommand, 'codex', 'CLI command should be codex');
    });

    test('getSessionFileName returns correct file name', () => {
        assert.strictEqual(agent.getSessionFileName(), '.claude-session', 'Session file should be .claude-session');
    });

    test('getStatusFileName returns correct file name', () => {
        assert.strictEqual(agent.getStatusFileName(), '.claude-status', 'Status file should be .claude-status');
    });

    test('getTerminalName returns correct format', () => {
        const termName = agent.getTerminalName('test-session');
        assert.strictEqual(termName, 'Codex: test-session', 'Terminal name should have correct format');
    });

    test('getTerminalIcon returns blue robot icon', () => {
        const icon = agent.getTerminalIcon();
        assert.strictEqual(icon.id, 'robot', 'Icon should be robot');
        assert.strictEqual(icon.color, 'terminal.ansiBlue', 'Icon color should be blue');
    });

    test('getValidStatusStates returns all polling-capable states', () => {
        const states = agent.getValidStatusStates();
        assert.strictEqual(states.length, 4, 'Should have exactly 4 states');
        assert.ok(states.includes('active'), 'Should include active state');
        assert.ok(states.includes('idle'), 'Should include idle state');
        assert.ok(states.includes('working'), 'Should include working state');
        assert.ok(states.includes('waiting_for_user'), 'Should include waiting_for_user state');
    });

    test('getHookEvents returns empty array (no hooks)', () => {
        const events = agent.getHookEvents();
        assert.ok(Array.isArray(events), 'Should return an array');
        assert.strictEqual(events.length, 0, 'Should have no hook events');
    });

    test('supportsMcp returns true', () => {
        assert.strictEqual(agent.supportsMcp(), true, 'Codex should support MCP');
    });

    test('generateHooksConfig returns empty array', () => {
        const hooks = agent.generateHooksConfig('/path', '/session', '/status');
        assert.ok(Array.isArray(hooks), 'Should return an array');
        assert.strictEqual(hooks.length, 0, 'Should have no hooks');
    });
});
