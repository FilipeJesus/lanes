/**
 * `lanes workflow` — Workflow template management.
 */

import { Command } from 'commander';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError } from '../utils';
import { withCliOperations } from '../operations';
import { getErrorMessage } from '../../core/utils';

export function registerWorkflowCommand(program: Command): void {
    const workflow = program
        .command('workflow')
        .description('Manage workflow templates');

    workflow
        .command('list')
        .description('List available workflow templates')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const templates = await operations.listWorkflows();

                    if (options.json) {
                        console.log(JSON.stringify(templates, null, 2));
                        return;
                    }

                    if (templates.length === 0) {
                        console.log('No workflow templates found.');
                        if (operations.targetKind === 'local') {
                            console.log(`Create one in ${config.get('lanes', 'customWorkflowsFolder', '.lanes/workflows')}/`);
                        }
                        return;
                    }

                    console.log(`${'NAME'.padEnd(25)} ${'SOURCE'.padEnd(12)} DESCRIPTION`);
                    console.log('-'.repeat(70));
                    for (const template of templates) {
                        const source = template.isBuiltin ? 'built-in' : 'custom';
                        console.log(`${template.name.padEnd(25)} ${source.padEnd(12)} ${template.description || ''}`);
                    }
                });
            } catch (err) {
                exitWithError(getErrorMessage(err));
            }
        });

    workflow
        .command('create')
        .description('Create a new workflow template')
        .requiredOption('--name <name>', 'Workflow name')
        .option('--from <template>', 'Base template to copy from')
        .action(async (options) => {
            try {
                const { config, repoRoot } = await initCli();
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const result = await operations.createWorkflow({
                        name: options.name,
                        from: options.from,
                    });
                    console.log(`Created workflow template: ${result.path}`);
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    workflow
        .command('validate <file>')
        .description('Validate a workflow YAML file')
        .action(async (file: string, options) => {
            try {
                const { config, repoRoot } = await initCli();
                const content = await fsPromises.readFile(file, 'utf-8');
                await withCliOperations(repoRoot, config, options, async (operations) => {
                    const result = await operations.validateWorkflow({ content });
                    if (!result.isValid) {
                        exitWithError(`Validation failed: ${result.errors.join('; ')}`);
                    }

                    if (result.workflowName) {
                        console.log(`Workflow "${result.workflowName}" is valid.`);
                        return;
                    }

                    console.log(`Workflow file "${file}" is valid.`);
                });
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });
}
