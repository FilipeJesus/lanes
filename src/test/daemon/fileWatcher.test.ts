/**
 * Tests for DaemonFileWatchManager.
 *
 * Covers:
 *  - watch() returns a non-empty watch ID
 *  - unwatch() returns true for a valid ID and false for an unknown ID
 *  - Multiple watch() calls return unique IDs
 *  - dispose() closes all watchers without throwing
 *
 * chokidar is stubbed so no real file system watches are created.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as chokidar from 'chokidar';
import { DaemonFileWatchManager } from '../../daemon/fileWatcher';
import type { INotificationEmitter } from '../../core/interfaces/IHandlerContext';

// ---------------------------------------------------------------------------
// Minimal stub for INotificationEmitter
// ---------------------------------------------------------------------------

class StubNotificationEmitter implements INotificationEmitter {
    sessionStatusChanged(_sessionName: string, _status: { status: string }): void { /* no-op */ }
    fileChanged(_filePath: string, _eventType: 'created' | 'changed' | 'deleted'): void { /* no-op */ }
    sessionCreated(_sessionName: string, _worktreePath: string): void { /* no-op */ }
    sessionDeleted(_sessionName: string): void { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Helper: create a minimal fake FSWatcher
// ---------------------------------------------------------------------------

function makeFakeWatcher(): chokidar.FSWatcher {
    const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};

    const fake = {
        on: sinon.stub().callsFake((event: string, handler: (...args: unknown[]) => void) => {
            if (!handlers[event]) { handlers[event] = []; }
            handlers[event].push(handler);
            // Immediately call the 'ready' handler so waitForReady resolves
            if (event === 'ready') {
                // defer one tick so the watcher is stored first
                Promise.resolve().then(() => handler());
            }
            return fake;
        }),
        close: sinon.stub().resolves(),
        emit: sinon.stub(),
        _handlers: handlers,
    } as unknown as chokidar.FSWatcher;

    return fake;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('DaemonFileWatchManager', () => {
    let tempDir: string;
    let emitter: StubNotificationEmitter;
    let watchStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-fw-test-'));
        emitter = new StubNotificationEmitter();
        // Stub chokidar.watch so no real FS watches are opened
        watchStub = sinon.stub(chokidar, 'watch').callsFake(() => makeFakeWatcher());
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // daemon-fileWatcher-watch-unwatch
    // -------------------------------------------------------------------------

    test('Given a valid basePath and pattern, when watch() is called, then a non-empty watch ID string is returned', () => {
        const manager = new DaemonFileWatchManager(emitter);

        const watchId = manager.watch(tempDir, '**/*.json');

        assert.ok(typeof watchId === 'string', 'watch ID should be a string');
        assert.ok(watchId.length > 0, 'watch ID should not be empty');
    });

    test('Given a valid watch ID, when unwatch() is called, then it returns true', async () => {
        const manager = new DaemonFileWatchManager(emitter);
        const watchId = manager.watch(tempDir, '**/*.json');

        const result = await manager.unwatch(watchId);

        assert.strictEqual(result, true);
    });

    test('Given an invalid watch ID, when unwatch() is called, then it returns false', async () => {
        const manager = new DaemonFileWatchManager(emitter);

        const result = await manager.unwatch('nonexistent-watch-id');

        assert.strictEqual(result, false);
    });

    test('Given two successive watch() calls, when the IDs are compared, then they are different', () => {
        const manager = new DaemonFileWatchManager(emitter);

        const id1 = manager.watch(tempDir, '**/*.json');
        const id2 = manager.watch(tempDir, '**/*.ts');

        assert.notStrictEqual(id1, id2, 'Each watch() call should return a unique ID');
    });

    test('Given multiple watches, when unwatch() is called for one, then the other watch IDs remain valid', async () => {
        const manager = new DaemonFileWatchManager(emitter);
        const id1 = manager.watch(tempDir, '*.json');
        const id2 = manager.watch(tempDir, '*.ts');

        await manager.unwatch(id1);

        // id2 should still be unwatchable (returns true)
        const result = await manager.unwatch(id2);
        assert.strictEqual(result, true, 'Second watch should still be valid after first is removed');
    });

    test('Given a watch that was already unwatched, when unwatch() is called again, then it returns false', async () => {
        const manager = new DaemonFileWatchManager(emitter);
        const watchId = manager.watch(tempDir, '**/*.json');
        await manager.unwatch(watchId);

        const result = await manager.unwatch(watchId);

        assert.strictEqual(result, false, 'Re-unwatching should return false');
    });

    test('Given a DaemonFileWatchManager with active watches, when dispose() is called, then it does not throw', () => {
        const manager = new DaemonFileWatchManager(emitter);
        manager.watch(tempDir, '**/*.json');
        manager.watch(tempDir, '**/*.ts');

        assert.doesNotThrow(() => {
            manager.dispose();
        });
    });

    test('Given a manager after dispose(), when unwatch() is called, then it returns false (all watchers cleared)', async () => {
        const manager = new DaemonFileWatchManager(emitter);
        const id = manager.watch(tempDir, '*.json');
        manager.dispose();

        const result = await manager.unwatch(id);

        assert.strictEqual(result, false, 'After dispose, all watches should be gone');
    });

    test('Given watch() is called, then chokidar.watch is invoked with ignoreInitial: true', () => {
        const manager = new DaemonFileWatchManager(emitter);

        manager.watch(tempDir, '**/*.json');

        assert.ok(watchStub.calledOnce, 'chokidar.watch should be called once');
        const [, options] = watchStub.firstCall.args as [string, chokidar.ChokidarOptions];
        assert.strictEqual(options.ignoreInitial, true, 'ignoreInitial should be true');
    });

    test('Given file events fire on the watcher, when an "add" event occurs, then fileChanged is called with "created"', async () => {
        const fileChangedSpy = sinon.spy(emitter, 'fileChanged');

        // Capture the watcher that chokidar.watch returns
        let capturedWatcher: ReturnType<typeof makeFakeWatcher> | null = null;
        watchStub.callsFake(() => {
            capturedWatcher = makeFakeWatcher();
            return capturedWatcher;
        });

        const manager = new DaemonFileWatchManager(emitter);
        manager.watch(tempDir, '**/*.json');

        // Simulate an "add" event by calling the registered handler directly
        assert.ok(capturedWatcher, 'capturedWatcher should be set');
        const handlers = (capturedWatcher as unknown as { _handlers: Record<string, Array<(p: string) => void>> })._handlers;
        const addHandlers = handlers['add'] ?? [];
        assert.ok(addHandlers.length > 0, 'An "add" handler should be registered');
        addHandlers[0]('/tmp/new-file.json');

        assert.ok(fileChangedSpy.calledOnce, 'fileChanged should be called once');
        assert.strictEqual(fileChangedSpy.firstCall.args[1], 'created', 'Event type should be "created"');
    });
});

// ---------------------------------------------------------------------------
// Suite: DaemonFileWatchManager.setupAutoWatching
// ---------------------------------------------------------------------------

suite('DaemonFileWatchManager.setupAutoWatching', () => {
    let tempDir: string;
    let emitter: StubNotificationEmitter;
    let watchStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-fw-auto-'));
        emitter = new StubNotificationEmitter();
        watchStub = sinon.stub(chokidar, 'watch').callsFake(() => makeFakeWatcher());
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given a workspaceRoot, when setupAutoWatching is called, then watch() is called with path.join(workspaceRoot, ".lanes", "current-sessions") and "**/*"', () => {
        const manager = new DaemonFileWatchManager(emitter);
        const expectedSessionsPath = path.join(tempDir, '.lanes', 'current-sessions');

        manager.setupAutoWatching(tempDir);

        // chokidar.watch is called once per watch() invocation; first call is for sessions
        assert.ok(watchStub.calledTwice, 'chokidar.watch should be called twice (one per path)');
        const firstCallPath = watchStub.firstCall.args[0] as string;
        assert.strictEqual(
            firstCallPath,
            path.resolve(expectedSessionsPath),
            'First watch should target .lanes/current-sessions'
        );
    });

    test('Given a workspaceRoot, when setupAutoWatching is called, then watch() is called with path.join(workspaceRoot, ".worktrees") and "**/workflow-state.json"', () => {
        const manager = new DaemonFileWatchManager(emitter);
        const expectedWorktreesPath = path.join(tempDir, '.worktrees');

        manager.setupAutoWatching(tempDir);

        assert.ok(watchStub.calledTwice, 'chokidar.watch should be called twice (one per path)');
        const secondCallPath = watchStub.secondCall.args[0] as string;
        assert.strictEqual(
            secondCallPath,
            path.resolve(expectedWorktreesPath),
            'Second watch should target .worktrees'
        );
    });

    test('Given a custom worktreesFolder, when setupAutoWatching is called, then the second watch targets the custom folder', () => {
        const manager = new DaemonFileWatchManager(emitter);
        const customFolder = '.lanes-worktrees';
        const expectedWorktreesPath = path.join(tempDir, customFolder);

        manager.setupAutoWatching(tempDir, customFolder);

        assert.ok(watchStub.calledTwice, 'chokidar.watch should be called twice');
        const secondCallPath = watchStub.secondCall.args[0] as string;
        assert.strictEqual(
            secondCallPath,
            path.resolve(expectedWorktreesPath),
            'Second watch should target the custom worktrees folder'
        );
    });

    test('Given a workspaceRoot, when setupAutoWatching is called, then it returns an array of exactly 2 non-empty string watch IDs', () => {
        const manager = new DaemonFileWatchManager(emitter);

        const watchIds = manager.setupAutoWatching(tempDir);

        assert.ok(Array.isArray(watchIds), 'setupAutoWatching should return an array');
        assert.strictEqual(watchIds.length, 2, 'The array should contain exactly 2 watch IDs');
        assert.ok(typeof watchIds[0] === 'string' && watchIds[0].length > 0, 'First watch ID should be a non-empty string');
        assert.ok(typeof watchIds[1] === 'string' && watchIds[1].length > 0, 'Second watch ID should be a non-empty string');
    });

    test('Given a workspaceRoot, when setupAutoWatching is called, then the two returned watch IDs are different strings', () => {
        const manager = new DaemonFileWatchManager(emitter);

        const watchIds = manager.setupAutoWatching(tempDir);

        assert.notStrictEqual(watchIds[0], watchIds[1], 'The two watch IDs returned by setupAutoWatching should be unique');
    });
});
