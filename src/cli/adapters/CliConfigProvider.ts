/**
 * CLI implementation of IConfigProvider.
 * Delegates to UnifiedSettingsService which reads from .lanes/settings.yaml.
 */

import type { IConfigProvider } from '../../core/interfaces/IConfigProvider';
import type { IDisposable } from '../../core/interfaces/IDisposable';
import { UnifiedSettingsService } from '../../core/services/UnifiedSettingsService';

export class CliConfigProvider implements IConfigProvider {
    private readonly service: UnifiedSettingsService;
    private readonly repoRoot: string;

    constructor(repoRoot: string) {
        this.repoRoot = repoRoot;
        this.service = new UnifiedSettingsService();
    }

    /**
     * Migrate legacy config files (if needed) then load settings from
     * .lanes/settings.yaml. Called once at startup.
     */
    async load(): Promise<void> {
        await this.service.migrateIfNeeded(this.repoRoot);
        await this.service.load(this.repoRoot);
    }

    get<T>(section: string, key: string, defaultValue: T): T {
        return this.service.get(section, key, defaultValue);
    }

    onDidChange(_section: string, _callback: () => void): IDisposable {
        // CLI is single-run — config changes don't happen mid-execution
        return { dispose: () => {} };
    }

    dispose(): void {
        this.service.dispose();
    }
}
