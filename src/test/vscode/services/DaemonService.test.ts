/**
 * Tests for DaemonService — VS Code daemon lifecycle manager.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import { DaemonService } from '../../../vscode/services/DaemonService';
import * as lifecycle from '../../../daemon/lifecycle';
import * as clientModule from '../../../daemon/client';
import type { SseCallbacks, SseSubscription } from '../../../daemon/client';

function writeFakeDaemonFiles(homeDir: string, pid: number, port: number): void {
    const lanesDir = path.join(homeDir, '.lanes');
    fs.mkdirSync(lanesDir, { recursive: true });
    fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(pid), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.port'), String(port), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.token'), 'test-token-123', 'utf-8');
}

function createExtensionPath(): string {
    const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-service-ext-'));
    fs.mkdirSync(path.join(extensionPath, 'out'), { recursive: true });
    fs.writeFileSync(path.join(extensionPath, 'out', 'daemon.js'), '', 'utf-8');
    return extensionPath;
}

suite('DaemonService', () => {
    let tempDir: string;
    let originalHome: string | undefined;
    let onRefreshStub: sinon.SinonSpy;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-service-test-'));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
        onRefreshStub = sinon.spy();
    });

    teardown(() => {
        sinon.restore();
        if (originalHome !== undefined) {
            process.env.HOME = originalHome;
        } else {
            delete process.env.HOME;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given daemon is already running, when initialize() is called, then startDaemon reuses it', async () => {
        writeFakeDaemonFiles(tempDir, process.pid, 4299);
        const startDaemonStub = sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4299,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });

        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().returns({ close: () => {} }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();

        assert.ok(startDaemonStub.calledOnce, 'startDaemon should be called to reuse the existing daemon');
        assert.ok(service.isEnabled(), 'service should be enabled after successful init');

        service.dispose();
    });

    test('Given daemon is not running, when initialize() is called, then startDaemon is invoked with correct options', async () => {
        const startDaemonStub = sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: 1234,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: false,
        });

        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().returns({ close: () => {} }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const extensionPath = createExtensionPath();
        const service = new DaemonService(tempDir, extensionPath, onRefreshStub);
        await service.initialize();

        assert.ok(startDaemonStub.calledOnce, 'startDaemon should be called when daemon is not running');
        const callArgs = startDaemonStub.firstCall.args[0] as lifecycle.StartDaemonOptions;
        assert.strictEqual(callArgs.workspaceRoot, tempDir, 'workspaceRoot should match');
        const expectedServerPath = path.join(extensionPath, 'out', 'daemon.js');
        assert.strictEqual(callArgs.serverPath, expectedServerPath, 'serverPath should point to bundled server');
        assert.ok(service.getClient() !== undefined, 'getClient() should return a client after successful init');

        service.dispose();
    });

    test('Given an active SSE subscription, when sessionCreated event fires, then onRefresh is called', async () => {
        sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });

        let capturedCallbacks: SseCallbacks = {};
        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().callsFake((callbacks: SseCallbacks) => {
                capturedCallbacks = callbacks;
                return { close: () => {} };
            }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();

        capturedCallbacks.onSessionCreated?.({ sessionName: 'test', worktreePath: '/tmp/test' });

        assert.ok(onRefreshStub.calledOnce, 'onRefresh should be called when sessionCreated event fires');

        service.dispose();
    });

    test('Given an active SSE subscription, when sessionDeleted event fires, then onRefresh is called', async () => {
        sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });

        let capturedCallbacks: SseCallbacks = {};
        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().callsFake((callbacks: SseCallbacks) => {
                capturedCallbacks = callbacks;
                return { close: () => {} };
            }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();

        capturedCallbacks.onSessionDeleted?.({ sessionName: 'test' });

        assert.ok(onRefreshStub.calledOnce, 'onRefresh should be called when sessionDeleted event fires');

        service.dispose();
    });

    test('Given an active SSE subscription, when sessionStatusChanged event fires, then onRefresh is called', async () => {
        sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });

        let capturedCallbacks: SseCallbacks = {};
        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().callsFake((callbacks: SseCallbacks) => {
                capturedCallbacks = callbacks;
                return { close: () => {} };
            }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();

        capturedCallbacks.onSessionStatusChanged?.({ sessionName: 'test', status: 'working' });

        assert.ok(onRefreshStub.calledOnce, 'onRefresh should be called when sessionStatusChanged event fires');

        service.dispose();
    });

    test('Given an active SSE subscription, when dispose() is called, then subscription.close() is invoked', async () => {
        sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });

        let closeCalled = false;
        const fakeSubscription: SseSubscription = { close: () => { closeCalled = true; } };
        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().returns(fakeSubscription),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();
        assert.ok(service.isEnabled(), 'service should be enabled before dispose');

        service.dispose();

        assert.ok(closeCalled, 'SSE subscription.close() should be called on dispose()');
        assert.strictEqual(service.getClient(), undefined, 'getClient() should return undefined after dispose()');
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should return false after dispose()');
    });

    test('Given startDaemon throws, when initialize() is called, then error is handled gracefully', async () => {
        sinon.stub(lifecycle, 'startDaemon').rejects(new Error('startDaemon failed'));

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);

        await assert.doesNotReject(async () => {
            await service.initialize();
        });

        assert.strictEqual(service.getClient(), undefined, 'getClient() should be undefined after failed init');
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should be false after failed init');
        assert.match(service.getLastError() ?? '', /startDaemon failed/);
    });

    test('Given DaemonClient.fromWorkspace throws, when initialize() is called, then error is handled gracefully', async () => {
        sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').rejects(new Error('port file not found'));

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();

        assert.strictEqual(service.getClient(), undefined, 'getClient() should be undefined after failed init');
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should be false after failed init');
    });

    test('Given DaemonService is newly constructed, when isEnabled() is called before initialize(), then false is returned', () => {
        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should be false before initialize()');
        assert.strictEqual(service.getClient(), undefined, 'getClient() should be undefined before initialize()');
    });

    test('Given initialize() completed successfully, when isEnabled() is called, then true is returned', async () => {
        sinon.stub(lifecycle, 'startDaemon').resolves({
            pid: process.pid,
            port: 4300,
            logPath: path.join(tempDir, '.lanes', 'daemon.log'),
            reusedExisting: true,
        });

        const fakeClient = {
            discovery: sinon.stub().resolves({ projectId: 'proj-1' }),
            subscribeEvents: sinon.stub().returns({ close: () => {} }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, createExtensionPath(), onRefreshStub);
        await service.initialize();

        assert.strictEqual(service.isEnabled(), true, 'isEnabled() should be true after successful init');
        assert.ok(service.getClient() !== undefined, 'getClient() should return client after successful init');

        service.dispose();
    });

    test('ServiceContainer interface allows daemonClient to be optional', () => {
        const container = {
            extensionContext: {} as import('vscode').ExtensionContext,
            sessionProvider: {} as import('../../../vscode/providers/AgentSessionProvider').AgentSessionProvider,
            sessionFormProvider: {} as import('../../../vscode/providers/SessionFormProvider').SessionFormProvider,
            previousSessionProvider: {} as import('../../../vscode/providers/PreviousSessionProvider').PreviousSessionProvider,
            workflowsProvider: {} as import('../../../vscode/providers/WorkflowsProvider').WorkflowsProvider,
            workspaceRoot: '/tmp/test',
            baseRepoPath: '/tmp/test',
            extensionPath: '/fake/ext',
            codeAgent: {} as import('../../../core/codeAgents').CodeAgent,
        };

        assert.strictEqual((container as Record<string, unknown>).daemonClient, undefined);
    });
});
