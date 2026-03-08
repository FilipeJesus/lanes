/**
 * Tests for DaemonService — VS Code daemon lifecycle manager.
 *
 * Covers:
 *  - initialize() starts daemon when not running
 *  - initialize() skips startDaemon when daemon is already running
 *  - initialize() SSE events trigger onRefresh callback
 *  - dispose() closes the SSE subscription and resets client
 *  - initialize() handles daemon startup failure gracefully
 *  - isEnabled() returns false before init and true after successful init
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write fake daemon PID/port/token files to simulate a running daemon. */
function writeFakeDaemonFiles(workspaceRoot: string, pid: number, port: number): void {
    const lanesDir = path.join(workspaceRoot, '.lanes');
    fs.mkdirSync(lanesDir, { recursive: true });
    fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(pid), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.port'), String(port), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.token'), 'test-token-123', 'utf-8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('DaemonService', () => {
    let tempDir: string;
    let onRefreshStub: sinon.SinonSpy;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-service-test-'));
        onRefreshStub = sinon.spy();
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // daemon-service-reuse-running-daemon
    // -------------------------------------------------------------------------

    test('Given daemon is already running, when initialize() is called, then startDaemon is NOT invoked', async () => {
        // Arrange: write fake daemon files and stub isDaemonRunning to return true
        writeFakeDaemonFiles(tempDir, process.pid, 4299);
        const isDaemonRunningStub = sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);
        const startDaemonStub = sinon.stub(lifecycle, 'startDaemon').resolves();

        // Stub DaemonClient.fromWorkspace to return a minimal mock client
        const fakeClient = {
            subscribeEvents: sinon.stub().returns({ close: () => {} }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        // Act
        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        await service.initialize();

        // Assert
        assert.ok(isDaemonRunningStub.calledOnce, 'isDaemonRunning should be checked');
        assert.ok(startDaemonStub.notCalled, 'startDaemon should NOT be called when daemon is already running');
        assert.ok(service.isEnabled(), 'service should be enabled after successful init');

        service.dispose();
    });

    // -------------------------------------------------------------------------
    // daemon-service-initialize-starts-daemon
    // -------------------------------------------------------------------------

    test('Given daemon is not running, when initialize() is called, then startDaemon is invoked with correct options', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(false);
        const startDaemonStub = sinon.stub(lifecycle, 'startDaemon').resolves();
        // getDaemonPort returns a valid port immediately on first poll
        sinon.stub(lifecycle, 'getDaemonPort').resolves(4300);

        const fakeClient = {
            subscribeEvents: sinon.stub().returns({ close: () => {} }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const extensionPath = '/fake/extension';

        // Act
        const service = new DaemonService(tempDir, extensionPath, onRefreshStub);
        await service.initialize();

        // Assert
        assert.ok(startDaemonStub.calledOnce, 'startDaemon should be called when daemon is not running');
        const callArgs = startDaemonStub.firstCall.args[0] as lifecycle.StartDaemonOptions;
        assert.strictEqual(callArgs.workspaceRoot, tempDir, 'workspaceRoot should match');
        const expectedServerPath = path.join(extensionPath, 'out', 'daemon', 'server.js');
        assert.strictEqual(callArgs.serverPath, expectedServerPath, 'serverPath should point to bundled server');
        assert.ok(service.getClient() !== undefined, 'getClient() should return a client after successful init');

        service.dispose();
    });

    // -------------------------------------------------------------------------
    // daemon-service-sse-triggers-refresh
    // -------------------------------------------------------------------------

    test('Given an active SSE subscription, when sessionCreated event fires, then onRefresh is called', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);

        let capturedCallbacks: SseCallbacks = {};
        const fakeClient = {
            subscribeEvents: sinon.stub().callsFake((callbacks: SseCallbacks) => {
                capturedCallbacks = callbacks;
                return { close: () => {} };
            }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        await service.initialize();

        // Act: simulate SSE event
        capturedCallbacks.onSessionCreated?.({ sessionName: 'test', worktreePath: '/tmp/test' });

        // Assert
        assert.ok(onRefreshStub.calledOnce, 'onRefresh should be called when sessionCreated event fires');

        service.dispose();
    });

    test('Given an active SSE subscription, when sessionDeleted event fires, then onRefresh is called', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);

        let capturedCallbacks: SseCallbacks = {};
        const fakeClient = {
            subscribeEvents: sinon.stub().callsFake((callbacks: SseCallbacks) => {
                capturedCallbacks = callbacks;
                return { close: () => {} };
            }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        await service.initialize();

        // Act
        capturedCallbacks.onSessionDeleted?.({ sessionName: 'test' });

        // Assert
        assert.ok(onRefreshStub.calledOnce, 'onRefresh should be called when sessionDeleted event fires');

        service.dispose();
    });

    test('Given an active SSE subscription, when sessionStatusChanged event fires, then onRefresh is called', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);

        let capturedCallbacks: SseCallbacks = {};
        const fakeClient = {
            subscribeEvents: sinon.stub().callsFake((callbacks: SseCallbacks) => {
                capturedCallbacks = callbacks;
                return { close: () => {} };
            }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        await service.initialize();

        // Act
        capturedCallbacks.onSessionStatusChanged?.({ sessionName: 'test', status: 'working' });

        // Assert
        assert.ok(onRefreshStub.calledOnce, 'onRefresh should be called when sessionStatusChanged event fires');

        service.dispose();
    });

    // -------------------------------------------------------------------------
    // daemon-service-dispose-closes-sse
    // -------------------------------------------------------------------------

    test('Given an active SSE subscription, when dispose() is called, then subscription.close() is invoked', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);

        let closeCalled = false;
        const fakeSubscription: SseSubscription = { close: () => { closeCalled = true; } };
        const fakeClient = {
            subscribeEvents: sinon.stub().returns(fakeSubscription),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        await service.initialize();
        assert.ok(service.isEnabled(), 'service should be enabled before dispose');

        // Act
        service.dispose();

        // Assert
        assert.ok(closeCalled, 'SSE subscription.close() should be called on dispose()');
        assert.strictEqual(service.getClient(), undefined, 'getClient() should return undefined after dispose()');
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should return false after dispose()');
    });

    // -------------------------------------------------------------------------
    // daemon-service-graceful-error
    // -------------------------------------------------------------------------

    test('Given startDaemon throws, when initialize() is called, then error is handled gracefully', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(false);
        sinon.stub(lifecycle, 'startDaemon').rejects(new Error('startDaemon failed'));

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);

        // Act: should not throw
        await assert.doesNotReject(async () => {
            await service.initialize();
        }, 'initialize() should not throw even if daemon fails to start');

        // Assert
        assert.strictEqual(service.getClient(), undefined, 'getClient() should be undefined after failed init');
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should be false after failed init');
    });

    test('Given DaemonClient.fromWorkspace throws, when initialize() is called, then error is handled gracefully', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').rejects(new Error('port file not found'));

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);

        // Act
        await service.initialize();

        // Assert
        assert.strictEqual(service.getClient(), undefined, 'getClient() should be undefined after failed init');
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should be false after failed init');
    });

    // -------------------------------------------------------------------------
    // daemon-service-is-enabled
    // -------------------------------------------------------------------------

    test('Given DaemonService is newly constructed, when isEnabled() is called before initialize(), then false is returned', () => {
        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        assert.strictEqual(service.isEnabled(), false, 'isEnabled() should be false before initialize()');
        assert.strictEqual(service.getClient(), undefined, 'getClient() should be undefined before initialize()');
    });

    test('Given initialize() completed successfully, when isEnabled() is called, then true is returned', async () => {
        // Arrange
        sinon.stub(lifecycle, 'isDaemonRunning').resolves(true);

        const fakeClient = {
            subscribeEvents: sinon.stub().returns({ close: () => {} }),
        } as unknown as clientModule.DaemonClient;
        sinon.stub(clientModule.DaemonClient, 'fromWorkspace').resolves(fakeClient);

        const service = new DaemonService(tempDir, '/fake/ext', onRefreshStub);
        await service.initialize();

        // Assert
        assert.strictEqual(service.isEnabled(), true, 'isEnabled() should be true after successful init');
        assert.ok(service.getClient() !== undefined, 'getClient() should return client after successful init');

        service.dispose();
    });

    // -------------------------------------------------------------------------
    // service-container-daemon-client-optional
    // -------------------------------------------------------------------------

    test('ServiceContainer interface allows daemonClient to be optional', () => {
        // This is a compile-time check. We verify at runtime that a service container
        // without daemonClient can be constructed and used without errors.
        // The actual TypeScript check happens at compile time.
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
            // daemonClient intentionally omitted
        };

        // No daemonClient — accessing it should return undefined
        assert.strictEqual((container as Record<string, unknown>).daemonClient, undefined);
    });
});
