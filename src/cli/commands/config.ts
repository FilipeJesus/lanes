/**
 * `lanes config` — Get/set CLI configuration.
 */

import { Command } from 'commander';
import { initCli, exitWithError } from '../utils';
import { UnifiedSettingsService } from '../../core/services/UnifiedSettingsService';
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
        .action(async (options) => {
            try {
                const { repoRoot } = await initCli();

                // Build a dedicated UnifiedSettingsService for this invocation.
                const service = new UnifiedSettingsService();
                await service.migrateIfNeeded(repoRoot);
                await service.load(repoRoot);

                if (options.list || (!options.key && !options.value)) {
                    // List all config
                    console.log('Configuration (.lanes/settings.yaml):');
                    console.log('');
                    const all = service.getAll();
                    for (const key of VALID_KEYS) {
                        const flatKey = `lanes.${key}`;
                        const value = all[flatKey] ?? service.get('lanes', key, '(default)');
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

                if (options.value === undefined) {
                    // Get single value
                    const value = service.get('lanes', options.key, null);
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

                await service.set('lanes', options.key, parsedValue);
                service.dispose();

                console.log(`Set ${options.key} = ${JSON.stringify(parsedValue)}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') { throw err; }
                exitWithError(getErrorMessage(err));
            }
        });
}
