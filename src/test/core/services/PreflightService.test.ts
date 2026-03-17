import * as assert from 'assert';
import sinon from 'sinon';
import { getAgent } from '../../../core/codeAgents';
import {
    assertLanesPrerequisites,
    assertSessionLaunchPrerequisites,
    formatMissingPrerequisites,
    getMissingLanesPrerequisites,
    getMissingSessionPrerequisites,
    preflightDeps,
} from '../../../core/services/PreflightService';

suite('PreflightService', () => {
    let isCommandAvailableStub: sinon.SinonStub;

    setup(() => {
        isCommandAvailableStub = sinon.stub(preflightDeps, 'isCommandAvailable').resolves(true);
    });

    teardown(() => {
        isCommandAvailableStub.restore();
    });

    test('returns no missing prerequisites when jq, agent CLI, and tmux are installed', async () => {
        const missing = await getMissingSessionPrerequisites({
            codeAgent: getAgent('claude')!,
            terminalMode: 'tmux',
        });

        assert.deepStrictEqual(missing, []);
        sinon.assert.calledWith(isCommandAvailableStub, 'jq');
        sinon.assert.calledWith(isCommandAvailableStub, 'claude');
        sinon.assert.calledWith(isCommandAvailableStub, 'tmux');
    });

    test('skips tmux checks when terminal mode is not tmux', async () => {
        await getMissingSessionPrerequisites({
            codeAgent: getAgent('codex')!,
            terminalMode: 'vscode',
        });

        sinon.assert.neverCalledWith(isCommandAvailableStub, 'tmux');
    });

    test('reports jq, agent CLI, and tmux when they are missing', async () => {
        isCommandAvailableStub.callsFake(async (command: string) => command === 'claude');

        const missing = await getMissingSessionPrerequisites({
            codeAgent: getAgent('codex')!,
            terminalMode: 'tmux',
        });

        assert.deepStrictEqual(
            missing.map((item) => item.command),
            ['jq', 'codex', 'tmux']
        );
    });

    test('assertSessionLaunchPrerequisites throws a combined user-facing error', async () => {
        isCommandAvailableStub.callsFake(async (command: string) => command === 'claude');

        await assert.rejects(
            assertSessionLaunchPrerequisites({
                codeAgent: getAgent('codex')!,
                terminalMode: 'tmux',
            }),
            /Missing prerequisites: jq is required.*Codex CLI.*tmux is required/
        );
    });

    test('formatMissingPrerequisites adds install guidance for a single issue', () => {
        const message = formatMissingPrerequisites([
            {
                command: 'jq',
                message: 'jq is required for session tracking and workflow hooks.',
            },
        ]);

        assert.strictEqual(
            message,
            'jq is required for session tracking and workflow hooks. Install it and try again.'
        );
    });

    test('returns no missing prerequisites when jq is installed for lanes startup', async () => {
        const missing = await getMissingLanesPrerequisites();

        assert.deepStrictEqual(missing, []);
        sinon.assert.calledWith(isCommandAvailableStub, 'jq');
    });

    test('assertLanesPrerequisites throws a user-facing error when jq is missing', async () => {
        isCommandAvailableStub.resolves(false);

        await assert.rejects(
            assertLanesPrerequisites(),
            /jq is required for Lanes/
        );
    });
});
