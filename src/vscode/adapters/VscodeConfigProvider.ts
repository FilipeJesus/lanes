/**
 * VS Code implementation of IConfigProvider.
 *
 * Bridge mode: delegates to UnifiedSettingsService (.lanes/settings.yaml) as
 * the single source of truth.
 *
 * Bidirectional sync:
 * - On initialization, if settings.yaml does not yet exist, seeds it from the
 *   current VS Code workspace settings.
 * - When VSCode settings change (onDidChangeConfiguration), writes the new
 *   value to settings.yaml and reloads.
 * - When settings.yaml changes externally, fires the registered onDidChange
 *   callbacks so the rest of the extension reacts.
 */

import * as vscode from 'vscode';
import type { IConfigProvider } from '../../core/interfaces/IConfigProvider';
import type { IDisposable } from '../../core/interfaces/IDisposable';
import { UnifiedSettingsService, UNIFIED_DEFAULTS } from '../../core/services/UnifiedSettingsService';
import { fileExists } from '../../core/services/FileService';
import * as path from 'path';

/**
 * All setting keys that live under the 'lanes' section in package.json.
 * Used when seeding settings.yaml from VS Code settings on first init and when
 * listening for onDidChangeConfiguration events.
 */
const LANES_SETTING_KEYS: ReadonlyArray<string> = [
    'worktreesFolder',
    'defaultAgent',
    'baseBranch',
    'includeUncommittedChanges',
    'localSettingsPropagation',
    'customWorkflowsFolder',
    'terminalMode',
    'promptsFolder',
    'permissionMode',
    'workflowsEnabled',
    'chimeSound',
    'polling.quietThresholdMs',
];

export class VscodeConfigProvider implements IConfigProvider {
    private readonly service: UnifiedSettingsService;
    /** Change callbacks keyed by section name. */
    private readonly changeCallbacks: Map<string, Set<() => void>> = new Map();
    /** Disposables owned by this provider (VSCode and file watchers). */
    private readonly ownDisposables: vscode.Disposable[] = [];
    /** Guard to prevent feedback loop between VSCode writes and file watcher. */
    private _writingFromVscode = false;

    constructor() {
        this.service = new UnifiedSettingsService();
    }

    /**
     * Initialize the provider for a given repo root.
     *
     * 1. Migrates legacy config files (if any) to settings.yaml.
     * 2. If settings.yaml does not yet exist, seeds it from VS Code settings.
     * 3. Loads settings.yaml.
     * 4. Registers VS Code and file-system change listeners.
     *
     * Call this once after construction, before calling get().
     * Safe to call when repoRoot is unknown (undefined) — acts as a no-op in
     * that case and falls back purely to VS Code settings.
     *
     * @param repoRoot Absolute path to the repository root.
     */
    async initialize(repoRoot: string): Promise<void> {
        // Step 1 – migrate legacy files if settings.yaml does not exist yet.
        await this.service.migrateIfNeeded(repoRoot);

        // Step 2 – load settings.yaml first so that settingsPath is initialized
        // in the service (required before any call to set()).
        await this.service.load(repoRoot);

        // Step 3 – if settings.yaml still doesn't exist after migration, seed it
        // from VS Code settings so that user-customised values are captured.
        const settingsPath = path.join(repoRoot, '.lanes', 'settings.yaml');
        if (!await fileExists(settingsPath)) {
            const hasGlobalSettings = Object.keys(this.service.getGlobalSettings()).length > 0;
            await this._seedFromVscodeSettings(hasGlobalSettings ? 'workspaceOnly' : 'all');
        }

        // Step 4a – watch settings.yaml for external changes (not our own writes).
        const fileWatcherDisposable = this.service.onDidChange(async () => {
            if (this._writingFromVscode) { return; }
            await this.service.load(repoRoot);
            this._fireAllCallbacks();
        });
        // Wrap in a vscode.Disposable-compatible shape so it lives in ownDisposables.
        this.ownDisposables.push({
            dispose: () => fileWatcherDisposable.dispose()
        });

        // Step 4b – when VS Code settings change, batch-write to settings.yaml.
        const vsCodeWatcher = vscode.workspace.onDidChangeConfiguration(async (event) => {
            if (!event.affectsConfiguration('lanes')) {
                return;
            }

            const entries: Array<{ section: string; key: string; value: unknown }> = [];
            for (const key of LANES_SETTING_KEYS) {
                if (event.affectsConfiguration(`lanes.${key}`)) {
                    const vscodeValue = vscode.workspace
                        .getConfiguration('lanes')
                        .get<unknown>(key);
                    if (vscodeValue !== undefined) {
                        entries.push({ section: 'lanes', key, value: vscodeValue });
                    }
                }
            }

            if (entries.length > 0) {
                this._writingFromVscode = true;
                try {
                    await this.service.setMany(entries);
                    await this.service.load(repoRoot);
                } finally {
                    setTimeout(() => { this._writingFromVscode = false; }, 100);
                }
            }
            this._fireCallbacksForSection('lanes');
        });
        this.ownDisposables.push(vsCodeWatcher);
    }

    // ---------------------------------------------------------------------------
    // IConfigProvider
    // ---------------------------------------------------------------------------

    /**
     * Get a configuration value.
     *
     * Delegates to UnifiedSettingsService (settings.yaml) first. Falls back to
     * VS Code workspace configuration if the service is not yet initialized or
     * the key is not found in the YAML file.
     */
    get<T>(section: string, key: string, defaultValue: T): T {
        return this.service.get(section, key, defaultValue);
    }

    /**
     * Register a callback for configuration changes in the given section.
     *
     * The callback is fired when:
     * - VS Code workspace settings change for the section.
     * - settings.yaml changes on disk.
     */
    onDidChange(section: string, callback: () => void): IDisposable {
        if (!this.changeCallbacks.has(section)) {
            this.changeCallbacks.set(section, new Set());
        }
        this.changeCallbacks.get(section)!.add(callback);

        return {
            dispose: () => {
                this.changeCallbacks.get(section)?.delete(callback);
            }
        };
    }

    /**
     * Dispose all owned resources (VS Code listeners, file watchers).
     */
    dispose(): void {
        for (const d of this.ownDisposables) {
            d.dispose();
        }
        this.ownDisposables.length = 0;
        this.service.dispose();
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /**
     * Seed settings.yaml with current VS Code workspace values for all tracked
     * Lanes settings keys. Only called when settings.yaml doesn't yet exist so
     * we don't overwrite user-managed YAML files.
     */
    private async _seedFromVscodeSettings(mode: 'all' | 'workspaceOnly'): Promise<void> {
        const vsConfig = vscode.workspace.getConfiguration('lanes');
        const entries: Array<{ section: string; key: string; value: unknown }> = [];
        for (const key of LANES_SETTING_KEYS) {
            const flatKey = `lanes.${key}`;
            let value: unknown;

            if (mode === 'workspaceOnly') {
                const inspected = vsConfig.inspect<unknown>(key);
                value = inspected?.workspaceFolderValue ?? inspected?.workspaceValue;
            } else {
                const vscodeValue = vsConfig.get<unknown>(key);
                value = vscodeValue !== undefined
                    ? vscodeValue
                    : UNIFIED_DEFAULTS[flatKey];
            }

            if (value !== undefined) {
                entries.push({ section: 'lanes', key, value });
            }
        }
        if (entries.length > 0) {
            await this.service.setMany(entries);
        }
    }

    private _fireCallbacksForSection(section: string): void {
        const callbacks = this.changeCallbacks.get(section);
        if (callbacks) {
            for (const cb of callbacks) {
                cb();
            }
        }
    }

    private _fireAllCallbacks(): void {
        for (const [, callbacks] of this.changeCallbacks) {
            for (const cb of callbacks) {
                cb();
            }
        }
    }
}
