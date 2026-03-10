/**
 * Tests for DaemonConfigStore.
 *
 * Covers:
 *  - effective reads from defaults, global settings, and local overrides
 *  - scope-aware get/set/getAll behavior
 *  - persistence through UnifiedSettingsService paths
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse as yamlParse } from 'yaml';
import { DaemonConfigStore } from '../../daemon/config';

suite('DaemonConfigStore', () => {
    let tempDir: string;
    let tempHomeDir: string;
    let originalHome: string | undefined;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-config-test-'));
        tempHomeDir = path.join(tempDir, 'home');
        fs.mkdirSync(tempHomeDir, { recursive: true });
        originalHome = process.env.HOME;
        process.env.HOME = tempHomeDir;
    });

    teardown(() => {
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('initialize loads default effective values when no settings files exist', async () => {
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        assert.strictEqual(store.get('lanes.worktreesFolder'), '.worktrees');
        assert.strictEqual(store.get('lanes.defaultAgent'), 'claude');
        assert.strictEqual(store.get('lanes.localSettingsPropagation'), 'copy');
        assert.strictEqual(store.get('lanes.workflowsEnabled'), true);
        assert.strictEqual(store.get('lanes.terminalMode'), 'vscode');
    });

    test('set with local scope persists to the repo override file', async () => {
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        await store.set('lanes.defaultAgent', 'codex', 'local');

        const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
        assert.ok(fs.existsSync(settingsPath), 'local settings file should be created');
        const parsed = yamlParse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
        const lanes = parsed['lanes'] as Record<string, unknown>;
        assert.strictEqual(lanes['defaultAgent'], 'codex');
    });

    test('initialize migrates legacy daemon-config.json into local settings overrides', async () => {
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'daemon-config.json'),
            JSON.stringify({
                'lanes.defaultAgent': 'codex',
                'lanes.worktreesFolder': 'legacy-worktrees',
            }),
            'utf-8',
        );

        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        const settingsPath = path.join(lanesDir, 'settings.yaml');
        assert.ok(fs.existsSync(settingsPath), 'local settings file should be created from legacy daemon config');
        assert.strictEqual(store.get('lanes.defaultAgent'), 'codex');
        assert.strictEqual(store.get('lanes.worktreesFolder'), 'legacy-worktrees');
    });

    test('set with global scope persists to the machine-wide settings file', async () => {
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        await store.set('lanes.defaultAgent', 'gemini', 'global');

        const settingsPath = path.join(tempHomeDir, '.lanes', 'settings.yaml');
        assert.ok(fs.existsSync(settingsPath), 'global settings file should be created');
        const parsed = yamlParse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
        const lanes = parsed['lanes'] as Record<string, unknown>;
        assert.strictEqual(lanes['defaultAgent'], 'gemini');
    });

    test('get respects requested scope and local overrides effective values', async () => {
        fs.mkdirSync(path.join(tempHomeDir, '.lanes'), { recursive: true });
        fs.writeFileSync(
            path.join(tempHomeDir, '.lanes', 'settings.yaml'),
            'lanes:\n  defaultAgent: gemini\n',
            'utf-8'
        );
        fs.mkdirSync(path.join(tempDir, '.lanes'), { recursive: true });
        fs.writeFileSync(
            path.join(tempDir, '.lanes', 'settings.yaml'),
            'lanes:\n  defaultAgent: codex\n',
            'utf-8'
        );

        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        assert.strictEqual(store.get('lanes.defaultAgent', 'global'), 'gemini');
        assert.strictEqual(store.get('lanes.defaultAgent', 'local'), 'codex');
        assert.strictEqual(store.get('lanes.defaultAgent'), 'codex');
    });

    test('scope-specific get returns undefined when that scope has no explicit value', async () => {
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        assert.strictEqual(store.get('lanes.defaultAgent', 'global'), undefined);
        assert.strictEqual(store.get('lanes.defaultAgent', 'local'), undefined);
        assert.strictEqual(store.get('lanes.defaultAgent'), 'claude');
    });

    test('getAll respects scope filtering', async () => {
        fs.mkdirSync(path.join(tempHomeDir, '.lanes'), { recursive: true });
        fs.writeFileSync(
            path.join(tempHomeDir, '.lanes', 'settings.yaml'),
            'lanes:\n  defaultAgent: gemini\n',
            'utf-8'
        );
        fs.mkdirSync(path.join(tempDir, '.lanes'), { recursive: true });
        fs.writeFileSync(
            path.join(tempDir, '.lanes', 'settings.yaml'),
            'lanes:\n  worktreesFolder: project-worktrees\n',
            'utf-8'
        );

        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        const globalConfig = store.getAll(undefined, 'global');
        const localConfig = store.getAll(undefined, 'local');
        const effectiveConfig = store.getAll();

        assert.strictEqual(globalConfig['lanes.defaultAgent'], 'gemini');
        assert.ok(!('lanes.worktreesFolder' in globalConfig));
        assert.strictEqual(localConfig['lanes.worktreesFolder'], 'project-worktrees');
        assert.ok(!('lanes.defaultAgent' in localConfig));
        assert.strictEqual(effectiveConfig['lanes.defaultAgent'], 'gemini');
        assert.strictEqual(effectiveConfig['lanes.worktreesFolder'], 'project-worktrees');
    });

    test('getAll with prefix excludes non-matching keys in scoped views', async () => {
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();
        await store.set('custom.setting', 'hello', 'local');

        const filtered = store.getAll('lanes.', 'local');
        assert.ok(!('custom.setting' in filtered));
    });

    test('terminalMode get normalizes legacy code value to vscode', async () => {
        const store = new DaemonConfigStore(tempDir);
        await store.initialize();

        await store.set('lanes.terminalMode', 'code', 'global');

        assert.strictEqual(store.get('lanes.terminalMode', 'global'), 'vscode');
    });
});
