import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { CliConfigProvider } from '../../cli/adapters/CliConfigProvider';
import { UnifiedSettingsService, UNIFIED_DEFAULTS } from '../../core/services/UnifiedSettingsService';
import { parse as yamlParse } from 'yaml';

suite('CliConfigProvider', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-cli-config-test-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('get() returns DEFAULTS value before load', () => {
        const provider = new CliConfigProvider(tempDir);
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), '.worktrees');
        assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'claude');
        assert.strictEqual(provider.get('lanes', 'permissionMode', 'fallback'), 'acceptEdits');
    });

    // cli-config-provider-delegates-to-unified (critical)
    // Given a settings.yaml with lanes.worktreesFolder='.custom-worktrees',
    // when get('lanes','worktreesFolder','fallback') is called after load(), then '.custom-worktrees' is returned
    test('get() returns config file value after load', async () => {
        // Arrange: create .lanes/settings.yaml with custom values
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'settings.yaml'),
            'lanes:\n  worktreesFolder: .custom-worktrees\n  defaultAgent: codex\n',
            'utf-8'
        );

        // Act
        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Assert
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), '.custom-worktrees');
        assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'codex');
    });

    // cli-config-provider-delegates-to-unified (critical)
    // Given a settings.yaml with lanes.defaultAgent='codex',
    // when get('lanes','defaultAgent','fallback') is called after load(), then 'codex' is returned
    test('get() returns defaultAgent from settings.yaml', async () => {
        // Arrange
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'settings.yaml'),
            'lanes:\n  defaultAgent: codex\n',
            'utf-8'
        );

        // Act
        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Assert
        assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'codex');
    });

    // cli-config-provider-delegates-to-unified (critical)
    // Falls back config → DEFAULTS → provided default
    test('falls back config → DEFAULTS → provided default', async () => {
        // Arrange: settings.yaml has worktreesFolder only
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'settings.yaml'),
            'lanes:\n  worktreesFolder: .custom\n',
            'utf-8'
        );

        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Config has it
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'x'), '.custom');
        // Config doesn't have it, DEFAULTS does
        assert.strictEqual(provider.get('lanes', 'baseBranch', 'x'), UNIFIED_DEFAULTS['lanes.baseBranch'] as string);
        // Neither config nor DEFAULTS — use provided default
        assert.strictEqual(provider.get('lanes', 'unknownKey', 'my-default'), 'my-default');
    });

    // cli-config-provider-delegates-to-unified (critical)
    // Given no settings.yaml exists, when load() is called and get('lanes','worktreesFolder','x') is called,
    // then '.worktrees' (UNIFIED_DEFAULT) is returned
    test('load() with missing settings.yaml — get() falls back to UNIFIED_DEFAULTS', async () => {
        // Arrange: no settings.yaml in tempDir
        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Should fall through to DEFAULTS
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'x'), '.worktrees');
        assert.strictEqual(provider.get('lanes', 'unknownKey', 'fallback'), 'fallback');
    });

    // cli-config-provider-delegates-to-unified (critical)
    // Given no settings.yaml and no legacy config.json, when load() is called and
    // get('lanes','unknownKey','fallback') is called, then 'fallback' is returned
    test('get() for unknown section falls back to provided default', () => {
        const provider = new CliConfigProvider(tempDir);
        assert.strictEqual(provider.get('unknown-section', 'key', 'default-val'), 'default-val');
    });

    test('onDidChange returns a disposable', () => {
        const provider = new CliConfigProvider(tempDir);
        const disposable = provider.onDidChange('lanes', () => {});
        assert.ok(disposable);
        assert.ok(typeof disposable.dispose === 'function');
        // Should not throw
        disposable.dispose();
    });

    // cli-config-provider-migrate-on-load (high)
    // Given a legacy .lanes/config.json exists and no settings.yaml, when load() is called,
    // then settings.yaml is created with config.json values
    test('load() migrates legacy .lanes/config.json to settings.yaml', async () => {
        // Arrange: create .lanes/config.json (legacy) but no settings.yaml
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'config.json'),
            JSON.stringify({ worktreesFolder: '.custom-worktrees', defaultAgent: 'codex' }),
            'utf-8'
        );

        // Act
        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Assert: settings.yaml should now exist with the migrated values
        const settingsPath = path.join(lanesDir, 'settings.yaml');
        assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created after migration');

        const content = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = yamlParse(content) as Record<string, unknown>;
        const lanes = parsed['lanes'] as Record<string, unknown>;
        assert.strictEqual(lanes['worktreesFolder'], '.custom-worktrees');
        assert.strictEqual(lanes['defaultAgent'], 'codex');

        // And get() should return the migrated values
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), '.custom-worktrees');
    });

    // cli-config-provider-migrate-on-load (high)
    // Given settings.yaml already exists, when load() is called, then the existing settings.yaml is used (no overwrite)
    test('load() does not overwrite existing settings.yaml', async () => {
        // Arrange: both .lanes/config.json and settings.yaml exist
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'config.json'),
            JSON.stringify({ worktreesFolder: 'from-legacy' }),
            'utf-8'
        );
        const existingYaml = 'lanes:\n  worktreesFolder: from-yaml\n';
        fs.writeFileSync(path.join(lanesDir, 'settings.yaml'), existingYaml, 'utf-8');

        // Act
        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Assert: settings.yaml content is NOT overwritten
        const content = fs.readFileSync(path.join(lanesDir, 'settings.yaml'), 'utf-8');
        assert.strictEqual(content, existingYaml, 'settings.yaml should not be overwritten by migration');

        // And get() returns the existing yaml value, not the legacy config.json value
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), 'from-yaml');
    });

    // Verify settings.yaml path location
    test('reads from .lanes/settings.yaml path', async () => {
        // Arrange: create settings.yaml
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(
            path.join(lanesDir, 'settings.yaml'),
            'lanes:\n  worktreesFolder: yaml-value\n',
            'utf-8'
        );

        // Act
        const provider = new CliConfigProvider(tempDir);
        await provider.load();

        // Assert: value from settings.yaml is returned
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), 'yaml-value');
    });
});

suite('CLI config command', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-cli-config-cmd-test-'));
        // Create the .lanes directory
        fs.mkdirSync(path.join(tempDir, '.lanes'), { recursive: true });
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // cli-config-command-uses-unified (high)
    // When 'lanes config --key worktreesFolder --value .custom' is run, then settings.yaml is written
    test('set via UnifiedSettingsService writes to settings.yaml', async () => {
        // Arrange: use UnifiedSettingsService directly (simulating what the CLI command does)
        const service = new UnifiedSettingsService();
        await service.migrateIfNeeded(tempDir);
        await service.load(tempDir);

        // Act: set a value (simulates 'lanes config --key worktreesFolder --value .custom')
        await service.set('lanes', 'worktreesFolder', '.custom');
        service.dispose();

        // Assert: settings.yaml is written with the new value
        const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
        assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created');

        const content = fs.readFileSync(settingsPath, 'utf-8');
        const parsed = yamlParse(content) as Record<string, unknown>;
        const lanes = parsed['lanes'] as Record<string, unknown>;
        assert.strictEqual(lanes['worktreesFolder'], '.custom');
    });

    // cli-config-command-uses-unified (high)
    // When 'lanes config --key worktreesFolder' is run (get), then the value from settings.yaml is returned
    test('get via UnifiedSettingsService reads from settings.yaml', async () => {
        // Arrange: create settings.yaml with a value
        const lanesDir = path.join(tempDir, '.lanes');
        fs.writeFileSync(
            path.join(lanesDir, 'settings.yaml'),
            'lanes:\n  worktreesFolder: my-worktrees\n',
            'utf-8'
        );

        // Act: load and get value (simulates 'lanes config --key worktreesFolder')
        const service = new UnifiedSettingsService();
        await service.migrateIfNeeded(tempDir);
        await service.load(tempDir);
        const value = service.get('lanes', 'worktreesFolder', null);
        service.dispose();

        // Assert
        assert.strictEqual(value, 'my-worktrees');
    });

    // cli-config-command-uses-unified (high)
    // When 'lanes config --list' is run, then all tracked keys are listed with values
    test('getAll() returns all UNIFIED_DEFAULTS merged with file values', async () => {
        // Arrange: create settings.yaml with a custom value
        const lanesDir = path.join(tempDir, '.lanes');
        fs.writeFileSync(
            path.join(lanesDir, 'settings.yaml'),
            'lanes:\n  defaultAgent: gemini\n',
            'utf-8'
        );

        // Act
        const service = new UnifiedSettingsService();
        await service.migrateIfNeeded(tempDir);
        await service.load(tempDir);
        const all = service.getAll();
        service.dispose();

        // Assert: all UNIFIED_DEFAULTS keys are present
        for (const key of Object.keys(UNIFIED_DEFAULTS)) {
            assert.ok(key in all, `Key '${key}' should be in getAll() result`);
        }
        // And the custom value overrides the default
        assert.strictEqual(all['lanes.defaultAgent'], 'gemini');
        // And other defaults are still their default values
        assert.strictEqual(all['lanes.worktreesFolder'], '.worktrees');
    });
});
