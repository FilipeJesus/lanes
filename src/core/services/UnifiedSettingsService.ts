/**
 * UnifiedSettingsService - Single source of truth for all adapter settings.
 *
 * Reads and writes a `.lanes/settings.yaml` file so that VS Code, CLI, and
 * JetBrains adapters all share the same configuration without duplicating
 * defaults or diverging formats.
 *
 * YAML structure (nested):
 * ```yaml
 * lanes:
 *   worktreesFolder: ".worktrees"
 *   polling:
 *     quietThresholdMs: 30000
 * ```
 *
 * Public API uses dot-notation section/key addressing that mirrors
 * the existing IConfigProvider interface for easy adapter delegation.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import type { IDisposable } from '../interfaces/IDisposable';
import { atomicWrite, ensureDir, fileExists, readJson } from './FileService';

// ---------------------------------------------------------------------------
// Unified defaults
// ---------------------------------------------------------------------------

/**
 * Flat-key defaults that mirror all adapter defaults.
 * Keys follow the `section.key` pattern (e.g., `lanes.worktreesFolder`).
 */
export const UNIFIED_DEFAULTS: Record<string, unknown> = {
    'lanes.worktreesFolder': '.worktrees',
    'lanes.defaultAgent': 'claude',
    'lanes.baseBranch': '',
    'lanes.includeUncommittedChanges': true,
    'lanes.localSettingsPropagation': 'copy',
    'lanes.customWorkflowsFolder': '.lanes/workflows',
    'lanes.terminalMode': 'vscode',
    'lanes.promptsFolder': '',
    'lanes.permissionMode': 'acceptEdits',
    'lanes.workflowsEnabled': true,
    'lanes.chimeSound': 'chime',
    'lanes.polling.quietThresholdMs': 3000,
};

// ---------------------------------------------------------------------------
// Helpers for nested object access via dot-notation sub-keys
// ---------------------------------------------------------------------------

/**
 * Set a value on a nested object using dot-notation path.
 * Creates intermediate objects as needed.
 * E.g., setNestedValue({}, 'polling.quietThresholdMs', 5000) => {polling: {quietThresholdMs: 5000}}
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function setNestedValue(obj: Record<string, unknown>, dotKey: string, value: unknown): void {
    const parts = dotKey.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (UNSAFE_KEYS.has(part)) { return; }
        if (
            current[part] === undefined ||
            current[part] === null ||
            typeof current[part] !== 'object'
        ) {
            current[part] = {};
        }
        current = current[part] as Record<string, unknown>;
    }
    const finalKey = parts[parts.length - 1];
    if (UNSAFE_KEYS.has(finalKey)) { return; }
    current[finalKey] = value;
}

/**
 * Convert a flat-key map (e.g., {'lanes.worktreesFolder': '.worktrees'})
 * to a nested object (e.g., {lanes: {worktreesFolder: '.worktrees'}}).
 */
function flatToNested(flat: Record<string, unknown>): Record<string, unknown> {
    const nested: Record<string, unknown> = {};
    for (const [flatKey, value] of Object.entries(flat)) {
        setNestedValue(nested, flatKey, value);
    }
    return nested;
}

/**
 * Convert a nested object to a flat-key map.
 * E.g., {lanes: {worktreesFolder: '.worktrees'}} => {'lanes.worktreesFolder': '.worktrees'}
 */
function nestedToFlat(
    obj: Record<string, unknown>,
    prefix = ''
): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(flat, nestedToFlat(value as Record<string, unknown>, fullKey));
        } else {
            flat[fullKey] = value;
        }
    }
    return flat;
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a JetBrains flat-key map (keys like `lanes.worktreesFolder`)
 * into a nested settings object. Skips keys that don't start with `lanes.`.
 */
function migrateJetBrainsConfig(
    raw: Record<string, unknown>
): Record<string, unknown> {
    const flat: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith('lanes.')) {
            flat[key] = value;
        }
    }
    return flatToNested(flat);
}

/**
 * Normalise a CLI config.json (flat keys under the `lanes` section, e.g.
 * `{worktreesFolder: '.worktrees'}`) into a nested settings object.
 */
function migrateCliConfig(raw: Record<string, unknown>): Record<string, unknown> {
    const nested: Record<string, unknown> = { lanes: {} };
    for (const [key, value] of Object.entries(raw)) {
        setNestedValue(nested, `lanes.${key}`, value);
    }
    return nested;
}

/**
 * Deep-merge `source` into `target`.  Values in `source` overwrite `target`.
 */
function deepMerge(
    target: Record<string, unknown>,
    source: Record<string, unknown>
): Record<string, unknown> {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
        if (UNSAFE_KEYS.has(key)) { continue; }
        if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            typeof result[key] === 'object' &&
            result[key] !== null &&
            !Array.isArray(result[key])
        ) {
            result[key] = deepMerge(
                result[key] as Record<string, unknown>,
                value as Record<string, unknown>
            );
        } else {
            result[key] = value;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// UnifiedSettingsService
// ---------------------------------------------------------------------------

export class UnifiedSettingsService {
    /** Absolute path to the .lanes/settings.yaml file. */
    private settingsPath: string | null = null;

    /** In-memory flat-key view of the loaded settings. */
    private settings: Record<string, unknown> = {};

    /** Active fs.FSWatcher instances (one per file being watched). */
    private watchers: fs.FSWatcher[] = [];

    // ---------------------------------------------------------------------------
    // Core API
    // ---------------------------------------------------------------------------

    /**
     * Load settings from `<repoRoot>/.lanes/settings.yaml`.
     * If the file does not exist, in-memory settings remain empty and defaults
     * are returned by `get()`.
     *
     * @param repoRoot Absolute path to the repository root.
     */
    async load(repoRoot: string): Promise<void> {
        if (!path.isAbsolute(repoRoot)) {
            throw new Error('UnifiedSettingsService: repoRoot must be an absolute path');
        }
        this.settingsPath = path.join(repoRoot, '.lanes', 'settings.yaml');
        this.settings = {};

        try {
            const content = await fsPromises.readFile(this.settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown> | null;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                // Flatten the nested YAML into our internal flat-key map.
                this.settings = nestedToFlat(parsed);
            }
        } catch (err: unknown) {
            if (
                err instanceof Error &&
                'code' in err &&
                (err as NodeJS.ErrnoException).code === 'ENOENT'
            ) {
                // File does not exist – that's fine, defaults will be used.
            } else {
                throw err;
            }
        }
    }

    /**
     * Get a settings value.
     *
     * Lookup order:
     * 1. Loaded settings.yaml value
     * 2. UNIFIED_DEFAULTS
     * 3. Caller-supplied `defaultValue`
     *
     * @param section Top-level config section, e.g. `'lanes'`.
     * @param key     Sub-key within the section, supports dot-notation for nesting,
     *                e.g. `'worktreesFolder'` or `'polling.quietThresholdMs'`.
     * @param defaultValue Fallback when no value is found.
     */
    get<T>(section: string, key: string, defaultValue: T): T {
        const flatKey = `${section}.${key}`;

        if (flatKey in this.settings) {
            return this.settings[flatKey] as T;
        }

        if (flatKey in UNIFIED_DEFAULTS) {
            return UNIFIED_DEFAULTS[flatKey] as T;
        }

        return defaultValue;
    }

    /**
     * Set a settings value and persist to `settings.yaml`.
     *
     * Requires `load()` to have been called first so we know the repo root.
     *
     * @param section Top-level config section, e.g. `'lanes'`.
     * @param key     Sub-key, supports dot-notation, e.g. `'polling.quietThresholdMs'`.
     * @param value   New value to store.
     */
    async set(section: string, key: string, value: unknown): Promise<void> {
        if (!this.settingsPath) {
            throw new Error(
                'UnifiedSettingsService: call load() before set()'
            );
        }

        const flatKey = `${section}.${key}`;
        this.settings[flatKey] = value;

        await this._persist();
    }

    /**
     * Set multiple values in a single disk write.
     */
    async setMany(entries: Array<{ section: string; key: string; value: unknown }>): Promise<void> {
        if (!this.settingsPath) {
            throw new Error('UnifiedSettingsService: call load() before setMany()');
        }
        for (const { section, key, value } of entries) {
            this.settings[`${section}.${key}`] = value;
        }
        await this._persist();
    }

    /**
     * Return all settings as a flat-key map, with defaults filled in for any
     * key that is present in UNIFIED_DEFAULTS but missing from the loaded file.
     */
    getAll(): Record<string, unknown> {
        return { ...UNIFIED_DEFAULTS, ...this.settings };
    }

    // ---------------------------------------------------------------------------
    // File watching
    // ---------------------------------------------------------------------------

    /**
     * Register a callback that fires whenever `settings.yaml` changes on disk.
     *
     * Returns a disposable that stops the watcher.
     *
     * @param callback Invoked when the file changes.
     */
    onDidChange(callback: () => void): IDisposable {
        if (!this.settingsPath) {
            return { dispose: () => {} };
        }

        const watchPath = this.settingsPath;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        let watcher: fs.FSWatcher;

        try {
            watcher = fs.watch(
                watchPath,
                { persistent: false },
                (_event: string) => {
                    if (debounceTimer !== null) {
                        clearTimeout(debounceTimer);
                    }
                    debounceTimer = setTimeout(() => {
                        debounceTimer = null;
                        callback();
                    }, 50);
                }
            );
        } catch {
            // File does not exist yet – return a no-op disposable.
            return { dispose: () => {} };
        }

        watcher.on('error', () => {});
        this.watchers.push(watcher);

        return {
            dispose: () => {
                if (debounceTimer !== null) {
                    clearTimeout(debounceTimer);
                }
                watcher.close();
                const idx = this.watchers.indexOf(watcher);
                if (idx !== -1) {
                    this.watchers.splice(idx, 1);
                }
            },
        };
    }

    /**
     * Close all active watchers. Call this when the service is no longer needed.
     */
    dispose(): void {
        for (const w of this.watchers) {
            w.close();
        }
        this.watchers = [];
    }

    // ---------------------------------------------------------------------------
    // Migration
    // ---------------------------------------------------------------------------

    /**
     * Check for legacy config files and migrate them into settings.yaml if it
     * does not yet exist.
     *
     * Migration sources (checked in order):
     * - `.lanes/config.json`          (CLI config, takes precedence in merge)
     * - `.lanes/jetbrains-ide-config.json`
     *
     * After migration the original files are left intact so that older adapter
     * versions can still read them.
     *
     * @param repoRoot Absolute path to the repository root.
     */
    async migrateIfNeeded(repoRoot: string): Promise<void> {
        if (!path.isAbsolute(repoRoot)) {
            throw new Error('UnifiedSettingsService: repoRoot must be an absolute path');
        }
        const settingsPath = path.join(repoRoot, '.lanes', 'settings.yaml');

        // Do nothing if settings.yaml already exists.
        if (await fileExists(settingsPath)) {
            return;
        }

        const cliConfigPath = path.join(repoRoot, '.lanes', 'config.json');
        const jetbrainsConfigPath = path.join(
            repoRoot,
            '.lanes',
            'jetbrains-ide-config.json'
        );

        const cliRaw = await readJson<Record<string, unknown>>(cliConfigPath);
        const jetbrainsRaw = await readJson<Record<string, unknown>>(
            jetbrainsConfigPath
        );

        if (!cliRaw && !jetbrainsRaw) {
            // Nothing to migrate.
            return;
        }

        let merged: Record<string, unknown> = {};

        if (jetbrainsRaw) {
            merged = deepMerge(merged, migrateJetBrainsConfig(jetbrainsRaw));
        }

        if (cliRaw) {
            // CLI takes precedence – merge on top of JetBrains values.
            merged = deepMerge(merged, migrateCliConfig(cliRaw));
        }

        await ensureDir(path.join(repoRoot, '.lanes'));
        await atomicWrite(settingsPath, yamlStringify(merged));
    }

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    /**
     * Serialise in-memory flat-key settings to nested YAML and write atomically.
     */
    private async _persist(): Promise<void> {
        if (!this.settingsPath) {
            throw new Error('UnifiedSettingsService: settingsPath is not set');
        }

        await ensureDir(path.dirname(this.settingsPath));

        // Build nested object from the flat-key settings.
        const nested = flatToNested(this.settings);
        const yaml = yamlStringify(nested);
        await atomicWrite(this.settingsPath, yaml);
    }
}
