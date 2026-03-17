/**
 * `lanes config` — Get/set CLI configuration.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { SettingsScope, SettingsView } from '../../core/services/UnifiedSettingsService';
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
    program
        .command('config')
        .description('Get or set configuration values')
        .option('--key <key>', 'Configuration key to get or set')
        .option('--value <value>', 'Value to set (omit to get current value)')
        .option('--list', 'List all configuration values')
        .option('--scope <scope>', 'Configuration scope: effective, global, or local', 'effective')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                const view = parseConfigView(options.scope);
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    if (options.list || (!options.key && !options.value)) {
                        console.log(`Configuration (${describeScope(view)}):`);
                        console.log('');
                        const all = await operations.listConfig(view);
                        for (const key of VALID_KEYS) {
                            const fullKey = `lanes.${key}`;
                            const value = all[fullKey] ?? null;
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
                        const value = await operations.getConfig(fullKey, view);
                        console.log(JSON.stringify(value));
                        return;
                    }

                    let parsedValue: unknown = options.value;
                    if (options.value === 'true') { parsedValue = true; }
                    else if (options.value === 'false') { parsedValue = false; }
                    else if (!isNaN(Number(options.value)) && options.value.trim() !== '') {
                        parsedValue = Number(options.value);
                    }

                    await operations.setConfig(fullKey, parsedValue, view as SettingsScope);
                    console.log(`Set ${options.key} = ${JSON.stringify(parsedValue)} (${describeScope(view)})`);
                });
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
