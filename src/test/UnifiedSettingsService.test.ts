import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parse as yamlParse } from 'yaml';
import { UnifiedSettingsService, UNIFIED_DEFAULTS } from '../core/services/UnifiedSettingsService';

suite('UnifiedSettingsService', () => {
    let tempDir: string;
    let tempHomeDir: string;
    let originalHome: string | undefined;
    let service: UnifiedSettingsService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-unified-settings-test-'));
        tempHomeDir = path.join(tempDir, 'home');
        fs.mkdirSync(tempHomeDir, { recursive: true });
        originalHome = process.env.HOME;
        process.env.HOME = tempHomeDir;
        service = new UnifiedSettingsService();
    });

    teardown(() => {
        service.dispose();
        if (originalHome === undefined) {
            delete process.env.HOME;
        } else {
            process.env.HOME = originalHome;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // unified-settings-load-defaults
    // -------------------------------------------------------------------------

    suite('load defaults when settings.yaml does not exist', () => {
        test('returns built-in default value when settings.yaml is absent', async () => {
            // Given: No settings.yaml file exists in the repo
            await service.load(tempDir);

            // When: get() is called for a known key
            const result = service.get('lanes', 'worktreesFolder', 'FALLBACK');

            // Then: The built-in default value is returned
            assert.strictEqual(result, '.worktrees');
        });

        test('returns custom default for unknown keys when settings.yaml is absent', async () => {
            // Given: No settings.yaml file exists
            await service.load(tempDir);

            // When: get() is called with a custom default for an unknown key
            const result = service.get('lanes', 'unknownKey', 'MY_CUSTOM_DEFAULT');

            // Then: The custom default is returned
            assert.strictEqual(result, 'MY_CUSTOM_DEFAULT');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-load-and-get
    // -------------------------------------------------------------------------

    suite('load() parses settings.yaml and get() returns correct values', () => {
        test('scope-specific reads do not fall back to defaults when that scope has no explicit value', async () => {
            await service.load(tempDir);

            assert.strictEqual(service.getForView('lanes', 'defaultAgent', null, 'global'), null);
            assert.strictEqual(service.getForView('lanes', 'defaultAgent', null, 'local'), null);
            assert.strictEqual(service.getForView('lanes', 'defaultAgent', null, 'effective'), 'claude');
        });

        test('returns value from global settings when local override is absent', async () => {
            const globalLanesDir = path.join(tempHomeDir, '.lanes');
            fs.mkdirSync(globalLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(globalLanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: global-worktrees\n',
                'utf-8'
            );

            await service.load(tempDir);
            const result = service.get('lanes', 'worktreesFolder', '.worktrees');

            assert.strictEqual(result, 'global-worktrees');
        });

        test('returns local override when both global and local settings define a key', async () => {
            const globalLanesDir = path.join(tempHomeDir, '.lanes');
            fs.mkdirSync(globalLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(globalLanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: global-worktrees\n',
                'utf-8'
            );

            const localLanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(localLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(localLanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: local-worktrees\n',
                'utf-8'
            );

            await service.load(tempDir);
            const result = service.get('lanes', 'worktreesFolder', '.worktrees');

            assert.strictEqual(result, 'local-worktrees');
        });

        test('returns value from settings.yaml for lanes.worktreesFolder', async () => {
            // Given: A settings.yaml with lanes.worktreesFolder set to 'custom'
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: custom\n',
                'utf-8'
            );

            // When: load() then get() are called
            await service.load(tempDir);
            const result = service.get('lanes', 'worktreesFolder', '.worktrees');

            // Then: 'custom' is returned
            assert.strictEqual(result, 'custom');
        });

        test('returns nested value for lanes.polling.quietThresholdMs', async () => {
            // Given: A settings.yaml with nested polling section
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'settings.yaml'),
                'lanes:\n  polling:\n    quietThresholdMs: 5000\n',
                'utf-8'
            );

            // When: load() then get() are called with dot-notation sub-key
            await service.load(tempDir);
            const result = service.get('lanes', 'polling.quietThresholdMs', 30000);

            // Then: 5000 is returned
            assert.strictEqual(result, 5000);
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-set-and-persist
    // -------------------------------------------------------------------------

    suite('set() writes values to settings.yaml in correct nested YAML format', () => {
        test('global scoped set writes to the machine-wide settings file', async () => {
            await service.load(tempDir);

            await service.set('lanes', 'worktreesFolder', 'global-worktrees', 'global');

            const settingsPath = path.join(tempHomeDir, '.lanes', 'settings.yaml');
            assert.ok(fs.existsSync(settingsPath), 'global settings.yaml should be created');

            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.strictEqual(lanes['worktreesFolder'], 'global-worktrees');
        });

        test('creates settings.yaml with nested YAML structure', async () => {
            // Given: A repo root with no existing settings.yaml
            await service.load(tempDir);

            // When: set() is called
            await service.set('lanes', 'worktreesFolder', 'custom');

            // Then: settings.yaml is created with nested structure
            const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
            assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created');

            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            assert.ok(parsed !== null && typeof parsed === 'object', 'YAML should parse to an object');

            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.ok(lanes !== null && typeof lanes === 'object', 'Should have nested lanes key');
            assert.strictEqual(lanes['worktreesFolder'], 'custom');
        });

        test('persisted file can be re-read with load() and the value is correct', async () => {
            // Given: A repo root where set() has been called
            await service.load(tempDir);
            await service.set('lanes', 'worktreesFolder', 'my-worktrees');

            // When: A new service instance loads the same directory
            const service2 = new UnifiedSettingsService();
            try {
                await service2.load(tempDir);
                const result = service2.get('lanes', 'worktreesFolder', '.worktrees');

                // Then: The persisted value is returned
                assert.strictEqual(result, 'my-worktrees');
            } finally {
                service2.dispose();
            }
        });

        test('set() with nested key creates correct nested YAML structure', async () => {
            // Given: A repo root
            await service.load(tempDir);

            // When: set() is called with a dot-notation sub-key
            await service.set('lanes', 'polling.quietThresholdMs', 5000);

            // Then: The YAML has a correct nested structure
            const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;

            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.ok(lanes !== null && typeof lanes === 'object', 'Should have nested lanes key');

            const polling = lanes['polling'] as Record<string, unknown>;
            assert.ok(polling !== null && typeof polling === 'object', 'Should have nested polling key');
            assert.strictEqual(polling['quietThresholdMs'], 5000);
        });

        test('local set removes the override file entry when the value matches inherited global config', async () => {
            const globalLanesDir = path.join(tempHomeDir, '.lanes');
            fs.mkdirSync(globalLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(globalLanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: shared-worktrees\n',
                'utf-8'
            );

            await service.load(tempDir);
            await service.set('lanes', 'worktreesFolder', 'shared-worktrees');

            const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
            assert.ok(!fs.existsSync(settingsPath), 'local override file should be omitted when no overrides remain');
            assert.strictEqual(service.get('lanes', 'worktreesFolder', '.worktrees'), 'shared-worktrees');
        });

        test('global setMany persists pruning when a matching local override becomes redundant', async () => {
            const localLanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(localLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(localLanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: local-worktrees\n',
                'utf-8'
            );

            await service.load(tempDir);
            await service.setMany([
                { section: 'lanes', key: 'worktreesFolder', value: 'local-worktrees' },
            ], 'global');

            const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
            assert.ok(!fs.existsSync(settingsPath), 'redundant local override should be removed from disk');
            assert.strictEqual(service.get('lanes', 'worktreesFolder', '.worktrees'), 'local-worktrees');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-get-all
    // -------------------------------------------------------------------------

    suite('getAll() returns all settings merged with defaults', () => {
        test('includes all UNIFIED_DEFAULTS keys when no settings.yaml exists', async () => {
            // Given: No settings.yaml
            await service.load(tempDir);

            // When: getAll() is called
            const all = service.getAll();

            // Then: All UNIFIED_DEFAULTS keys are present
            for (const key of Object.keys(UNIFIED_DEFAULTS)) {
                assert.ok(key in all, `Key '${key}' should be in getAll() result`);
                assert.strictEqual(all[key], UNIFIED_DEFAULTS[key]);
            }
        });

        test('overrides defaults with values from settings.yaml', async () => {
            // Given: A settings.yaml with some keys set
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'settings.yaml'),
                'lanes:\n  worktreesFolder: override\n',
                'utf-8'
            );

            // When: load() and getAll() are called
            await service.load(tempDir);
            const all = service.getAll();

            // Then: The override is present, and other defaults are still there
            assert.strictEqual(all['lanes.worktreesFolder'], 'override');
            // Other UNIFIED_DEFAULTS values should still be present
            assert.strictEqual(all['lanes.defaultAgent'], UNIFIED_DEFAULTS['lanes.defaultAgent']);
            assert.strictEqual(all['lanes.polling.quietThresholdMs'], UNIFIED_DEFAULTS['lanes.polling.quietThresholdMs']);
        });

        test('includes global settings and overlays them with local overrides', async () => {
            const globalLanesDir = path.join(tempHomeDir, '.lanes');
            fs.mkdirSync(globalLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(globalLanesDir, 'settings.yaml'),
                'lanes:\n  defaultAgent: codex\n  promptsFolder: global-prompts\n',
                'utf-8'
            );

            const localLanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(localLanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(localLanesDir, 'settings.yaml'),
                'lanes:\n  defaultAgent: gemini\n',
                'utf-8'
            );

            await service.load(tempDir);
            const all = service.getAll();

            assert.strictEqual(all['lanes.defaultAgent'], 'gemini');
            assert.strictEqual(all['lanes.promptsFolder'], 'global-prompts');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-migrate-from-config-json
    // -------------------------------------------------------------------------

    suite('migrateIfNeeded() migrates from .lanes/config.json to settings.yaml', () => {
        test('creates settings.yaml from .lanes/config.json values', async () => {
            // Given: A .lanes/config.json with some settings, no settings.yaml
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'config.json'),
                JSON.stringify({ worktreesFolder: 'from-cli', defaultAgent: 'codex' }),
                'utf-8'
            );

            // When: migrateIfNeeded() is called
            await service.migrateIfNeeded(tempDir);

            // Then: settings.yaml is created with the config.json values
            const settingsPath = path.join(lanesDir, 'settings.yaml');
            assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created after migration');

            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.strictEqual(lanes['worktreesFolder'], 'from-cli');
            assert.strictEqual(lanes['defaultAgent'], 'codex');
        });

        test('does NOT overwrite existing settings.yaml when it already exists', async () => {
            // Given: Both .lanes/config.json and settings.yaml already exist
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'config.json'),
                JSON.stringify({ worktreesFolder: 'from-cli' }),
                'utf-8'
            );
            const existingContent = 'lanes:\n  worktreesFolder: existing\n';
            fs.writeFileSync(path.join(lanesDir, 'settings.yaml'), existingContent, 'utf-8');

            // When: migrateIfNeeded() is called
            await service.migrateIfNeeded(tempDir);

            // Then: settings.yaml is NOT overwritten
            const content = fs.readFileSync(path.join(lanesDir, 'settings.yaml'), 'utf-8');
            assert.strictEqual(content, existingContent, 'settings.yaml should not be overwritten');
        });

        test('original config.json still exists after migration', async () => {
            // Given: A .lanes/config.json with some settings
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            const configPath = path.join(lanesDir, 'config.json');
            fs.writeFileSync(
                configPath,
                JSON.stringify({ worktreesFolder: 'from-cli' }),
                'utf-8'
            );

            // When: migrateIfNeeded() is called
            await service.migrateIfNeeded(tempDir);

            // Then: The original config.json still exists
            assert.ok(fs.existsSync(configPath), 'config.json should not be deleted after migration');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-migrate-from-jetbrains-config
    // -------------------------------------------------------------------------

    suite('migrateIfNeeded() migrates from .lanes/jetbrains-ide-config.json to settings.yaml', () => {
        test('creates settings.yaml with correct nested structure from JetBrains flat keys', async () => {
            // Given: A .lanes/jetbrains-ide-config.json with flat keys, no settings.yaml
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'jetbrains-ide-config.json'),
                JSON.stringify({
                    'lanes.worktreesFolder': 'from-jb',
                    'lanes.defaultAgent': 'gemini',
                }),
                'utf-8'
            );

            // When: migrateIfNeeded() is called
            await service.migrateIfNeeded(tempDir);

            // Then: settings.yaml is created with the correct nested YAML structure
            const settingsPath = path.join(lanesDir, 'settings.yaml');
            assert.ok(fs.existsSync(settingsPath), 'settings.yaml should be created after JetBrains migration');

            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.strictEqual(lanes['worktreesFolder'], 'from-jb');
            assert.strictEqual(lanes['defaultAgent'], 'gemini');
        });

        test('original jetbrains-ide-config.json still exists after migration', async () => {
            // Given: A .lanes/jetbrains-ide-config.json
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            const jbConfigPath = path.join(lanesDir, 'jetbrains-ide-config.json');
            fs.writeFileSync(
                jbConfigPath,
                JSON.stringify({ 'lanes.worktreesFolder': 'from-jb' }),
                'utf-8'
            );

            // When: migrateIfNeeded() is called
            await service.migrateIfNeeded(tempDir);

            // Then: The original file still exists
            assert.ok(fs.existsSync(jbConfigPath), 'jetbrains-ide-config.json should not be deleted after migration');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-migrate-merge
    // -------------------------------------------------------------------------

    suite('migrateIfNeeded() merges both config files, CLI takes precedence', () => {
        test('uses config.json values over jetbrains-ide-config.json when both exist', async () => {
            // Given: Both .lanes/config.json and .lanes/jetbrains-ide-config.json with conflicting values
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            fs.writeFileSync(
                path.join(lanesDir, 'config.json'),
                JSON.stringify({ worktreesFolder: 'cli-wins', defaultAgent: 'codex' }),
                'utf-8'
            );
            fs.writeFileSync(
                path.join(lanesDir, 'jetbrains-ide-config.json'),
                JSON.stringify({ 'lanes.worktreesFolder': 'jb-loses', 'lanes.defaultAgent': 'gemini' }),
                'utf-8'
            );

            // When: migrateIfNeeded() is called
            await service.migrateIfNeeded(tempDir);

            // Then: settings.yaml uses config.json values (CLI takes precedence)
            const settingsPath = path.join(lanesDir, 'settings.yaml');
            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.strictEqual(lanes['worktreesFolder'], 'cli-wins', 'CLI config should take precedence');
            assert.strictEqual(lanes['defaultAgent'], 'codex', 'CLI config should take precedence');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-on-did-change
    // -------------------------------------------------------------------------

    suite('onDidChange() callback is invoked when settings.yaml changes on disk', () => {
        test('callback is invoked when settings.yaml is modified', async () => {
            // Given: settings.yaml already exists and we have registered a callback
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            const settingsPath = path.join(lanesDir, 'settings.yaml');
            fs.writeFileSync(settingsPath, 'lanes:\n  worktreesFolder: initial\n', 'utf-8');

            await service.load(tempDir);

            let callbackInvoked = false;
            const disposable = service.onDidChange(() => {
                callbackInvoked = true;
            });

            try {
                // When: settings.yaml is modified on disk
                fs.writeFileSync(settingsPath, 'lanes:\n  worktreesFolder: changed\n', 'utf-8');

                // Then: The callback is eventually invoked (with some wait for debounce)
                await new Promise<void>((resolve, reject) => {
                    const deadline = Date.now() + 2000;
                    const poll = setInterval(() => {
                        if (callbackInvoked) {
                            clearInterval(poll);
                            resolve();
                        } else if (Date.now() > deadline) {
                            clearInterval(poll);
                            reject(new Error('onDidChange callback was not invoked within 2 seconds'));
                        }
                    }, 50);
                });

                assert.ok(callbackInvoked, 'Callback should have been invoked after file change');
            } finally {
                disposable.dispose();
            }
        });

        test('callback is NOT invoked after the watcher is disposed', async () => {
            // Given: settings.yaml exists and a callback has been registered then disposed
            const lanesDir = path.join(tempDir, '.lanes');
            fs.mkdirSync(lanesDir, { recursive: true });
            const settingsPath = path.join(lanesDir, 'settings.yaml');
            fs.writeFileSync(settingsPath, 'lanes:\n  worktreesFolder: initial\n', 'utf-8');

            await service.load(tempDir);

            let callbackCount = 0;
            const disposable = service.onDidChange(() => {
                callbackCount++;
            });

            // When: We dispose the watcher before any change
            disposable.dispose();

            // And: settings.yaml is modified
            fs.writeFileSync(settingsPath, 'lanes:\n  worktreesFolder: changed\n', 'utf-8');

            // Wait enough time for the debounce to fire if it were going to
            await new Promise<void>((resolve) => setTimeout(resolve, 200));

            // Then: The callback was NOT invoked
            assert.strictEqual(callbackCount, 0, 'Callback should not be invoked after dispose');
        });
    });

    // -------------------------------------------------------------------------
    // unified-settings-creates-lanes-dir
    // -------------------------------------------------------------------------

    suite('set() creates the .lanes directory if it does not exist', () => {
        test('creates .lanes/settings.yaml including parent directories', async () => {
            // Given: A repoRoot with no .lanes directory
            assert.ok(
                !fs.existsSync(path.join(tempDir, '.lanes')),
                '.lanes directory should not exist initially'
            );

            await service.load(tempDir);

            // When: set() is called
            await service.set('lanes', 'worktreesFolder', 'custom');

            // Then: .lanes/settings.yaml is created
            const settingsPath = path.join(tempDir, '.lanes', 'settings.yaml');
            assert.ok(fs.existsSync(settingsPath), '.lanes/settings.yaml should be created');

            const content = fs.readFileSync(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown>;
            const lanes = parsed['lanes'] as Record<string, unknown>;
            assert.strictEqual(lanes['worktreesFolder'], 'custom');
        });
    });
});
