import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as gitService from '../../core/gitService';
import * as launchSetupService from '../../core/services/AgentLaunchSetupService';
import { ConfigStore } from '../../jetbrains-ide-bridge/config';
import { NotificationEmitter } from '../../jetbrains-ide-bridge/notifications';
import { handleRequest, initializeHandlers } from '../../jetbrains-ide-bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext } from '../../core/session/SessionDataService';

suite('Bridge Handlers - Session Pin', () => {
    let tempDir: string;
    let config: ConfigStore;
    let execGitStub: sinon.SinonStub;
    let prepareLaunchContextStub: sinon.SinonStub;
    let buildLaunchCommandStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-session-pin-'));
        config = new ConfigStore(tempDir);
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
    });

    teardown(() => {
        execGitStub.restore();
        prepareLaunchContextStub.restore();
        buildLaunchCommandStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('pinning a session adds it to the config store', async () => {
        const result = await handleRequest('session.pin', { sessionName: 'feat-pin-me' }) as { success: boolean };

        assert.strictEqual(result.success, true);
        const pinned = config.get('lanes.pinnedSessions') as string[];
        assert.ok(Array.isArray(pinned), 'lanes.pinnedSessions should be an array');
        assert.ok(pinned.includes('feat-pin-me'), 'Session name should be in pinnedSessions');
    });

    test('pinning an already-pinned session does not create duplicates', async () => {
        await handleRequest('session.pin', { sessionName: 'feat-no-dup' });
        await handleRequest('session.pin', { sessionName: 'feat-no-dup' });

        const pinned = config.get('lanes.pinnedSessions') as string[];
        const occurrences = pinned.filter(n => n === 'feat-no-dup').length;
        assert.strictEqual(occurrences, 1, 'Session should appear exactly once in pinnedSessions');
    });

    test('unpinning a session removes it from the config store', async () => {
        await handleRequest('session.pin', { sessionName: 'feat-unpin-me' });

        let pinned = config.get('lanes.pinnedSessions') as string[];
        assert.ok(pinned.includes('feat-unpin-me'), 'Precondition: session should be pinned first');

        const result = await handleRequest('session.unpin', { sessionName: 'feat-unpin-me' }) as { success: boolean };

        assert.strictEqual(result.success, true);
        pinned = config.get('lanes.pinnedSessions') as string[];
        assert.ok(!pinned.includes('feat-unpin-me'), 'Session should no longer be in pinnedSessions');
    });

    test('unpinning a session that is not pinned succeeds without error', async () => {
        // Ensure it is not pinned to begin with
        const pinned = config.get('lanes.pinnedSessions') as string[] | undefined;
        assert.ok(!pinned || !pinned.includes('feat-was-never-pinned'), 'Precondition: session must not be pinned');

        const result = await handleRequest('session.unpin', { sessionName: 'feat-was-never-pinned' }) as { success: boolean };

        assert.strictEqual(result.success, true);
    });

    test('pin state is reflected in session.list results via isPinned field', async () => {
        // Create a worktree directory so session.list can discover it
        const worktreesDir = path.join(tempDir, '.worktrees');
        const sessionWorktree = path.join(worktreesDir, 'feat-listed');
        fs.mkdirSync(sessionWorktree, { recursive: true });

        // Pin the session via bridge handler
        await handleRequest('session.pin', { sessionName: 'feat-listed' });

        const result = await handleRequest('session.list', {}) as { sessions: Array<{ name: string; isPinned: boolean }> };

        const entry = result.sessions.find(s => s.name === 'feat-listed');
        assert.ok(entry, 'Session should appear in session.list');
        assert.strictEqual(entry!.isPinned, true, 'isPinned should be true for pinned session');
    });
});
