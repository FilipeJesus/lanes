import * as assert from 'assert';
import * as path from 'path';
import { getAgent } from '../../core/codeAgents';
import * as TmuxService from '../../core/services/TmuxService';
import {
    executeQuickStart,
    getQuickStartMcpUnsupportedReason,
    getQuickStartTaskName,
    isQuickStartGitRepository,
    QuickStartLaunchRequest,
} from '../../vscode/services/QuickStartService';

suite('QuickStartService', () => {
    test('builds stable repo-specific terminal and tmux identities', () => {
        const firstRepo = path.join(path.sep, 'users', 'one', 'project');
        const secondRepo = path.join(path.sep, 'users', 'two', 'project');

        const firstName = getQuickStartTaskName(firstRepo, 'claude');
        const repeatedName = getQuickStartTaskName(firstRepo, 'claude');
        const secondName = getQuickStartTaskName(secondRepo, 'claude');
        const differentAgentName = getQuickStartTaskName(firstRepo, 'codex');

        assert.strictEqual(firstName, repeatedName);
        assert.notStrictEqual(firstName, secondName);
        assert.notStrictEqual(firstName, differentAgentName);
        assert.notStrictEqual(
            TmuxService.sanitizeTmuxSessionName(firstName),
            TmuxService.sanitizeTmuxSessionName(secondName)
        );
        assert.notStrictEqual(
            TmuxService.sanitizeTmuxSessionName(firstName),
            TmuxService.sanitizeTmuxSessionName(differentAgentName)
        );
    });

    test('accepts an actual Git working tree', async () => {
        const calls: Array<{ args: string[]; cwd: string }> = [];
        const result = await isQuickStartGitRepository('/repo', async (args, cwd) => {
            calls.push({ args, cwd });
            return 'true\n';
        });

        assert.strictEqual(result, true);
        assert.deepStrictEqual(calls, [{
            args: ['rev-parse', '--is-inside-work-tree'],
            cwd: '/repo',
        }]);
    });

    test('rejects a folder that is not a Git working tree', async () => {
        const result = await isQuickStartGitRepository('/not-a-repo', async () => {
            throw new Error('fatal: not a git repository');
        });

        assert.strictEqual(result, false);
    });

    test('allows agents with transient MCP delivery', () => {
        assert.strictEqual(getQuickStartMcpUnsupportedReason(getAgent('claude')!), null);
        assert.strictEqual(getQuickStartMcpUnsupportedReason(getAgent('codex')!), null);
    });

    test('rejects agents without MCP support', () => {
        assert.match(
            getQuickStartMcpUnsupportedReason(getAgent('cortex')!)!,
            /does not support MCP/
        );
    });

    test('rejects settings-based MCP delivery', () => {
        assert.match(
            getQuickStartMcpUnsupportedReason(getAgent('gemini')!)!,
            /project-settings MCP delivery/
        );
    });

    test('resolves the configured agent on every invocation and passes transient launch arguments', async () => {
        let configuredAgent = 'claude';
        const launches: QuickStartLaunchRequest[] = [];
        const errors: string[] = [];
        const options = {
            repoRoot: '/repo',
            extensionPath: '/extension',
            getConfiguredAgentName: () => configuredAgent,
            openTerminal: async (request: QuickStartLaunchRequest) => { launches.push(request); },
            showError: (message: string) => { errors.push(message); },
            showWarning: () => {},
            gitRepositoryCheck: async () => true,
            cliAvailabilityCheck: async () => true,
        };

        await executeQuickStart(options);
        configuredAgent = 'codex';
        await executeQuickStart(options);

        assert.deepStrictEqual(launches.map(({ codeAgent }) => codeAgent.name), ['claude', 'codex']);
        assert.strictEqual(launches[0].repoRoot, '/repo');
        assert.strictEqual(launches[0].mcpWorkflowPath, path.join('/extension', 'workflows', 'default.yaml'));
        assert.match(launches[0].taskName, /Quick Start-claude-/);
        assert.match(launches[1].taskName, /Quick Start-codex-/);
        assert.deepStrictEqual(errors, []);
    });
});
