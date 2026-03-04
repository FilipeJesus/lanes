/**
 * Tests for DaemonConfigStore.
 *
 * Covers:
 *  - initialize() creates defaults when config file does not exist
 *  - set() persists values and get() returns them
 *  - A new store loaded from an existing file returns persisted values
 *  - getAll() returns all config keys with no prefix
 *  - getAll() filters by prefix
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DaemonConfigStore } from '../../daemon/config';

suite('DaemonConfigStore', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-config-test-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // daemon-config-initialize-defaults
    // -------------------------------------------------------------------------

    test('Given no config file exists, when initialize() is called, then get() returns default values for all known keys', async () => {
        // Arrange: tempDir has no .lanes/daemon-config.json
        const store = new DaemonConfigStore(tempDir);

        // Act
        await store.initialize();

        // Assert: default values must be returned
        assert.strictEqual(store.get('lanes.worktreesFolder'), '.worktrees');
        assert.strictEqual(store.get('lanes.defaultAgent'), 'claude');
        assert.strictEqual(store.get('lanes.localSettingsPropagation'), 'copy');
        assert.strictEqual(store.get('lanes.workflowsEnabled'), true);
        assert.strictEqual(store.get('lanes.chimeSound'), true);
        assert.strictEqual(store.get('lanes.terminalMode'), 'vscode');
    });

    test('Given no config file exists, when initialize() is called, then the config file is created on disk', async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        const expectedPath = path.join(tempDir, '.lanes', 'daemon-config.json');

        // Act
        await store.initialize();

        // Assert: file was written
        assert.ok(fs.existsSync(expectedPath), 'daemon-config.json should be created');
        const raw = fs.readFileSync(expectedPath, 'utf-8');
        const parsed = JSON.parse(raw);
        assert.strictEqual(parsed['lanes.defaultAgent'], 'claude');
    });

    // -------------------------------------------------------------------------
    // daemon-config-persist-and-reload
    // -------------------------------------------------------------------------

    test('Given an initialized store, when set() is called with a key/value, then get() returns the new value', async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        // Act
        await store.set('lanes.defaultAgent', 'codex');

        // Assert
        assert.strictEqual(store.get('lanes.defaultAgent'), 'codex');
    });

    test('Given a config file with saved values, when a new store is initialized, then get() returns the persisted values', async () => {
        // Arrange: write a value via the first store
        const store1 = new DaemonConfigStore(tempDir);
        await store1.initialize();
        await store1.set('lanes.defaultAgent', 'codex');
        await store1.set('lanes.worktreesFolder', 'my-worktrees');

        // Act: create a second store pointing at the same directory
        const store2 = new DaemonConfigStore(tempDir);
        await store2.initialize();

        // Assert: persisted values are loaded
        assert.strictEqual(store2.get('lanes.defaultAgent'), 'codex');
        assert.strictEqual(store2.get('lanes.worktreesFolder'), 'my-worktrees');
    });

    test('Given an initialized store, when set() is called, then the value is persisted to disk', async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        // Act
        await store.set('lanes.baseBranch', 'main');

        // Assert: file contains the new value
        const configPath = path.join(tempDir, '.lanes', 'daemon-config.json');
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        assert.strictEqual(parsed['lanes.baseBranch'], 'main');
    });

    // -------------------------------------------------------------------------
    // daemon-config-getAll-prefix
    // -------------------------------------------------------------------------

    test('Given an initialized store, when getAll() is called without a prefix, then all config keys are returned', async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        // Act
        const all = store.getAll();

        // Assert: at least the known default keys are present
        assert.ok('lanes.defaultAgent' in all, 'lanes.defaultAgent should be present');
        assert.ok('lanes.worktreesFolder' in all, 'lanes.worktreesFolder should be present');
        assert.ok('lanes.terminalMode' in all, 'lanes.terminalMode should be present');
    });

    test("Given an initialized store, when getAll('lanes.polling') is called, then only keys starting with that prefix are returned", async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        // Act
        const filtered = store.getAll('lanes.polling');

        // Assert: only polling keys returned
        for (const key of Object.keys(filtered)) {
            assert.ok(
                key.startsWith('lanes.polling'),
                `Key '${key}' does not start with 'lanes.polling'`
            );
        }
        // The default config includes lanes.polling.quietThresholdMs
        assert.ok('lanes.polling.quietThresholdMs' in filtered);
    });

    test("Given an initialized store with a custom value, when getAll('lanes.') is called, then non-matching keys are excluded", async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();
        await store.set('custom.setting', 'hello');

        // Act
        const filtered = store.getAll('lanes.');

        // Assert: custom.setting is NOT included
        assert.ok(!('custom.setting' in filtered), 'custom.setting should not appear in lanes. prefix filter');
    });

    // -------------------------------------------------------------------------
    // Error before initialization
    // -------------------------------------------------------------------------

    test('Given an uninitialized store, when get() is called, then it throws an error', () => {
        const store = new DaemonConfigStore(tempDir);
        assert.throws(() => {
            store.get('lanes.defaultAgent');
        }, /not initialized/i);
    });

    test('Given an uninitialized store, when set() is called, then it throws an error', async () => {
        const store = new DaemonConfigStore(tempDir);
        let thrown: unknown;
        try {
            await store.set('lanes.defaultAgent', 'codex');
        } catch (err) {
            thrown = err;
        }
        assert.ok(thrown instanceof Error);
        assert.ok((thrown as Error).message.toLowerCase().includes('not initialized'));
    });

    // -------------------------------------------------------------------------
    // terminalMode normalization
    // -------------------------------------------------------------------------

    test('Given terminalMode is set to "code", when get() is called, then it returns "vscode"', async () => {
        // Arrange
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        // Act
        await store.set('lanes.terminalMode', 'code');

        // Assert: normalized to "vscode"
        assert.strictEqual(store.get('lanes.terminalMode'), 'vscode');
    });
});
