/**
 * DaemonConfigStore - unified layered configuration for daemon-backed clients.
 *
 * Delegates to UnifiedSettingsService so daemon, CLI, and IDE adapters all
 * resolve the same global settings plus repo-local override model.
 */

import * as path from 'path';
import { ISimpleConfigStore } from '../core/interfaces/IHandlerContext';
import {
    SettingsScope,
    SettingsView,
    UnifiedSettingsService,
} from '../core/services/UnifiedSettingsService';
import { fileExists, readJson } from '../core/services/FileService';

export class DaemonConfigStore implements ISimpleConfigStore {
    private readonly workspaceRoot: string;
    private readonly service: UnifiedSettingsService;
    private initialized = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.service = new UnifiedSettingsService();
    }

    async initialize(): Promise<void> {
        await this.service.migrateIfNeeded(this.workspaceRoot);
        await this.service.load(this.workspaceRoot);
        await this.migrateLegacyDaemonConfigIfNeeded();
        this.initialized = true;
    }

    get(key: string, scope: SettingsView = 'effective'): unknown {
        if (!this.initialized) {
            throw new Error('DaemonConfigStore not initialized');
        }

        const { section, subKey } = splitConfigKey(key);
        const value = this.service.getForView(section, subKey, undefined, scope);
        if (key === 'lanes.terminalMode' && value === 'code') {
            return 'vscode';
        }
        return value;
    }

    async set(key: string, value: unknown, scope: SettingsScope = 'local'): Promise<void> {
        if (!this.initialized) {
            throw new Error('DaemonConfigStore not initialized');
        }

        const { section, subKey } = splitConfigKey(key);
        const normalizedValue = (key === 'lanes.terminalMode' && value === 'code') ? 'vscode' : value;
        await this.service.set(section, subKey, normalizedValue, scope);
    }

    getAll(prefix?: string, scope: SettingsView = 'effective'): Record<string, unknown> {
        if (!this.initialized) {
            throw new Error('DaemonConfigStore not initialized');
        }

        const all = this.service.getAll(scope);
        if (!prefix) {
            return all;
        }

        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(all)) {
            if (key.startsWith(prefix)) {
                filtered[key] = value;
            }
        }
        return filtered;
    }

    dispose(): void {
        this.service.dispose();
    }

    private async migrateLegacyDaemonConfigIfNeeded(): Promise<void> {
        const localSettingsPath = path.join(this.workspaceRoot, '.lanes', 'settings.yaml');
        if (await fileExists(localSettingsPath)) {
            return;
        }

        const legacyPath = path.join(this.workspaceRoot, '.lanes', 'daemon-config.json');
        const legacyConfig = await readJson<Record<string, unknown>>(legacyPath);
        if (!legacyConfig) {
            return;
        }

        const entries: Array<{ section: string; key: string; value: unknown }> = [];
        for (const [flatKey, value] of Object.entries(legacyConfig)) {
            if (!flatKey.startsWith('lanes.')) {
                continue;
            }
            const { section, subKey } = splitConfigKey(flatKey);
            entries.push({
                section,
                key: subKey,
                value: flatKey === 'lanes.terminalMode' && value === 'code' ? 'vscode' : value,
            });
        }

        if (entries.length > 0) {
            await this.service.setMany(entries, 'local');
            await this.service.load(this.workspaceRoot);
        }
    }
}

function splitConfigKey(key: string): { section: string; subKey: string } {
    const dotIndex = key.indexOf('.');
    if (dotIndex === -1) {
        throw new Error(`DaemonConfigStore: key '${key}' must contain a dot separator`);
    }

    return {
        section: key.slice(0, dotIndex),
        subKey: key.slice(dotIndex + 1),
    };
}
