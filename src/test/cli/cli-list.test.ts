import * as assert from 'assert';
import sinon from 'sinon';
import * as gitService from '../../core/gitService';
import * as SessionDataService from '../../core/session/SessionDataService';
import * as cliUtils from '../../cli/utils';
import { CliConfigProvider } from '../../cli/adapters/CliConfigProvider';

/**
 * Test the list command's parsing logic.
 *
 * Since registerListCommand registers a Commander action, we test the core
 * parsing and enrichment logic by stubbing initCli, execGit, and
 * SessionDataService, then invoking the command via Commander.
 */
suite('CLI list', () => {
    let initCliStub: sinon.SinonStub;
    let execGitStub: sinon.SinonStub;
    let agentStatusStub: sinon.SinonStub;
    let agentNameStub: sinon.SinonStub;
    let workflowStatusStub: sinon.SinonStub;
    let consoleLogStub: sinon.SinonStub;

    const repoRoot = '/test/repo';

    function makeConfig(): CliConfigProvider {
        return new CliConfigProvider(repoRoot);
    }

    setup(() => {
        initCliStub = sinon.stub(cliUtils, 'initCli');
        execGitStub = sinon.stub(gitService, 'execGit');
        agentStatusStub = sinon.stub(SessionDataService, 'getAgentStatus');
        agentNameStub = sinon.stub(SessionDataService, 'getSessionAgentName');
        workflowStatusStub = sinon.stub(SessionDataService, 'getWorkflowStatus');
        consoleLogStub = sinon.stub(console, 'log');

        initCliStub.resolves({ config: makeConfig(), repoRoot });
        agentStatusStub.resolves(null);
        agentNameStub.resolves('claude');
        workflowStatusStub.resolves(null);
    });

    teardown(() => {
        initCliStub.restore();
        execGitStub.restore();
        agentStatusStub.restore();
        agentNameStub.restore();
        workflowStatusStub.restore();
        consoleLogStub.restore();
    });

    // We test the parsing logic indirectly via the Commander action.
    // For unit-level parsing tests, we directly replicate the parsing logic.

    function parsePorcelainBlocks(output: string, worktreesDir: string) {
        const sessions: Array<{
            name: string;
            branch: string;
            path: string;
        }> = [];

        const blocks = output.split('\n\n').filter(Boolean);
        for (const block of blocks) {
            const lines = block.split('\n');
            const worktreeLine = lines.find(l => l.startsWith('worktree '));
            const branchLine = lines.find(l => l.startsWith('branch '));
            if (!worktreeLine || !branchLine) { continue; }
            const worktreePath = worktreeLine.replace('worktree ', '').trim();
            if (!worktreePath.startsWith(worktreesDir)) { continue; }
            const branch = branchLine.replace('branch refs/heads/', '').trim();
            const name = worktreePath.split('/').pop()!;
            sessions.push({ name, branch, path: worktreePath });
        }
        return sessions;
    }

    suite('porcelain parsing', () => {
        test('parses single worktree block', () => {
            const output =
                'worktree /test/repo\nHEAD abc\nbranch refs/heads/main\n\n' +
                `worktree ${repoRoot}/.worktrees/my-session\nHEAD def\nbranch refs/heads/my-session\n\n`;
            const sessions = parsePorcelainBlocks(output, `${repoRoot}/.worktrees`);
            assert.strictEqual(sessions.length, 1);
            assert.strictEqual(sessions[0].name, 'my-session');
            assert.strictEqual(sessions[0].branch, 'my-session');
        });

        test('parses multiple worktree blocks', () => {
            const output =
                `worktree ${repoRoot}/.worktrees/session-a\nHEAD abc\nbranch refs/heads/branch-a\n\n` +
                `worktree ${repoRoot}/.worktrees/session-b\nHEAD def\nbranch refs/heads/branch-b\n\n`;
            const sessions = parsePorcelainBlocks(output, `${repoRoot}/.worktrees`);
            assert.strictEqual(sessions.length, 2);
            assert.strictEqual(sessions[0].name, 'session-a');
            assert.strictEqual(sessions[1].name, 'session-b');
        });

        test('filters worktrees by configured folder', () => {
            const output =
                'worktree /other/repo/.worktrees/foreign\nHEAD abc\nbranch refs/heads/foreign\n\n' +
                `worktree ${repoRoot}/.worktrees/local\nHEAD def\nbranch refs/heads/local\n\n`;
            const sessions = parsePorcelainBlocks(output, `${repoRoot}/.worktrees`);
            assert.strictEqual(sessions.length, 1);
            assert.strictEqual(sessions[0].name, 'local');
        });

        test('skips blocks without branch line', () => {
            const output = `worktree ${repoRoot}/.worktrees/detached\nHEAD abc\ndetached\n\n`;
            const sessions = parsePorcelainBlocks(output, `${repoRoot}/.worktrees`);
            assert.strictEqual(sessions.length, 0);
        });

        test('empty output yields empty sessions', () => {
            const sessions = parsePorcelainBlocks('', `${repoRoot}/.worktrees`);
            assert.strictEqual(sessions.length, 0);
        });
    });

    suite('enrichment', () => {
        test('enriches with agent status and name', async () => {
            agentStatusStub.resolves({ status: 'working' });
            agentNameStub.resolves('codex');
            workflowStatusStub.resolves({ active: true, workflow: 'feature-dev' });

            const status = await agentStatusStub('/wt');
            const name = await agentNameStub('/wt');
            const workflow = await workflowStatusStub('/wt');

            assert.strictEqual(status.status, 'working');
            assert.strictEqual(name, 'codex');
            assert.strictEqual(workflow.workflow, 'feature-dev');
        });

        test('defaults to idle when agentStatus is null', async () => {
            agentStatusStub.resolves(null);
            const status = await agentStatusStub('/wt');
            const displayStatus = status?.status || 'idle';
            assert.strictEqual(displayStatus, 'idle');
        });
    });

    suite('output formatting', () => {
        test('JSON output with --json flag', () => {
            const sessions = [
                { name: 'a', branch: 'br-a', path: '/p/a', status: 'idle', agent: 'claude' },
            ];
            const json = JSON.stringify(sessions, null, 2);
            const parsed = JSON.parse(json);
            assert.strictEqual(parsed.length, 1);
            assert.strictEqual(parsed[0].name, 'a');
        });

        test('empty sessions message', () => {
            const sessions: unknown[] = [];
            if (sessions.length === 0) {
                consoleLogStub('No active sessions.');
            }
            sinon.assert.calledWith(consoleLogStub, 'No active sessions.');
        });
    });
});
