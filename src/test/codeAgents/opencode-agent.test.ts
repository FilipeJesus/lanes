import * as assert from 'assert';
import { OpenCodeAgent } from '../../core/codeAgents/OpenCodeAgent';

suite('OpenCodeAgent', () => {
    let agent: OpenCodeAgent;

    setup(() => {
        agent = new OpenCodeAgent();
    });

    suite('Basic Configuration', () => {
        test('name is opencode', () => {
            assert.strictEqual(agent.name, 'opencode', 'Agent name should be opencode');
        });

        test('displayName is OpenCode', () => {
            assert.strictEqual(agent.displayName, 'OpenCode', 'Display name should be OpenCode');
        });

        test('cliCommand is opencode', () => {
            assert.strictEqual(agent.cliCommand, 'opencode', 'CLI command should be opencode');
        });

        test('sessionFileExtension is .claude-session', () => {
            assert.strictEqual(
                (agent as any).config.sessionFileExtension,
                '.claude-session',
                'Session file extension should be .claude-session'
            );
        });

        test('statusFileExtension is .claude-status', () => {
            assert.strictEqual(
                (agent as any).config.statusFileExtension,
                '.claude-status',
                'Status file extension should be .claude-status'
            );
        });

        test('settingsFileName is opencode.jsonc', () => {
            assert.strictEqual(
                (agent as any).config.settingsFileName,
                'opencode.jsonc',
                'Settings file name should be opencode.jsonc'
            );
        });

        test('defaultDataDir is .opencode', () => {
            assert.strictEqual(
                (agent as any).config.defaultDataDir,
                '.opencode',
                'Default data dir should be .opencode'
            );
        });
    });

    suite('File Naming Methods', () => {
        test('getSessionFileName returns .claude-session', () => {
            assert.strictEqual(agent.getSessionFileName(), '.claude-session');
        });

        test('getStatusFileName returns .claude-status', () => {
            assert.strictEqual(agent.getStatusFileName(), '.claude-status');
        });

        test('getSettingsFileName returns opencode.jsonc', () => {
            assert.strictEqual(agent.getSettingsFileName(), 'opencode.jsonc');
        });

        test('getDataDirectory returns .opencode', () => {
            assert.strictEqual(agent.getDataDirectory(), '.opencode');
        });
    });

    suite('Terminal Configuration', () => {
        test('getTerminalName returns correct format', () => {
            const termName = agent.getTerminalName('test-session');
            assert.strictEqual(termName, 'OpenCode: test-session', 'Terminal name should have correct format');
        });

        test('getTerminalIcon returns robot icon with magenta color', () => {
            const icon = agent.getTerminalIcon();
            assert.strictEqual(icon.id, 'robot', 'Icon should be robot');
            assert.strictEqual(icon.color, 'terminal.ansiMagenta', 'Icon color should be magenta');
        });
    });

    suite('Start Command Building', () => {
        test('buildStartCommand with prompt uses --prompt flag', () => {
            const command = agent.buildStartCommand({ prompt: '"$(cat "/tmp/prompt.txt")"' });
            assert.strictEqual(command, 'opencode --prompt "$(cat "/tmp/prompt.txt")"');
        });

        test('buildStartCommand with raw prompt shell-escapes it', () => {
            const command = agent.buildStartCommand({ prompt: 'Hello OpenCode' });
            assert.strictEqual(command, "opencode --prompt 'Hello OpenCode'");
        });

        test('buildStartCommand without prompt returns just opencode', () => {
            const command = agent.buildStartCommand({});
            assert.strictEqual(command, 'opencode', 'Command without prompt should be just opencode');
        });
    });

    suite('Resume Command Building', () => {
        test('buildResumeCommand with valid ses_ ID returns opencode --session <sessionId>', () => {
            const sessionId = 'ses_3a3dc35efffeDUYQRmDO8b77Vi';
            const command = agent.buildResumeCommand(sessionId, {});
            assert.strictEqual(
                command,
                `opencode --session ${sessionId}`,
                'Should build resume command with ses_ ID'
            );
        });

        test('buildResumeCommand with invalid session ID throws error', () => {
            const invalidId = 'not-a-valid-id';
            assert.throws(
                () => agent.buildResumeCommand(invalidId, {}),
                /Invalid session ID format/,
                'Should throw error for invalid session ID'
            );
        });

        test('buildResumeCommand with UUID format throws error (OpenCode uses ses_ format)', () => {
            const uuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
            assert.throws(
                () => agent.buildResumeCommand(uuid, {}),
                /Invalid session ID format/,
                'Should reject UUID format - OpenCode uses ses_ prefix'
            );
        });
    });

    suite('Session Data Parsing', () => {
        test('parseSessionData with valid ses_ format returns SessionData object', () => {
            const json = JSON.stringify({
                sessionId: 'ses_3a3dc35efffeDUYQRmDO8b77Vi',
                timestamp: '2026-02-14T12:00:00Z'
            });
            const result = agent.parseSessionData(json);
            assert.ok(result, 'Should parse valid session data');
            assert.strictEqual(result!.sessionId, 'ses_3a3dc35efffeDUYQRmDO8b77Vi');
            assert.strictEqual(result!.agentName, 'opencode');
        });

        test('parseSessionData with invalid JSON returns null', () => {
            const result = agent.parseSessionData('not valid json');
            assert.strictEqual(result, null, 'Should return null for invalid JSON');
        });

        test('parseSessionData missing sessionId returns null', () => {
            const json = JSON.stringify({ timestamp: '2026-02-14T12:00:00Z' });
            const result = agent.parseSessionData(json);
            assert.strictEqual(result, null, 'Should return null when sessionId is missing');
        });

        test('parseSessionData with invalid sessionId format returns null', () => {
            const json = JSON.stringify({
                sessionId: 'not-valid-format',
                timestamp: '2026-02-14T12:00:00Z'
            });
            const result = agent.parseSessionData(json);
            assert.strictEqual(result, null, 'Should return null for invalid session ID format');
        });

        test('parseSessionData rejects UUID format (OpenCode uses ses_ prefix)', () => {
            const json = JSON.stringify({
                sessionId: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
                timestamp: '2026-02-14T12:00:00Z'
            });
            const result = agent.parseSessionData(json);
            assert.strictEqual(result, null, 'Should reject UUID format');
        });
    });

    suite('Status Data Parsing', () => {
        test('parseStatus with valid JSON returns AgentStatus object', () => {
            const json = JSON.stringify({
                status: 'working',
                timestamp: '2026-02-14T12:00:00Z',
                message: 'Processing'
            });
            const result = agent.parseStatus(json);
            assert.ok(result, 'Should parse valid status');
            assert.strictEqual(result!.status, 'working');
            assert.strictEqual(result!.message, 'Processing');
        });

        test('parseStatus with invalid JSON returns null', () => {
            const result = agent.parseStatus('not valid json');
            assert.strictEqual(result, null, 'Should return null for invalid JSON');
        });

        test('parseStatus missing status field returns null', () => {
            const json = JSON.stringify({
                timestamp: '2026-02-14T12:00:00Z',
                message: 'Processing'
            });
            const result = agent.parseStatus(json);
            assert.strictEqual(result, null, 'Should return null when status field is missing');
        });
    });

    suite('Valid Status States', () => {
        test('getValidStatusStates returns all polling-capable states', () => {
            const states = agent.getValidStatusStates();
            assert.deepStrictEqual(
                states,
                ['active', 'idle', 'working', 'waiting_for_user'],
                'Should return active, idle, working, and waiting_for_user states'
            );
        });
    });

    suite('Permission Modes', () => {
        test('getPermissionModes returns array with acceptEdits and bypassPermissions', () => {
            const modes = agent.getPermissionModes();
            assert.strictEqual(modes.length, 2, 'Should have exactly 2 permission modes');

            const ids = modes.map(m => m.id);
            assert.ok(ids.includes('acceptEdits'), 'Should include acceptEdits mode');
            assert.ok(ids.includes('bypassPermissions'), 'Should include bypassPermissions mode');
        });

        test('validatePermissionMode accepts valid modes', () => {
            assert.strictEqual(agent.validatePermissionMode('acceptEdits'), true, 'Should accept acceptEdits');
            assert.strictEqual(
                agent.validatePermissionMode('bypassPermissions'),
                true,
                'Should accept bypassPermissions'
            );
        });

        test('validatePermissionMode rejects invalid modes', () => {
            assert.strictEqual(agent.validatePermissionMode('invalid'), false, 'Should reject invalid mode');
        });

        test('getPermissionFlag returns empty strings for config-based permissions', () => {
            const acceptEditsFlag = agent.getPermissionFlag('acceptEdits');
            assert.strictEqual(acceptEditsFlag, '', 'acceptEdits should return empty string (config-based)');

            const bypassFlag = agent.getPermissionFlag('bypassPermissions');
            assert.strictEqual(bypassFlag, '', 'bypassPermissions should return empty string (config-based)');
        });
    });

    suite('Hooks Support', () => {
        test('getHookEvents returns empty array (hookless agent)', () => {
            const events = agent.getHookEvents();
            assert.deepStrictEqual(events, [], 'Should return empty array for hookless agent');
        });

        test('generateHooksConfig returns empty array (hookless agent)', () => {
            const hooks = agent.generateHooksConfig('/path', '/session', '/status');
            assert.deepStrictEqual(hooks, [], 'Should return empty array for hookless agent');
        });
    });

    suite('Local Settings', () => {
        test('getLocalSettingsFiles returns empty array (no local settings files)', () => {
            const files = agent.getLocalSettingsFiles();
            assert.deepStrictEqual(files, [], 'Should return empty array - OpenCode has no local settings pattern');
        });
    });

    suite('MCP Support', () => {
        test('supportsMcp returns true', () => {
            assert.strictEqual(agent.supportsMcp(), true, 'OpenCode should support MCP');
        });

        test('getMcpConfigDelivery returns settings', () => {
            assert.strictEqual(
                agent.getMcpConfigDelivery(),
                'settings',
                'OpenCode should deliver MCP via settings'
            );
        });

        test('getMcpConfig returns valid McpConfig object', () => {
            const config = agent.getMcpConfig('/test/worktree', '/test/workflow', '/test/repo');
            assert.ok(config, 'Should return a config object');
            assert.ok(config!.mcpServers, 'Should have mcpServers property');
            assert.ok(config!.mcpServers['lanes-workflow'], 'Should have lanes-workflow server');
        });

        test('getProjectSettingsPath returns path to opencode.jsonc in worktree', () => {
            const path = agent.getProjectSettingsPath('/test/worktree');
            assert.ok(path.includes('opencode.jsonc'), 'Path should include opencode.jsonc');
            assert.ok(path.includes('/test/worktree'), 'Path should include worktree path');
        });

        test('formatMcpForSettings transforms to OpenCode native format', () => {
            const standardConfig = {
                mcpServers: {
                    'lanes-workflow': {
                        command: 'node',
                        args: ['/path/to/server.js', '--worktree', '/test']
                    }
                }
            };

            const result = agent.formatMcpForSettings(standardConfig);

            assert.deepStrictEqual(result, {
                mcp: {
                    'lanes-workflow': {
                        type: 'local',
                        command: ['node', '/path/to/server.js', '--worktree', '/test']
                    }
                }
            });
        });

        test('formatMcpForSettings handles multiple MCP servers', () => {
            const config = {
                mcpServers: {
                    'server-a': { command: 'node', args: ['a.js'] },
                    'server-b': { command: 'python', args: ['b.py', '--port', '3000'] }
                }
            };

            const result = agent.formatMcpForSettings(config);

            assert.ok(result.mcp, 'Should have mcp key');
            const mcp = result.mcp as Record<string, { type: string; command: string[] }>;
            assert.strictEqual(mcp['server-a'].type, 'local');
            assert.deepStrictEqual(mcp['server-a'].command, ['node', 'a.js']);
            assert.strictEqual(mcp['server-b'].type, 'local');
            assert.deepStrictEqual(mcp['server-b'].command, ['python', 'b.py', '--port', '3000']);
        });

        test('formatMcpForSettings uses mcp key not mcpServers', () => {
            const config = {
                mcpServers: {
                    'test': { command: 'node', args: [] }
                }
            };

            const result = agent.formatMcpForSettings(config);

            assert.ok(result.mcp, 'Should use mcp key');
            assert.strictEqual(result.mcpServers, undefined, 'Should NOT have mcpServers key');
        });
    });

    suite('Prompt In Command Support', () => {
        test('supportsPromptInCommand returns true (prompt via --prompt flag)', () => {
            assert.strictEqual(
                agent.supportsPromptInCommand(),
                true,
                'OpenCode supports prompt in command via --prompt flag'
            );
        });
    });

    suite('Prompt Improvement', () => {
        test('buildPromptImproveCommand returns correct command structure', () => {
            const result = agent.buildPromptImproveCommand('test prompt');
            assert.ok(result, 'Should return a command object');
            assert.strictEqual(result!.command, 'opencode', 'Command should be opencode');
            assert.ok(Array.isArray(result!.args), 'Args should be an array');
            assert.strictEqual(result!.args[0], 'run', 'First arg should be run');
            assert.ok(result!.args[1].includes('test prompt'), 'Args should include the prompt in meta-prompt');
        });
    });
});
