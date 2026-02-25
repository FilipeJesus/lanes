/**
 * CLI implementation of IConfigProvider.
 * Reads configuration from .lanes/config.json in the repo root.
 */

import * as path from 'path';
import type { IConfigProvider } from '../../core/interfaces/IConfigProvider';
import type { IDisposable } from '../../core/interfaces/IDisposable';
import { readJson } from '../../core/services/FileService';

/** Default config values matching VS Code extension defaults */
const DEFAULTS: Record<string, Record<string, unknown>> = {
    lanes: {
        worktreesFolder: '.worktrees',
        defaultAgent: 'claude',
        baseBranch: '',
        includeUncommittedChanges: true,
        localSettingsPropagation: 'copy',
        customWorkflowsFolder: '.lanes/workflows',
        terminalMode: 'vscode',
        useGlobalStorage: false,  // CLI always uses local storage
        promptsFolder: '',
        permissionMode: 'acceptEdits',
    },
};

export class CliConfigProvider implements IConfigProvider {
    private config: Record<string, unknown> | null = null;
    private readonly repoRoot: string;

    constructor(repoRoot: string) {
        this.repoRoot = repoRoot;
    }

    /**
     * Load config from .lanes/config.json. Called once at startup.
     */
    async load(): Promise<void> {
        const configPath = path.join(this.repoRoot, '.lanes', 'config.json');
        this.config = await readJson<Record<string, unknown>>(configPath);
    }

    get<T>(section: string, key: string, defaultValue: T): T {
        // Try loaded config first
        if (this.config && key in this.config) {
            return this.config[key] as T;
        }
        // Fall back to defaults
        const sectionDefaults = DEFAULTS[section];
        if (sectionDefaults && key in sectionDefaults) {
            return sectionDefaults[key] as T;
        }
        return defaultValue;
    }

    onDidChange(_section: string, _callback: () => void): IDisposable {
        // CLI is single-run — config changes don't happen mid-execution
        return { dispose: () => {} };
    }
}
