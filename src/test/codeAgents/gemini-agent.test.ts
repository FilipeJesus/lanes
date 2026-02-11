import * as assert from 'assert';
import { GeminiAgent } from '../../codeAgents/GeminiAgent';

suite('GeminiAgent Command Building', () => {
    let agent: GeminiAgent;

    setup(() => {
        agent = new GeminiAgent();
    });

    test('buildStartCommand with acceptEdits permission', () => {
        const command = agent.buildStartCommand({ permissionMode: 'acceptEdits' });
        assert.ok(command.includes('gemini'), 'Command should include gemini');
        assert.ok(command.includes('--approval-mode auto_edit'), 'Should include approval mode auto_edit');
    });

    test('buildStartCommand with bypassPermissions', () => {
        const command = agent.buildStartCommand({ permissionMode: 'bypassPermissions' });
        assert.ok(command.includes('gemini'), 'Command should include gemini');
        assert.ok(command.includes('--approval-mode yolo'), 'Should include approval mode yolo');
    });

    test('buildStartCommand includes prompt argument', () => {
        const command = agent.buildStartCommand({ prompt: 'Hello Gemini' });
        assert.ok(command.includes("'Hello Gemini'"), 'Prompt should be appended to command');
    });

    test('buildStartCommand with no permission mode and no prompt', () => {
        const command = agent.buildStartCommand({});
        assert.strictEqual(command, 'gemini', 'Command should be just gemini');
    });

    test('buildResumeCommand with valid UUID', () => {
        const uuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
        const command = agent.buildResumeCommand(uuid, {});
        assert.strictEqual(command, `gemini --resume ${uuid}`, 'Should build resume command with UUID');
    });

    test('buildResumeCommand with numeric index', () => {
        const command = agent.buildResumeCommand('3', {});
        assert.strictEqual(command, 'gemini --resume 3', 'Should build resume command with index');
    });

    test('buildResumeCommand with latest sentinel', () => {
        const command = agent.buildResumeCommand('latest', {});
        assert.strictEqual(command, 'gemini --resume', 'Should build resume command without argument for latest');
    });

    test('buildResumeCommand with invalid session ID throws error', () => {
        const invalidId = 'not-a-valid-id';
        assert.throws(
            () => agent.buildResumeCommand(invalidId, {}),
            /Invalid session ID format/,
            'Should throw error for invalid session ID'
        );
    });
});

suite('GeminiAgent Permission Modes', () => {
    let agent: GeminiAgent;

    setup(() => {
        agent = new GeminiAgent();
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

    test('getPermissionFlag returns correct flag for acceptEdits', () => {
        const acceptEditsFlag = agent.getPermissionFlag('acceptEdits');
        assert.strictEqual(acceptEditsFlag, '--approval-mode auto_edit', 'acceptEdits should map to auto_edit');
    });

    test('getPermissionFlag returns correct flag for bypassPermissions', () => {
        const bypassFlag = agent.getPermissionFlag('bypassPermissions');
        assert.strictEqual(bypassFlag, '--approval-mode yolo', 'bypassPermissions should map to yolo');
    });

    test('getPermissionFlag returns empty string for invalid mode', () => {
        const invalidFlag = agent.getPermissionFlag('invalid-mode');
        assert.strictEqual(invalidFlag, '', 'Should return empty string for invalid mode');
    });
});

suite('GeminiAgent Configuration', () => {
    let agent: GeminiAgent;

    setup(() => {
        agent = new GeminiAgent();
    });

    test('agent has correct name', () => {
        assert.strictEqual(agent.name, 'gemini', 'Agent name should be gemini');
    });

    test('agent has correct display name', () => {
        assert.strictEqual(agent.displayName, 'Gemini CLI', 'Display name should be Gemini CLI');
    });

    test('agent has correct CLI command', () => {
        assert.strictEqual(agent.cliCommand, 'gemini', 'CLI command should be gemini');
    });

    test('getSessionFileName returns correct file name', () => {
        assert.strictEqual(agent.getSessionFileName(), '.claude-session', 'Session file should be .claude-session');
    });

    test('getStatusFileName returns correct file name', () => {
        assert.strictEqual(agent.getStatusFileName(), '.claude-status', 'Status file should be .claude-status');
    });

    test('getTerminalName returns correct format', () => {
        const termName = agent.getTerminalName('test-session');
        assert.strictEqual(termName, 'Gemini: test-session', 'Terminal name should have correct format');
    });

    test('getTerminalIcon returns yellow robot icon', () => {
        const icon = agent.getTerminalIcon();
        assert.strictEqual(icon.id, 'robot', 'Icon should be robot');
        assert.strictEqual(icon.color, 'terminal.ansiYellow', 'Icon color should be yellow');
    });

    test('getValidStatusStates includes working and waiting', () => {
        const states = agent.getValidStatusStates();
        assert.ok(states.includes('working'), 'Should include working state');
        assert.ok(states.includes('waiting_for_user'), 'Should include waiting_for_user state');
    });

    test('getHookEvents returns hook events', () => {
        const events = agent.getHookEvents();
        assert.ok(Array.isArray(events), 'Should return an array');
        assert.ok(events.length > 0, 'Should have hook events');
    });

    test('supportsMcp returns true', () => {
        assert.strictEqual(agent.supportsMcp(), true, 'Gemini should support MCP');
    });

    test('getMcpConfigDelivery returns settings', () => {
        assert.strictEqual(agent.getMcpConfigDelivery(), 'settings', 'Gemini should deliver MCP via settings');
    });

    test('supportsPositionalPrompt returns true', () => {
        assert.strictEqual(agent.supportsPositionalPrompt(), true, 'Gemini should support positional prompts');
    });

    test('generateHooksConfig returns hooks', () => {
        const hooks = agent.generateHooksConfig('/path', '/session', '/status');
        assert.ok(Array.isArray(hooks), 'Should return an array');
        assert.ok(hooks.length > 0, 'Should have hooks');
    });
});
