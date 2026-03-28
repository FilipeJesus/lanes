/**
 * UnifiedSettingsService - Single source of truth for all adapter settings.
 *
 * Reads and writes a `.lanes/settings.yaml` file so that VS Code, CLI, and
 * daemon-backed tools all share the same configuration without duplicating
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
import * as os from 'os';
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

export type SettingsScope = 'global' | 'local';
export type SettingsView = SettingsScope | 'effective';

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
 * Normalise a legacy JetBrains flat-key map (keys like `lanes.worktreesFolder`)
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
    /** Absolute path to the machine-wide settings file. */
    private globalSettingsPath: string | null = null;

    /** Absolute path to the repo-local overrides file. */
    private localSettingsPath: string | null = null;

    /** In-memory flat-key view of global settings. */
    private globalSettings: Record<string, unknown> = {};

    /** In-memory flat-key view of local override settings. */
    private localSettings: Record<string, unknown> = {};

    /** Active fs.FSWatcher instances (one per file being watched). */
    private watchers: fs.FSWatcher[] = [];

    // ---------------------------------------------------------------------------
    // Core API
    // ---------------------------------------------------------------------------

    /**
     * Load settings from the machine-wide `~/.lanes/settings.yaml` file and
     * the repo-local `<repoRoot>/.lanes/settings.yaml` overrides file.
     * If either file does not exist, defaults are used as the final fallback.
     *
     * @param repoRoot Absolute path to the repository root.
     */
    async load(repoRoot: string): Promise<void> {
        if (!path.isAbsolute(repoRoot)) {
            throw new Error('UnifiedSettingsService: repoRoot must be an absolute path');
        }
        this.globalSettingsPath = path.join(os.homedir(), '.lanes', 'settings.yaml');
        this.localSettingsPath = path.join(repoRoot, '.lanes', 'settings.yaml');
        this.globalSettings = await this.readSettingsFile(this.globalSettingsPath);
        this.localSettings = await this.readSettingsFile(this.localSettingsPath);
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
        return this.getForView(section, key, defaultValue, 'effective');
    }

    getForView<T>(section: string, key: string, defaultValue: T, view: SettingsView = 'effective'): T {
        const flatKey = `${section}.${key}`;

        const scopedValue = this.getValueForView(flatKey, view);
        if (scopedValue !== undefined) {
            return scopedValue as T;
        }

        if (view === 'effective' && flatKey in UNIFIED_DEFAULTS) {
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
    async set(section: string, key: string, value: unknown, scope: SettingsScope = 'local'): Promise<void> {
        if (!this.localSettingsPath || !this.globalSettingsPath) {
            throw new Error(
                'UnifiedSettingsService: call load() before set()'
            );
        }

        const flatKey = `${section}.${key}`;
        if (scope === 'global') {
            this.globalSettings[flatKey] = value;
            this.pruneLocalOverride(flatKey);
            await this._persist('global');
            await this._persist('local');
            return;
        }

        if (this.valuesEqual(value, this.getInheritedValue(flatKey))) {
            delete this.localSettings[flatKey];
        } else {
            this.localSettings[flatKey] = value;
        }

        await this._persist('local');
    }

    /**
     * Set multiple values in a single disk write.
     */
    async setMany(
        entries: Array<{ section: string; key: string; value: unknown }>,
        scope: SettingsScope = 'local'
    ): Promise<void> {
        if (!this.localSettingsPath || !this.globalSettingsPath) {
            throw new Error('UnifiedSettingsService: call load() before setMany()');
        }
        for (const { section, key, value } of entries) {
            const flatKey = `${section}.${key}`;
            if (scope === 'global') {
                this.globalSettings[flatKey] = value;
                this.pruneLocalOverride(flatKey);
                continue;
            }

            if (this.valuesEqual(value, this.getInheritedValue(flatKey))) {
                delete this.localSettings[flatKey];
            } else {
                this.localSettings[flatKey] = value;
            }
        }
        await this._persist(scope);
        if (scope === 'global') {
            await this._persist('local');
        }
    }

    /**
     * Return all settings as a flat-key map, with defaults filled in for any
     * key that is present in UNIFIED_DEFAULTS but missing from the loaded file.
     */
    getAll(view: SettingsView = 'effective'): Record<string, unknown> {
        if (view === 'global') {
            return { ...this.globalSettings };
        }

        if (view === 'local') {
            return { ...this.localSettings };
        }

        return { ...UNIFIED_DEFAULTS, ...this.globalSettings, ...this.localSettings };
    }

    getGlobalSettings(): Record<string, unknown> {
        return this.getAll('global');
    }

    getLocalOverrides(): Record<string, unknown> {
        return this.getAll('local');
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
        const watchPaths = [this.globalSettingsPath, this.localSettingsPath]
            .filter((watchPath): watchPath is string => Boolean(watchPath));

        if (watchPaths.length === 0) {
            return { dispose: () => {} };
        }
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        const createdWatchers: fs.FSWatcher[] = [];

        for (const watchPath of watchPaths) {
            try {
                const watcher = fs.watch(
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
                watcher.on('error', () => {});
                this.watchers.push(watcher);
                createdWatchers.push(watcher);
            } catch {
                // File does not exist yet – skip this watcher.
            }
        }

        if (createdWatchers.length === 0) {
            return { dispose: () => {} };
        }

        return {
            dispose: () => {
                if (debounceTimer !== null) {
                    clearTimeout(debounceTimer);
                }
                for (const watcher of createdWatchers) {
                    watcher.close();
                    const idx = this.watchers.indexOf(watcher);
                    if (idx !== -1) {
                        this.watchers.splice(idx, 1);
                    }
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
     * - `.lanes/config.json`               (CLI config, takes precedence in merge)
     * - `.lanes/jetbrains-ide-config.json` (legacy JetBrains config)
     *
     * After migration the original files are left intact so that older
     * installs can still read them if needed.
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
            // CLI takes precedence over legacy JetBrains values.
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
    private async _persist(scope: SettingsScope): Promise<void> {
        const settingsPath = scope === 'global' ? this.globalSettingsPath : this.localSettingsPath;
        const settings = scope === 'global' ? this.globalSettings : this.localSettings;

        if (!settingsPath) {
            throw new Error('UnifiedSettingsService: settingsPath is not set');
        }

        if (Object.keys(settings).length === 0) {
            await fsPromises.unlink(settingsPath).catch(() => {});
            return;
        }

        await ensureDir(path.dirname(settingsPath));

        // Build nested object from the flat-key settings.
        const nested = flatToNested(settings);
        const yaml = yamlStringify(nested);
        await atomicWrite(settingsPath, yaml);
    }

    private async readSettingsFile(settingsPath: string): Promise<Record<string, unknown>> {
        try {
            const content = await fsPromises.readFile(settingsPath, 'utf-8');
            const parsed = yamlParse(content) as Record<string, unknown> | null;
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return nestedToFlat(parsed);
            }
            return {};
        } catch (err: unknown) {
            if (
                err instanceof Error &&
                'code' in err &&
                (err as NodeJS.ErrnoException).code === 'ENOENT'
            ) {
                return {};
            }
            throw err;
        }
    }

    private getInheritedValue(flatKey: string): unknown {
        if (flatKey in this.globalSettings) {
            return this.globalSettings[flatKey];
        }
        return UNIFIED_DEFAULTS[flatKey];
    }

    private getValueForView(flatKey: string, view: SettingsView): unknown {
        if (view === 'local') {
            return this.localSettings[flatKey];
        }

        if (view === 'global') {
            return this.globalSettings[flatKey];
        }

        if (flatKey in this.localSettings) {
            return this.localSettings[flatKey];
        }

        return this.globalSettings[flatKey];
    }

    private pruneLocalOverride(flatKey: string): void {
        if (flatKey in this.localSettings && this.valuesEqual(this.localSettings[flatKey], this.getInheritedValue(flatKey))) {
            delete this.localSettings[flatKey];
        }
    }

    private valuesEqual(a: unknown, b: unknown): boolean {
        return JSON.stringify(a) === JSON.stringify(b);
    }
}
