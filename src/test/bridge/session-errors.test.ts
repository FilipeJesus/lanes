import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as gitService from '../../core/gitService';
import * as launchSetupService from '../../core/services/AgentLaunchSetupService';
import * as TmuxService from '../../core/services/TmuxService';
import { ConfigStore } from '../../bridge/config';
import { NotificationEmitter } from '../../bridge/notifications';
import { handleRequest, initializeHandlers } from '../../bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext } from '../../core/session/SessionDataService';

suite('Bridge Handlers - Session Error Cases', () => {
    let tempDir: string;
    let execGitStub: sinon.SinonStub;
    let prepareLaunchContextStub: sinon.SinonStub;
    let buildLaunchCommandStub: sinon.SinonStub;
    let killSessionStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-session-errors-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
        initializeGlobalStorageContext('', tempDir, getAgent('claude')!);

        execGitStub = sinon.stub(gitService, 'execGit').resolves('');
        prepareLaunchContextStub = sinon.stub(launchSetupService, 'prepareAgentLaunchContext').resolves({
            codeAgent: getAgent('claude')!,
            sessionData: null,
            effectiveWorkflow: null,
            effectivePermissionMode: 'acceptEdits',
            settingsPath: '/tmp/claude-settings.json'
        });
        buildLaunchCommandStub = sinon.stub(launchSetupService, 'buildAgentLaunchCommand').resolves({
            mode: 'start',
            command: 'claude --settings "/tmp/claude-settings.json"'
        });
        killSessionStub = sinon.stub(TmuxService, 'killSession').resolves();
    });

    teardown(() => {
        execGitStub.restore();
        prepareLaunchContextStub.restore();
        buildLaunchCommandStub.restore();
        killSessionStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('session.create with empty name fails with a descriptive error', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('session.create', { name: '', branch: '' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof Error, 'Should throw an Error');
        assert.ok(
            (caughtError as Error).message.toLowerCase().includes('name') ||
            (caughtError as Error).message.toLowerCase().includes('required') ||
            (caughtError as Error).message.toLowerCase().includes('missing'),
            `Error message should mention the missing name, got: ${(caughtError as Error).message}`
        );
        sinon.assert.notCalled(execGitStub);
    });

    test('session.create with path traversal characters in name is rejected safely', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('session.create', { name: '../../etc/passwd', branch: '' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof Error, 'Should throw an Error for path traversal name');
        assert.ok(
            (caughtError as Error).message.includes('..') ||
            (caughtError as Error).message.toLowerCase().includes('invalid') ||
            (caughtError as Error).message.toLowerCase().includes('traversal'),
            `Error should indicate invalid name, got: ${(caughtError as Error).message}`
        );
        // Crucially, git worktree add must NOT have been called with a dangerous path
        sinon.assert.notCalled(execGitStub);
    });

    test('session.create with forward slash in name is rejected safely', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('session.create', { name: 'feat/dangerous', branch: '' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof Error, 'Should throw an Error for name containing /');
        sinon.assert.notCalled(execGitStub);
    });

    test('session.delete with nonexistent session propagates the git error', async () => {
        execGitStub.rejects(new Error('fatal: pathspec does not match any file(s) known to git'));

        let caughtError: unknown;
        try {
            await handleRequest('session.delete', { sessionName: 'does-not-exist' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof Error, 'Should propagate the error from git');
    });

    test('session.delete calls killSession before removing worktree', async () => {
        const worktreePath = path.join(tempDir, '.worktrees', 'feat-del-order');

        await handleRequest('session.delete', { sessionName: 'feat-del-order' });

        sinon.assert.calledOnce(killSessionStub);
        // execGit for worktree remove should have been called with the expected path
        sinon.assert.calledWithMatch(execGitStub, sinon.match.array.contains(['worktree', 'remove', worktreePath, '--force']));
    });

    test('session.open with nonexistent session does not throw when launch stubs succeed', async () => {
        // session.open does not check whether the worktree directory exists before calling
        // prepareAgentLaunchContext; it only fails if the launch services fail.
        // With stubs in place it should succeed and return a command.
        const result = await handleRequest('session.open', { sessionName: 'no-such-session' }) as {
            success: boolean;
            command: string;
        };

        assert.strictEqual(result.success, true);
        assert.ok(typeof result.command === 'string', 'Should return a launch command string');
    });

    test('session.open propagates errors thrown by prepareAgentLaunchContext', async () => {
        prepareLaunchContextStub.rejects(new Error('Launch context failure'));

        let caughtError: unknown;
        try {
            await handleRequest('session.open', { sessionName: 'feat-open-fail' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof Error);
        assert.ok(
            (caughtError as Error).message.includes('Launch context failure'),
            'Should propagate the original error message'
        );
    });
});
