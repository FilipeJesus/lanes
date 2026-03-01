import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as gitService from '../../core/gitService';
import * as launchSetupService from '../../core/services/AgentLaunchSetupService';
import { ConfigStore } from '../../bridge/config';
import { NotificationEmitter } from '../../bridge/notifications';
import { handleRequest, initializeHandlers } from '../../bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext } from '../../core/session/SessionDataService';

suite('Bridge session.create branch behavior', () => {
    let tempDir: string;
    let execGitStub: sinon.SinonStub;
    let prepareLaunchContextStub: sinon.SinonStub;
    let buildLaunchCommandStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-session-create-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
        // Override global storage to use tempDir so getPromptsPath uses legacy .lanes/ path
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
    });

    teardown(() => {
        execGitStub.restore();
        prepareLaunchContextStub.restore();
        buildLaunchCommandStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('creates a new session branch from selected source branch', async () => {
        await handleRequest('session.create', {
            name: 'feat-auth',
            branch: 'main'
        });

        const worktreePath = path.join(tempDir, '.worktrees', 'feat-auth');
        sinon.assert.calledWithExactly(
            execGitStub,
            ['worktree', 'add', '-b', 'feat-auth', worktreePath, 'main'],
            tempDir
        );
    });

    test('creates a new session branch from HEAD when source branch is omitted', async () => {
        await handleRequest('session.create', {
            name: 'feat-empty',
            branch: ''
        });

        const worktreePath = path.join(tempDir, '.worktrees', 'feat-empty');
        sinon.assert.calledWithExactly(
            execGitStub,
            ['worktree', 'add', '-b', 'feat-empty', worktreePath],
            tempDir
        );
    });

    test('reuses existing branch when source branch matches session name', async () => {
        await handleRequest('session.create', {
            name: 'feat-existing',
            branch: 'feat-existing'
        });

        const worktreePath = path.join(tempDir, '.worktrees', 'feat-existing');
        sinon.assert.calledWithExactly(
            execGitStub,
            ['worktree', 'add', worktreePath, 'feat-existing'],
            tempDir
        );
    });

    test('returns launch command from shared setup service on session.create', async () => {
        const result = await handleRequest('session.create', {
            name: 'feat-command',
            branch: ''
        }) as { command?: string };

        assert.strictEqual(result.command, 'claude --settings "/tmp/claude-settings.json"');
        sinon.assert.calledOnce(prepareLaunchContextStub);
        sinon.assert.calledOnce(buildLaunchCommandStub);
    });

    test('passes prompt file command substitution to shared launch command builder on create', async () => {
        await handleRequest('session.create', {
            name: 'feat-prompt',
            branch: '',
            prompt: 'Please fix flaky tests.'
        });

        const promptPath = path.join(tempDir, '.lanes', 'feat-prompt.txt');
        assert.strictEqual(fs.readFileSync(promptPath, 'utf-8'), 'Please fix flaky tests.');

        sinon.assert.calledWithMatch(
            buildLaunchCommandStub,
            sinon.match.any,
            sinon.match({
                preferResume: false,
                prompt: sinon.match((value: unknown) =>
                    typeof value === 'string'
                    && value.includes('$(cat ')
                    && value.includes('feat-prompt.txt')
                )
            })
        );
    });

    test('returns launch command from shared setup service on session.open', async () => {
        const result = await handleRequest('session.open', {
            sessionName: 'feat-open'
        }) as { command?: string };

        assert.strictEqual(result.command, 'claude --settings "/tmp/claude-settings.json"');
        sinon.assert.called(prepareLaunchContextStub);
        sinon.assert.called(buildLaunchCommandStub);
    });
});
