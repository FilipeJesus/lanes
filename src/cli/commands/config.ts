/**
 * `lanes config` — Get/set CLI configuration.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError } from '../utils';
import { readJson, ensureDir } from '../../core/services/FileService';
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
                const { config, repoRoot } = await initCli();
                const configPath = path.join(repoRoot, '.lanes', 'config.json');

                if (options.list || (!options.key && !options.value)) {
                    // List all config
                    console.log('Configuration (.lanes/config.json):');
                    console.log('');
                    for (const key of VALID_KEYS) {
                        const value = config.get('lanes', key, '(default)');
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

                if (options.value === undefined) {
                    // Get single value
                    const value = config.get('lanes', options.key, null);
                    console.log(JSON.stringify(value));
                    return;
                }

                // Set value
                let existing = await readJson<Record<string, unknown>>(configPath) || {};
                let parsedValue: unknown = options.value;

                // Parse boolean and number values
                if (options.value === 'true') {parsedValue = true;}
                else if (options.value === 'false') {parsedValue = false;}
                else if (!isNaN(Number(options.value)) && options.value.trim() !== '') {
                    parsedValue = Number(options.value);
                }

                existing[options.key] = parsedValue;

                await ensureDir(path.dirname(configPath));
                await fsPromises.writeFile(configPath, JSON.stringify(existing, null, 2), 'utf-8');

                console.log(`Set ${options.key} = ${JSON.stringify(parsedValue)}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
