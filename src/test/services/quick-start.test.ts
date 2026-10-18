import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getAgent } from '../../core/codeAgents';
import * as TmuxService from '../../core/services/TmuxService';
import { getQuickSession } from '../../core/session/QuickSessionService';
import {
    executeQuickStart,
    getQuickStartMcpUnsupportedReason,
    getQuickStartTaskName,
    isQuickStartGitRepository,
    QuickStartLaunchRequest,
} from '../../vscode/services/QuickStartService';

suite('QuickStartService', () => {
    test('builds unique terminal and tmux identities for every launch, including the same repo and agent', () => {
        const firstRepo = path.join(path.sep, 'users', 'one', 'project');
        const secondRepo = path.join(path.sep, 'users', 'two', 'project');

        const firstName = getQuickStartTaskName(firstRepo, 'claude');
        const repeatedName = getQuickStartTaskName(firstRepo, 'claude');
        const secondName = getQuickStartTaskName(secondRepo, 'claude');
        const differentAgentName = getQuickStartTaskName(firstRepo, 'codex');

        assert.notStrictEqual(firstName, repeatedName);
        assert.notStrictEqual(
            TmuxService.sanitizeTmuxSessionName(firstName),
            TmuxService.sanitizeTmuxSessionName(repeatedName)
        );
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

    test('creates independent sessions on repeated and concurrent invocations without changing existing history', async () => {
        const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-quick-start-multiple-'));
        const launches: QuickStartLaunchRequest[] = [];
        const errors: string[] = [];
        const options = {
            repoRoot,
            getConfiguredAgentName: () => 'claude',
            openTerminal: async (request: QuickStartLaunchRequest) => { launches.push(request); },
            showError: (message: string) => { errors.push(message); },
            showWarning: () => {},
            gitRepositoryCheck: async () => true,
            cliAvailabilityCheck: async () => true,
        };

        try {
            await executeQuickStart(options);
            const firstPath = path.join(launches[0].sessionPath, 'session.json');
            const first = await getQuickSession(launches[0].sessionPath);
            fs.writeFileSync(firstPath, JSON.stringify({ ...first, alias: 'Existing conversation', sessionId: 'original-session' }));
            const firstHistory = fs.readFileSync(firstPath, 'utf8');
            await executeQuickStart(options);
            await Promise.all(Array.from({ length: 4 }, () => executeQuickStart(options)));

            assert.deepStrictEqual(errors, []);
            assert.strictEqual(launches.length, 6);
            assert.strictEqual(new Set(launches.map(launch => launch.sessionPath)).size, launches.length);
            assert.strictEqual(new Set(launches.map(launch => launch.codeAgent.getTerminalName(launch.taskName))).size, launches.length);
            assert.strictEqual(new Set(launches.map(launch => TmuxService.sanitizeTmuxSessionName(launch.taskName))).size, launches.length);
            assert.strictEqual(fs.readFileSync(firstPath, 'utf8'), firstHistory);
            const sessions = await Promise.all(launches.map(launch => getQuickSession(launch.sessionPath)));
            assert.strictEqual(new Set(sessions.map(session => session?.alias)).size, launches.length);
            for (const session of sessions.slice(1)) {
                assert.strictEqual(session?.agentName, 'claude');
                assert.strictEqual(session?.workingDirectory, repoRoot);
                assert.strictEqual(session?.sessionId, undefined);
            }
        } finally {
            fs.rmSync(repoRoot, { recursive: true, force: true });
        }
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

    test('resolves the configured agent on every invocation and passes persistent session identities', async () => {
        let configuredAgent = 'claude';
        const launches: QuickStartLaunchRequest[] = [];
        const errors: string[] = [];
        const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-quick-start-'));
        const options = {
            repoRoot,
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
        assert.strictEqual(launches[0].repoRoot, repoRoot);
        assert.strictEqual(launches[0].sessionPath, path.join(repoRoot, '.lanes', 'current-sessions', launches[0].taskName));
        fs.rmSync(repoRoot, { recursive: true, force: true });
        assert.match(launches[0].taskName, /quick-start-claude-/);
        assert.match(launches[1].taskName, /quick-start-codex-/);
        assert.deepStrictEqual(errors, []);
    });
});
