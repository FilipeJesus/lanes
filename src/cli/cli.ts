/**
 * Lanes CLI — manage isolated AI coding sessions via Git worktrees.
 */

import { Command } from 'commander';
import { registerListCommand } from './commands/list';
import { registerStatusCommand } from './commands/status';
import { registerCreateCommand } from './commands/create';
import { registerOpenCommand } from './commands/open';
import { registerDeleteCommand } from './commands/delete';
import { registerClearCommand } from './commands/clear';
import { registerDiffCommand } from './commands/diff';
import { registerInsightsCommand } from './commands/insights';
import { registerHooksCommand } from './commands/hooks';
import { registerWorkflowCommand } from './commands/workflow';
import { registerRepairCommand } from './commands/repair';
import { registerConfigCommand } from './commands/config';

declare const CLI_VERSION: string;

const program = new Command();

program
    .name('lanes')
    .description('Manage isolated AI coding sessions via Git worktrees')
    .version(typeof CLI_VERSION !== 'undefined' ? CLI_VERSION : '0.0.0');

// Register all commands
registerListCommand(program);
registerStatusCommand(program);
registerCreateCommand(program);
registerOpenCommand(program);
registerDeleteCommand(program);
registerClearCommand(program);
registerDiffCommand(program);
registerInsightsCommand(program);
registerHooksCommand(program);
registerWorkflowCommand(program);
registerRepairCommand(program);
registerConfigCommand(program);

program.parse();
