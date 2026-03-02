/**
 * `lanes workflow` — Workflow template management.
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import { initCli, exitWithError, getPackageRoot } from '../utils';
import { discoverWorkflows, loadWorkflowTemplateFromString, WorkflowValidationError } from '../../core/workflow';
import { BLANK_WORKFLOW_TEMPLATE } from '../../core/services/WorkflowService';
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
                const customWorkflowsFolder = config.get('lanes', 'customWorkflowsFolder', '.lanes/workflows');

                const templates = await discoverWorkflows({
                    extensionPath: getPackageRoot(),
                    workspaceRoot: repoRoot,
                    customWorkflowsFolder,
                });

                if (options.json) {
                    console.log(JSON.stringify(templates, null, 2));
                    return;
                }

                if (templates.length === 0) {
                    console.log('No workflow templates found.');
                    console.log(`Create one in ${customWorkflowsFolder}/`);
                    return;
                }

                console.log(`${'NAME'.padEnd(25)} ${'SOURCE'.padEnd(12)} DESCRIPTION`);
                console.log('-'.repeat(70));
                for (const t of templates) {
                    const source = t.isBuiltIn ? 'built-in' : 'custom';
                    console.log(`${t.name.padEnd(25)} ${source.padEnd(12)} ${t.description || ''}`);
                }
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
                const customWorkflowsFolder = config.get('lanes', 'customWorkflowsFolder', '.lanes/workflows');

                // Validate name
                if (!/^[a-zA-Z0-9_-]+$/.test(options.name)) {
                    exitWithError('Workflow name must contain only letters, numbers, hyphens, and underscores.');
                }

                const customPath = path.join(repoRoot, customWorkflowsFolder);
                await fsPromises.mkdir(customPath, { recursive: true });

                const targetPath = path.join(customPath, `${options.name}.yaml`);

                // Check if already exists
                try {
                    await fsPromises.access(targetPath);
                    exitWithError(`Workflow '${options.name}' already exists at ${targetPath}`);
                } catch { /* doesn't exist — good */ }

                let content: string;
                if (options.from) {
                    // Copy from existing template
                    const templates = await discoverWorkflows({
                        extensionPath: getPackageRoot(),
                        workspaceRoot: repoRoot,
                        customWorkflowsFolder,
                    });
                    const source = templates.find(t => t.name === options.from);
                    if (!source) {
                        exitWithError(`Template '${options.from}' not found. Run 'lanes workflow list' to see available templates.`);
                    }
                    const sourceContent = await fsPromises.readFile(source.path, 'utf-8');
                    content = sourceContent.replace(/^name:\s*.+$/m, `name: ${options.name}`);
                } else {
                    content = BLANK_WORKFLOW_TEMPLATE.replace('name: my-workflow', `name: ${options.name}`);
                }

                await fsPromises.writeFile(targetPath, content, 'utf-8');
                console.log(`Created workflow template: ${targetPath}`);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ERR_PROCESS_EXIT') {throw err;}
                exitWithError(getErrorMessage(err));
            }
        });

    workflow
        .command('validate <file>')
        .description('Validate a workflow YAML file')
        .action(async (file: string) => {
            try {
                const content = await fsPromises.readFile(file, 'utf-8');
                const template = loadWorkflowTemplateFromString(content);
                console.log(`Workflow "${template.name}" is valid.`);
            } catch (error) {
                if (error instanceof WorkflowValidationError) {
                    exitWithError(`Validation failed: ${error.message}`);
                } else {
                    exitWithError(`Invalid YAML: ${error instanceof Error ? error.message : String(error)}`);
                }
            }
        });
}
