/**
 * CLI implementation of IStorageProvider.
 * Uses .lanes/ directory in the repo for all storage.
 */

import * as path from 'path';
import type { IStorageProvider } from '../../core/interfaces';

export class CliStorageProvider implements IStorageProvider {
    private readonly repoRoot: string;
    private readonly state: Map<string, unknown> = new Map();

    constructor(repoRoot: string) {
        this.repoRoot = repoRoot;
    }

    getGlobalStoragePath(): string {
        // CLI uses repo-local storage instead of VS Code global storage
        return path.join(this.repoRoot, '.lanes');
    }

    getWorkspaceState<T>(key: string, defaultValue: T): T {
        if (this.state.has(key)) {
            return this.state.get(key) as T;
        }
        return defaultValue;
    }

    async setWorkspaceState<T>(key: string, value: T): Promise<void> {
        this.state.set(key, value);
    }
}
