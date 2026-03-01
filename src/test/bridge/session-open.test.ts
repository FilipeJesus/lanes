import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as launchSetupService from '../../core/services/AgentLaunchSetupService';
import { ConfigStore } from '../../bridge/config';
import { NotificationEmitter } from '../../bridge/notifications';
import { handleRequest, initializeHandlers } from '../../bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext } from '../../core/session/SessionDataService';

suite('Bridge session.open', () => {
    let tempDir: string;
    let prepareLaunchContextStub: sinon.SinonStub;
    let buildLaunchCommandStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-session-open-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
        initializeGlobalStorageContext('', tempDir, getAgent('claude')!);

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
        prepareLaunchContextStub.restore();
        buildLaunchCommandStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('opens an existing session and returns the launch command', async () => {
        const result = await handleRequest('session.open', {
            sessionName: 'feat-open'
        }) as { success: boolean; worktreePath: string; command: string };

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.command, 'claude --settings "/tmp/claude-settings.json"');
        sinon.assert.calledOnce(prepareLaunchContextStub);
        sinon.assert.calledOnce(buildLaunchCommandStub);
    });

    test('resolves the correct worktree path from the session name', async () => {
        const result = await handleRequest('session.open', {
            sessionName: 'feat-path-check'
        }) as { worktreePath: string };

        const expectedWorktreePath = path.join(tempDir, '.worktrees', 'feat-path-check');
        assert.strictEqual(result.worktreePath, expectedWorktreePath);

        sinon.assert.calledWithMatch(
            prepareLaunchContextStub,
            sinon.match({ worktreePath: expectedWorktreePath })
        );
    });

    test('invokes prepareAgentLaunchContext with no workflow and no permissionMode', async () => {
        await handleRequest('session.open', { sessionName: 'feat-open-defaults' });

        sinon.assert.calledWithMatch(
            prepareLaunchContextStub,
            sinon.match({
                workflow: null,
                permissionMode: undefined
            })
        );
    });

    test('returns a vscode command when tmux is not the terminal mode', async () => {
        // Default terminal mode is vscode, so the command comes straight from buildAgentLaunchCommand
        const result = await handleRequest('session.open', {
            sessionName: 'feat-vscode-mode'
        }) as { command: string };

        assert.strictEqual(result.command, 'claude --settings "/tmp/claude-settings.json"');
    });
});
