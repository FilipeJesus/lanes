/**
 * Tests for IHandlerContext module exports and interface shapes.
 *
 * These are purely structural/type-level tests verifying that the module
 * exports the right names and that concrete implementations satisfy the
 * interfaces. No network I/O, no file system access.
 */

import * as assert from 'assert';
import type {
    ISimpleConfigStore,
    INotificationEmitter,
    IFileWatchManager,
    IHandlerContext,
} from '../../../core/interfaces/IHandlerContext';

// ---------------------------------------------------------------------------
// Minimal concrete implementations used as "compile-time" smoke tests.
// If a type is wrong, TypeScript will reject this file at compile time.
// ---------------------------------------------------------------------------

class StubConfigStore implements ISimpleConfigStore {
    private readonly store: Record<string, unknown> = {};

    get(key: string): unknown {
        return this.store[key];
    }

    async set(key: string, value: unknown): Promise<void> {
        this.store[key] = value;
    }

    getAll(prefix?: string): Record<string, unknown> {
        if (!prefix) {
            return { ...this.store };
        }
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(this.store)) {
            if (k.startsWith(prefix)) {
                result[k] = v;
            }
        }
        return result;
    }
}

class StubNotificationEmitter implements INotificationEmitter {
    sessionStatusChanged(
        _sessionName: string,
        _status: { status: string; timestamp?: string; message?: string }
    ): void {
        // no-op
    }

    fileChanged(_filePath: string, _eventType: 'created' | 'changed' | 'deleted'): void {
        // no-op
    }

    sessionCreated(_sessionName: string, _worktreePath: string): void {
        // no-op
    }

    sessionDeleted(_sessionName: string): void {
        // no-op
    }
}

class StubFileWatchManager implements IFileWatchManager {
    private nextId = 0;

    watch(_basePath: string, _pattern: string): string {
        return `watch-${this.nextId++}`;
    }

    async unwatch(_watchId: string): Promise<boolean> {
        return true;
    }

    dispose(): void {
        // no-op
    }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('IHandlerContext', () => {
    suite('ISimpleConfigStore interface', () => {
        let store: ISimpleConfigStore;

        setup(() => {
            store = new StubConfigStore();
        });

        test('get() returns undefined for a key that was never set', () => {
            const value = store.get('lanes.defaultAgent');
            assert.strictEqual(value, undefined);
        });

        test('set() persists a value that get() can retrieve', async () => {
            await store.set('lanes.defaultAgent', 'codex');
            const value = store.get('lanes.defaultAgent');
            assert.strictEqual(value, 'codex');
        });

        test('getAll() returns all keys when no prefix is given', async () => {
            await store.set('lanes.defaultAgent', 'claude');
            await store.set('lanes.baseBranch', 'main');
            const all = store.getAll();
            assert.strictEqual(all['lanes.defaultAgent'], 'claude');
            assert.strictEqual(all['lanes.baseBranch'], 'main');
        });

        test('getAll() filters by prefix when given', async () => {
            await store.set('lanes.defaultAgent', 'claude');
            await store.set('other.key', 'other-value');
            const lanesOnly = store.getAll('lanes.');
            assert.ok('lanes.defaultAgent' in lanesOnly, 'prefix-matched key should be present');
            assert.ok(!('other.key' in lanesOnly), 'non-matching key should be absent');
        });
    });

    suite('INotificationEmitter interface', () => {
        let emitter: INotificationEmitter;

        setup(() => {
            emitter = new StubNotificationEmitter();
        });

        test('sessionStatusChanged() can be called without throwing', () => {
            assert.doesNotThrow(() => {
                emitter.sessionStatusChanged('my-session', { status: 'active' });
            });
        });

        test('fileChanged() can be called with each event type without throwing', () => {
            for (const eventType of ['created', 'changed', 'deleted'] as const) {
                assert.doesNotThrow(() => {
                    emitter.fileChanged('/some/path/file.txt', eventType);
                });
            }
        });

        test('sessionCreated() can be called without throwing', () => {
            assert.doesNotThrow(() => {
                emitter.sessionCreated('my-session', '/tmp/worktree');
            });
        });

        test('sessionDeleted() can be called without throwing', () => {
            assert.doesNotThrow(() => {
                emitter.sessionDeleted('my-session');
            });
        });
    });

    suite('IFileWatchManager interface', () => {
        let manager: IFileWatchManager;

        setup(() => {
            manager = new StubFileWatchManager();
        });

        test('watch() returns a non-empty string watch ID', () => {
            const watchId = manager.watch('/tmp/some-dir', '**/*.json');
            assert.ok(typeof watchId === 'string', 'watch ID should be a string');
            assert.ok(watchId.length > 0, 'watch ID should not be empty');
        });

        test('watch() returns unique IDs on successive calls', () => {
            const id1 = manager.watch('/tmp/dir-a', '*.json');
            const id2 = manager.watch('/tmp/dir-b', '*.ts');
            assert.notStrictEqual(id1, id2, 'Each watch should get a unique ID');
        });

        test('unwatch() resolves to a boolean', async () => {
            const watchId = manager.watch('/tmp/some-dir', '*.json');
            const result = await manager.unwatch(watchId);
            assert.ok(typeof result === 'boolean', 'unwatch() should resolve to a boolean');
        });

        test('dispose() can be called without throwing', () => {
            manager.watch('/tmp/dir', '*.json');
            assert.doesNotThrow(() => {
                manager.dispose();
            });
        });
    });

    suite('IHandlerContext type', () => {
        test('a IHandlerContext can be constructed from concrete implementations', () => {
            const ctx: IHandlerContext = {
                workspaceRoot: '/tmp/my-repo',
                config: new StubConfigStore(),
                notificationEmitter: new StubNotificationEmitter(),
                fileWatchManager: new StubFileWatchManager(),
            };

            assert.strictEqual(ctx.workspaceRoot, '/tmp/my-repo');
            assert.ok(ctx.config, 'config should be truthy');
            assert.ok(ctx.notificationEmitter, 'notificationEmitter should be truthy');
            assert.ok(ctx.fileWatchManager, 'fileWatchManager should be truthy');
        });

        test('IHandlerContext exposes workspaceRoot as a string', () => {
            const ctx: IHandlerContext = {
                workspaceRoot: '/home/user/project',
                config: new StubConfigStore(),
                notificationEmitter: new StubNotificationEmitter(),
                fileWatchManager: new StubFileWatchManager(),
            };

            assert.strictEqual(typeof ctx.workspaceRoot, 'string');
        });
    });
});
