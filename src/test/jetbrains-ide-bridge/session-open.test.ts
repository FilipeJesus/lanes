import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as launchSetupService from '../../core/services/AgentLaunchSetupService';
import * as PreflightService from '../../core/services/PreflightService';
import * as tmuxService from '../../core/services/TmuxService';
import { ConfigStore } from '../../jetbrains-ide-bridge/config';
import { NotificationEmitter } from '../../jetbrains-ide-bridge/notifications';
import { handleRequest, initializeHandlers } from '../../jetbrains-ide-bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext, saveSessionTerminalMode } from '../../core/session/SessionDataService';

suite('Bridge session.open', () => {
    let tempDir: string;
    let prepareLaunchContextStub: sinon.SinonStub;
    let buildLaunchCommandStub: sinon.SinonStub;
    let preflightStub: sinon.SinonStub;
    let isTmuxInstalledStub: sinon.SinonStub;
    let launchInTmuxStub: sinon.SinonStub;

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
        preflightStub = sinon.stub(PreflightService, 'assertSessionLaunchPrerequisites').resolves();
        isTmuxInstalledStub = sinon.stub(tmuxService, 'isTmuxInstalled').resolves(false);
        launchInTmuxStub = sinon.stub(tmuxService, 'launchInTmux').resolves({
            tmuxSessionName: 'feat-open',
            attachCommand: 'tmux attach-session -t "feat-open"',
            wasExisting: false
        });
    });

    teardown(() => {
        prepareLaunchContextStub.restore();
        buildLaunchCommandStub.restore();
        preflightStub.restore();
        isTmuxInstalledStub.restore();
        launchInTmuxStub.restore();
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

    test('returns tmux attach metadata when tmux mode is enabled', async () => {
        const config = new ConfigStore(tempDir);
        await config.initialize();
        await config.set('lanes.terminalMode', 'tmux');
        initializeHandlers(tempDir, config, new NotificationEmitter());
        isTmuxInstalledStub.resolves(true);

        const result = await handleRequest('session.open', {
            sessionName: 'feat-tmux-open'
        }) as {
            command: string;
            terminalMode?: string;
            attachCommand?: string;
            tmuxSessionName?: string;
        };

        assert.strictEqual(result.command, 'tmux attach-session -t "feat-open"');
        assert.strictEqual(result.terminalMode, 'tmux');
        assert.strictEqual(result.attachCommand, 'tmux attach-session -t "feat-open"');
        assert.strictEqual(result.tmuxSessionName, 'feat-open');
        sinon.assert.calledOnce(launchInTmuxStub);
    });

    test('prefers the persisted session terminal mode over the current config on reopen', async () => {
        const config = new ConfigStore(tempDir);
        await config.initialize();
        await config.set('lanes.terminalMode', 'vscode');
        initializeHandlers(tempDir, config, new NotificationEmitter());
        isTmuxInstalledStub.resolves(true);

        const worktreePath = path.join(tempDir, '.worktrees', 'feat-persisted-tmux');
        await saveSessionTerminalMode(worktreePath, 'tmux');

        const result = await handleRequest('session.open', {
            sessionName: 'feat-persisted-tmux'
        }) as {
            command: string;
            terminalMode?: string;
            attachCommand?: string;
        };

        assert.strictEqual(result.command, 'tmux attach-session -t "feat-open"');
        assert.strictEqual(result.terminalMode, 'tmux');
        assert.strictEqual(result.attachCommand, 'tmux attach-session -t "feat-open"');
        sinon.assert.calledOnce(launchInTmuxStub);
    });

    test('preserves a persisted vscode terminal mode even when config changes to tmux', async () => {
        const config = new ConfigStore(tempDir);
        await config.initialize();
        await config.set('lanes.terminalMode', 'tmux');
        initializeHandlers(tempDir, config, new NotificationEmitter());
        isTmuxInstalledStub.resolves(true);

        const worktreePath = path.join(tempDir, '.worktrees', 'feat-persisted-vscode');
        await saveSessionTerminalMode(worktreePath, 'vscode');

        const result = await handleRequest('session.open', {
            sessionName: 'feat-persisted-vscode'
        }) as {
            command: string;
            terminalMode?: string;
            attachCommand?: string;
        };

        assert.strictEqual(result.command, 'claude --settings "/tmp/claude-settings.json"');
        assert.strictEqual(result.terminalMode, 'vscode');
        assert.strictEqual(result.attachCommand, undefined);
        sinon.assert.notCalled(launchInTmuxStub);
    });

    test('fails before launch preparation when preflight detects missing prerequisites', async () => {
        preflightStub.rejects(new Error('tmux is required when lanes.terminalMode is set to tmux.'));

        await assert.rejects(
            handleRequest('session.open', {
                sessionName: 'feat-missing-tmux'
            }),
            /tmux is required/
        );

        sinon.assert.notCalled(prepareLaunchContextStub);
        sinon.assert.notCalled(buildLaunchCommandStub);
    });
});
