/**
 * Configuration Store - YAML-backed configuration for JetBrains IDE plugin
 *
 * Delegates to UnifiedSettingsService which reads/writes .lanes/settings.yaml
 * so that VS Code, CLI, and JetBrains adapters all share the same config file.
 */

import { UnifiedSettingsService, UNIFIED_DEFAULTS } from '../core/services/UnifiedSettingsService';

/**
 * Keys accepted by the config.get / config.set JSON-RPC handlers.
 * Used for validation in handlers.ts — kept here for co-location with the store.
 */
const VALID_CONFIG_KEYS = new Set([
    'lanes.worktreesFolder',
    'lanes.promptsFolder',
    'lanes.defaultAgent',
    'lanes.baseBranch',
    'lanes.includeUncommittedChanges',
    'lanes.localSettingsPropagation',
    'lanes.workflowsEnabled',
    'lanes.customWorkflowsFolder',
    'lanes.chimeSound',
    'lanes.polling.quietThresholdMs',
    'lanes.terminalMode',
    // Internal / non-schema keys also used by handlers
    'lanes.pinnedSessions',
]);

/**
 * ConfigStore manages configuration persistence via UnifiedSettingsService.
 *
 * The store uses flat-key addressing to remain backward-compatible with the
 * existing handlers.ts code which calls:
 *   `configStore.get('lanes.worktreesFolder')`
 *   `configStore.set('lanes.worktreesFolder', value)`
 *   `configStore.getAll('lanes.')`
 */
export class ConfigStore {
    private readonly workspaceRoot: string;
    private readonly service: UnifiedSettingsService;
    private initialized = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.service = new UnifiedSettingsService();
    }

    /**
     * Initialize the config store by migrating legacy config files (if any)
     * and then loading from .lanes/settings.yaml.
     */
    async initialize(): Promise<void> {
        await this.service.migrateIfNeeded(this.workspaceRoot);
        await this.service.load(this.workspaceRoot);
        this.initialized = true;
    }

    /**
     * Get a configuration value by flat key (e.g. 'lanes.worktreesFolder').
     *
     * Special-cases:
     * - 'lanes.terminalMode': normalises legacy 'code' value to 'vscode'.
     */
    get(key: string): unknown {
        if (!this.initialized) {
            throw new Error('ConfigStore not initialized');
        }

        // Split the flat key into section + sub-key for UnifiedSettingsService.
        // Keys always follow the 'section.rest' pattern.
        const dotIdx = key.indexOf('.');
        if (dotIdx === -1) {
            // No dot — return unified default or undefined.
            return UNIFIED_DEFAULTS[key] ?? undefined;
        }

        const section = key.substring(0, dotIdx);
        const subKey = key.substring(dotIdx + 1);

        const value = this.service.get<unknown>(section, subKey, undefined);

        if (key === 'lanes.terminalMode' && value === 'code') {
            return 'vscode';
        }

        return value;
    }

    /**
     * Set a configuration value by flat key and persist to settings.yaml.
     *
     * Special-cases:
     * - 'lanes.terminalMode': normalises legacy 'code' value to 'vscode'.
     */
    async set(key: string, value: unknown): Promise<void> {
        if (!this.initialized) {
            throw new Error('ConfigStore not initialized');
        }

        const dotIdx = key.indexOf('.');
        if (dotIdx === -1) {
            throw new Error(`ConfigStore.set: key '${key}' must contain a dot separator`);
        }

        const section = key.substring(0, dotIdx);
        const subKey = key.substring(dotIdx + 1);

        const normalised = (key === 'lanes.terminalMode' && value === 'code') ? 'vscode' : value;
        await this.service.set(section, subKey, normalised);
    }

    /**
     * Get all configuration values as a flat-key map.
     *
     * @param prefix Optional prefix filter (e.g. 'lanes.'). Only keys that
     *               start with the prefix are included in the result.
     */
    getAll(prefix?: string): Record<string, unknown> {
        if (!this.initialized) {
            throw new Error('ConfigStore not initialized');
        }

        const all = this.service.getAll();

        if (!prefix) {
            return all;
        }

        const filtered: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(all)) {
            if (k.startsWith(prefix)) {
                filtered[k] = v;
            }
        }
        return filtered;
    }

    /**
     * Dispose resources (file watchers) held by the underlying service.
     */
    dispose(): void {
        this.service.dispose();
    }

    /**
     * Register a callback that fires when settings.yaml changes externally.
     * Returns a disposable.
     */
    onDidChange(callback: () => void): { dispose: () => void } {
        return this.service.onDidChange(callback);
    }

    /** Expose the set of valid config keys for handlers validation. */
    static get validKeys(): ReadonlySet<string> {
        return VALID_CONFIG_KEYS;
    }
}
