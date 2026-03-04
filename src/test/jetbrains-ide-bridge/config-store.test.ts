import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as yamlParse } from 'yaml';
import { ConfigStore } from '../../jetbrains-ide-bridge/config';
import { UNIFIED_DEFAULTS } from '../../core/services/UnifiedSettingsService';
import { NotificationEmitter } from '../../jetbrains-ide-bridge/notifications';
import { handleRequest, initializeHandlers, JsonRpcHandlerError } from '../../jetbrains-ide-bridge/handlers';

suite('Bridge ConfigStore', () => {
    let tempDir: string;
    let store: ConfigStore;

    setup(async () => {
        tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanes-config-store-test-'));
        store = new ConfigStore(tempDir);
        await store.initialize();
    });

    teardown(async () => {
        store.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // Existing test — must still pass
    test('normalizes legacy terminalMode "code" to "vscode"', async () => {
        await store.set('lanes.terminalMode', 'code');
        const value = store.get('lanes.terminalMode');
        assert.strictEqual(value, 'vscode');
    });

    // config-store-delegates-to-unified (critical)
    // Given a settings.yaml with lanes.defaultAgent=gemini, when get('lanes.defaultAgent') is called,
    // then 'gemini' is returned
    test('get() returns value from settings.yaml after initialize()', async () => {
        // Arrange: write settings.yaml with a custom value before initializing
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanes-config-store-yaml-'));
        try {
            const lanesDir = path.join(dir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'settings.yaml'),
                'lanes:\n  defaultAgent: gemini\n',
                'utf-8'
            );

            const s = new ConfigStore(dir);
            await s.initialize();

            // Act
            const value = s.get('lanes.defaultAgent');
            s.dispose();

            // Assert
            assert.strictEqual(value, 'gemini');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // config-store-delegates-to-unified (critical)
    // When set('lanes.worktreesFolder', '.custom') is called, then settings.yaml on disk contains the new value
    test('set() persists value to settings.yaml on disk', async () => {
        // Act
        await store.set('lanes.worktreesFolder', '.custom');

        // Assert: settings.yaml exists and has the value
        const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
        assert.ok(fs.existsSync(settingsPath), 'settings.yaml should exist after set()');

        const content = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = yamlParse(content) as Record<string, unknown>;
        const lanes = parsed['lanes'] as Record<string, unknown>;
        assert.strictEqual(lanes['worktreesFolder'], '.custom');

        // And get() should return the new value
        assert.strictEqual(store.get('lanes.worktreesFolder'), '.custom');
    });

    // config-store-delegates-to-unified (critical)
    // getAll() returns all UNIFIED_DEFAULTS merged with file values
    test('getAll() returns all UNIFIED_DEFAULTS keys', async () => {
        // Act
        const all = store.getAll();

        // Assert: all UNIFIED_DEFAULTS keys are present
        for (const key of Object.keys(UNIFIED_DEFAULTS)) {
            assert.ok(key in all, `Key '${key}' should be in getAll() result`);
            assert.strictEqual(all[key], UNIFIED_DEFAULTS[key], `Key '${key}' should have default value`);
        }
    });

    // config-store-delegates-to-unified (critical)
    // getAll('lanes.') filters results to only lanes. keys
    test("getAll('lanes.') filters results to lanes. prefix only", async () => {
        // Act
        const all = store.getAll('lanes.');

        // Assert: all returned keys start with 'lanes.'
        for (const key of Object.keys(all)) {
            assert.ok(key.startsWith('lanes.'), `Key '${key}' should start with 'lanes.'`);
        }

        // And at least the known lanes keys are included
        assert.ok('lanes.worktreesFolder' in all, 'lanes.worktreesFolder should be present');
        assert.ok('lanes.defaultAgent' in all, 'lanes.defaultAgent should be present');
    });

    // config-store-delegates-to-unified (critical)
    // getAll() with file values overrides defaults
    test('getAll() merges file values over UNIFIED_DEFAULTS', async () => {
        // Arrange: set a custom value
        await store.set('lanes.defaultAgent', 'gemini');

        // Act
        const all = store.getAll();

        // Assert: custom value overrides default
        assert.strictEqual(all['lanes.defaultAgent'], 'gemini');
        // Other defaults are still present
        assert.strictEqual(all['lanes.worktreesFolder'], '.worktrees');
    });
});

suite('Bridge ConfigStore - migration on initialize()', () => {
    // config-store-migrate-on-initialize (high)
    // Given a legacy jetbrains-ide-config.json exists and no settings.yaml, when initialize() is called,
    // then settings.yaml is created
    test('initialize() migrates legacy jetbrains-ide-config.json to settings.yaml', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanes-config-store-migrate-'));
        try {
            // Arrange: create .lanes/jetbrains-ide-config.json (legacy) but no settings.yaml
            const lanesDir = path.join(dir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'jetbrains-ide-config.json'),
                JSON.stringify({
                    'lanes.worktreesFolder': '.custom-from-jb',
                    'lanes.defaultAgent': 'gemini',
                }),
                'utf-8'
            );

            // Act
            const s = new ConfigStore(dir);
            await s.initialize();

            // Assert: settings.yaml is created with migrated values
            const settingsPath = path.join(lanesDir, 'settings.yaml');
            assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created after migration');

            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.strictEqual(lanes['worktreesFolder'], '.custom-from-jb');
            assert.strictEqual(lanes['defaultAgent'], 'gemini');

            // And get() returns the migrated values
            assert.strictEqual(s.get('lanes.worktreesFolder'), '.custom-from-jb');
            s.dispose();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // config-store-migrate-on-initialize (high)
    // Given settings.yaml already exists, when initialize() is called, then the existing settings.yaml is used
    test('initialize() does not overwrite existing settings.yaml', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanes-config-store-no-overwrite-'));
        try {
            // Arrange: create both jetbrains-ide-config.json and settings.yaml
            const lanesDir = path.join(dir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'jetbrains-ide-config.json'),
                JSON.stringify({ 'lanes.worktreesFolder': 'from-legacy' }),
                'utf-8'
            );
            const existingYaml = 'lanes:\n  worktreesFolder: from-yaml\n';
            fs.writeFileSync(path.join(lanesDir, 'settings.yaml'), existingYaml, 'utf-8');

            // Act
            const s = new ConfigStore(dir);
            await s.initialize();

            // Assert: settings.yaml is not overwritten
            const content = fs.readFileSync(path.join(lanesDir, 'settings.yaml'), 'utf-8');
            assert.strictEqual(content, existingYaml, 'settings.yaml should not be overwritten');

            // And get() returns the yaml value, not the legacy config value
            assert.strictEqual(s.get('lanes.worktreesFolder'), 'from-yaml');
            s.dispose();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

suite('Bridge Handlers - config.get validation', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-config-get-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('config.get with a valid key returns the value', async () => {
        const result = await handleRequest('config.get', { key: 'lanes.terminalMode' }) as { value: unknown };

        // The default value is 'vscode'
        assert.strictEqual(result.value, 'vscode');
    });

    test('config.get with a valid key lanes.defaultAgent returns the value', async () => {
        const result = await handleRequest('config.get', { key: 'lanes.defaultAgent' }) as { value: unknown };

        assert.strictEqual(result.value, 'claude');
    });

    test('config.get with an invalid key throws a JsonRpcHandlerError with code -32602', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('config.get', { key: 'lanes.unknownKey' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof JsonRpcHandlerError, 'Should throw JsonRpcHandlerError');
        assert.strictEqual((caughtError as JsonRpcHandlerError).code, -32602, 'Error code should be -32602 INVALID_PARAMS');
    });

    test('config.get with an invalid key error message lists valid keys', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('config.get', { key: 'not.a.valid.key' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof JsonRpcHandlerError);
        assert.ok(
            (caughtError as JsonRpcHandlerError).message.includes('lanes.terminalMode'),
            'Error message should list at least one valid key'
        );
    });
});
