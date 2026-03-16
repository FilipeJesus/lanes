/**
 * `lanes config` — Get/set CLI configuration.
 */

import { Command } from 'commander';
import { addDaemonHostOption, createCliDaemonClient, initCli, exitWithError } from '../utils';
import { SettingsScope, SettingsView, UnifiedSettingsService } from '../../core/services/UnifiedSettingsService';
import { getErrorMessage } from '../../core/utils';

const VALID_KEYS = [
    'worktreesFolder',
    'defaultAgent',
    'baseBranch',
    'includeUncommittedChanges',
    'localSettingsPropagation',
    'customWorkflowsFolder',
    'terminalMode',
    'permissionMode',
];

export function registerConfigCommand(program: Command): void {
    addDaemonHostOption(program
        .command('config')
        .description('Get or set configuration values')
        .option('--key <key>', 'Configuration key to get or set')
        .option('--value <value>', 'Value to set (omit to get current value)')
        .option('--list', 'List all configuration values')
        .option('--scope <scope>', 'Configuration scope: effective, global, or local', 'effective'))
        .action(async (options) => {
            try {
                const { repoRoot } = await initCli();
                const view = parseConfigView(options.scope);

                if (options.host) {
                    const client = await createCliDaemonClient(repoRoot, options);

                    if (options.list || (!options.key && !options.value)) {
                        console.log(`Configuration (${describeScope(view)}):`);
                        console.log('');
                        const all = await client.getAllConfig(view);
                        for (const key of VALID_KEYS) {
                            const fullKey = `lanes.${key}`;
                            const value = all.config[fullKey] ?? null;
                            console.log(`  ${key}: ${JSON.stringify(value)}`);
                        }
                        return;
                    }

                    if (!options.key) {
                        exitWithError('--key is required when setting a value.');
                    }

                    if (!VALID_KEYS.includes(options.key)) {
                        exitWithError(`Unknown key '${options.key}'. Valid keys: ${VALID_KEYS.join(', ')}`);
                    }

                    if (options.value !== undefined && view === 'effective') {
                        exitWithError('Use --scope global or --scope local when setting a value.');
                    }

                    const fullKey = `lanes.${options.key}`;
                    if (options.value === undefined) {
                        const response = await client.getConfig(fullKey, view);
                        console.log(JSON.stringify(response.value));
                        return;
                    }

                    let parsedValue: unknown = options.value;
                    if (options.value === 'true') { parsedValue = true; }
                    else if (options.value === 'false') { parsedValue = false; }
                    else if (!isNaN(Number(options.value)) && options.value.trim() !== '') {
                        parsedValue = Number(options.value);
                    }

                    await client.setConfig(fullKey, parsedValue, view as SettingsScope);
                    console.log(`Set ${options.key} = ${JSON.stringify(parsedValue)} (${describeScope(view)})`);
                    return;
                }

                // Build a dedicated UnifiedSettingsService for this invocation.
                const service = new UnifiedSettingsService();
                await service.migrateIfNeeded(repoRoot);
                await service.load(repoRoot);

                if (options.list || (!options.key && !options.value)) {
                    // List all config
                    console.log(`Configuration (${describeScope(view)}):`);
                    console.log('');
                    const all = service.getAll(view);
                    for (const key of VALID_KEYS) {
                        const flatKey = `lanes.${key}`;
                        const value = all[flatKey] ?? service.getForView('lanes', key, '(default)', view);
                        console.log(`  ${key}: ${JSON.stringify(value)}`);
                    }
                    service.dispose();
                    return;
                }

                if (!options.key) {
                    service.dispose();
                    exitWithError('--key is required when setting a value.');
                }

                if (!VALID_KEYS.includes(options.key)) {
                    service.dispose();
                    exitWithError(`Unknown key '${options.key}'. Valid keys: ${VALID_KEYS.join(', ')}`);
                }

                if (options.value !== undefined && view === 'effective') {
                    service.dispose();
                    exitWithError('Use --scope global or --scope local when setting a value.');
                }

                if (options.value === undefined) {
                    // Get single value
                    const value = service.getForView('lanes', options.key, null, view);
                    console.log(JSON.stringify(value));
                    service.dispose();
                    return;
                }

                // Set value — parse boolean and number strings.
                let parsedValue: unknown = options.value;
                if (options.value === 'true') { parsedValue = true; }
                else if (options.value === 'false') { parsedValue = false; }
                else if (!isNaN(Number(options.value)) && options.value.trim() !== '') {
                    parsedValue = Number(options.value);
                }

                await service.set('lanes', options.key, parsedValue, view as SettingsScope);
                service.dispose();

                console.log(`Set ${options.key} = ${JSON.stringify(parsedValue)} (${describeScope(view)})`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') { throw err; }
                exitWithError(getErrorMessage(err));
            }
        });
}

function parseConfigView(scope: unknown): SettingsView {
    if (scope === 'effective' || scope === 'global' || scope === 'local') {
        return scope;
    }
    exitWithError('Invalid --scope value. Valid scopes: effective, global, local');
}

function describeScope(scope: SettingsView): string {
    if (scope === 'global') {
        return '~/.lanes/settings.yaml';
    }
    if (scope === 'local') {
        return '.lanes/settings.yaml overrides';
    }
    return 'effective merged view';
}
