/**
 * DaemonConfigStore - JSON-backed configuration for the standalone HTTP daemon
 *
 * Since the daemon doesn't have access to the VS Code settings API, it stores
 * configuration in a JSON file at `.lanes/daemon-config.json` in the workspace root.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { ISimpleConfigStore } from '../core/interfaces/IHandlerContext';

/**
 * Default configuration values matching package.json schema
 */
const DEFAULT_CONFIG: Record<string, unknown> = {
    'lanes.worktreesFolder': '.worktrees',
    'lanes.promptsFolder': '',
    'lanes.defaultAgent': 'claude',
    'lanes.baseBranch': '',
    'lanes.includeUncommittedChanges': true,
    'lanes.localSettingsPropagation': 'copy',
    'lanes.workflowsEnabled': true,
    'lanes.customWorkflowsFolder': '.lanes/workflows',
    'lanes.chimeSound': true,
    'lanes.polling.quietThresholdMs': 3000,
    'lanes.terminalMode': 'vscode'
};

/**
 * DaemonConfigStore manages configuration persistence to a JSON file.
 * Implements ISimpleConfigStore for use with SessionHandlerService.
 */
export class DaemonConfigStore implements ISimpleConfigStore {
    private configPath: string;
    private config: Record<string, unknown> = {};
    private initialized = false;

    constructor(workspaceRoot: string) {
        this.configPath = path.join(workspaceRoot, '.lanes', 'daemon-config.json');
    }

    /**
     * Initialize the config store by loading from disk or creating with defaults.
     */
    async initialize(): Promise<void> {
        try {
            // Try to read existing config
            const content = await fs.readFile(this.configPath, 'utf-8');
            this.config = JSON.parse(content);
        } catch (err) {
            this.config = { ...DEFAULT_CONFIG };
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                // File doesn't exist — save defaults
                try {
                    await this.save();
                } catch (saveErr) {
                    console.warn(`Could not save config defaults: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`);
                }
            } else {
                // Permission error, corrupt JSON, etc. — use defaults but don't overwrite
                console.warn(`Could not load config (${err instanceof Error ? err.message : String(err)}), using defaults`);
            }
        }
        this.initialized = true;
    }

    /**
     * Save configuration to disk.
     */
    private async save(): Promise<void> {
        const dir = path.dirname(this.configPath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    }

    /**
     * Get a configuration value.
     */
    get(key: string): unknown {
        if (!this.initialized) {
            throw new Error('DaemonConfigStore not initialized');
        }
        const value = this.config[key] ?? DEFAULT_CONFIG[key];
        if (key === 'lanes.terminalMode' && value === 'code') {
            return 'vscode';
        }
        return value;
    }

    /**
     * Set a configuration value and persist to disk.
     */
    async set(key: string, value: unknown): Promise<void> {
        if (!this.initialized) {
            throw new Error('DaemonConfigStore not initialized');
        }
        this.config[key] = (key === 'lanes.terminalMode' && value === 'code') ? 'vscode' : value;
        await this.save();
    }

    /**
     * Get all configuration values.
     */
    getAll(prefix?: string): Record<string, unknown> {
        if (!this.initialized) {
            throw new Error('DaemonConfigStore not initialized');
        }

        if (!prefix) {
            return { ...this.config };
        }

        // Filter by prefix
        const filtered: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(this.config)) {
            if (key.startsWith(prefix)) {
                filtered[key] = value;
            }
        }
        return filtered;
    }
}
