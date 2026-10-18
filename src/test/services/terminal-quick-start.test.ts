import * as assert from 'assert';
import { preflightTmuxAttach } from '../../vscode/services/TerminalService';

suite('TerminalService Quick Start tmux preflight', () => {
    test('validates transient MCP before checking an existing tmux session', async () => {
        const calls: string[] = [];

        const result = await preflightTmuxAttach(
            true,
            async () => {
                calls.push('prepare');
                return { mcpConfigPath: '/private/mcp-config.json' };
            },
            async () => {
                calls.push('sessionExists');
                return true;
            }
        );

        assert.deepStrictEqual(calls, ['prepare', 'sessionExists']);
        assert.strictEqual(result.tmuxSessionExists, true);
        assert.deepStrictEqual(result.preflightLaunch, { mcpConfigPath: '/private/mcp-config.json' });
    });

    test('does not attach when required MCP preflight fails', async () => {
        let checkedForSession = false;

        await assert.rejects(
            preflightTmuxAttach(
                true,
                async () => { throw new Error('MCP unavailable'); },
                async () => {
                    checkedForSession = true;
                    return true;
                }
            ),
            /MCP unavailable/
        );

        assert.strictEqual(checkedForSession, false);
    });
});
