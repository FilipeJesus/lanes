import * as assert from 'assert';
import { Command } from 'commander';
import { registerClearCommand } from '../../cli/commands/clear';
import { registerConfigCommand } from '../../cli/commands/config';
import { registerCreateCommand } from '../../cli/commands/create';
import { registerDeleteCommand } from '../../cli/commands/delete';
import { registerDiffCommand } from '../../cli/commands/diff';
import { registerInsightsCommand } from '../../cli/commands/insights';
import { registerListCommand } from '../../cli/commands/list';
import { registerOpenCommand } from '../../cli/commands/open';
import { registerRepairCommand } from '../../cli/commands/repair';
import { registerStatusCommand } from '../../cli/commands/status';
import { registerWorkflowCommand } from '../../cli/commands/workflow';

function makeProgram(): Command {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({
        writeOut: () => {},
        writeErr: () => {},
    });
    return program;
}

function assertCommandHasHostOption(command: Command, label: string): void {
    const optionNames = command.options.map((option) => option.long);
    assert.ok(
        optionNames.includes('--host'),
        `Expected ${label} to expose --host, found: ${optionNames.join(', ')}`
    );
}

suite('CLI daemon host options', () => {
    test('create command exposes --host', () => {
        const program = makeProgram();
        registerCreateCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'create');
        assert.ok(command);
        assertCommandHasHostOption(command, 'create');
    });

    test('list command exposes --host', () => {
        const program = makeProgram();
        registerListCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'list');
        assert.ok(command);
        assertCommandHasHostOption(command, 'list');
    });

    test('status command exposes --host', () => {
        const program = makeProgram();
        registerStatusCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'status');
        assert.ok(command);
        assertCommandHasHostOption(command, 'status');
    });

    test('delete command exposes --host', () => {
        const program = makeProgram();
        registerDeleteCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'delete');
        assert.ok(command);
        assertCommandHasHostOption(command, 'delete');
    });

    test('open command exposes --host', () => {
        const program = makeProgram();
        registerOpenCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'open');
        assert.ok(command);
        assertCommandHasHostOption(command, 'open');
    });

    test('clear command exposes --host', () => {
        const program = makeProgram();
        registerClearCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'clear');
        assert.ok(command);
        assertCommandHasHostOption(command, 'clear');
    });

    test('diff command exposes --host', () => {
        const program = makeProgram();
        registerDiffCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'diff');
        assert.ok(command);
        assertCommandHasHostOption(command, 'diff');
    });

    test('insights command exposes --host', () => {
        const program = makeProgram();
        registerInsightsCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'insights');
        assert.ok(command);
        assertCommandHasHostOption(command, 'insights');
    });

    test('config command exposes --host', () => {
        const program = makeProgram();
        registerConfigCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'config');
        assert.ok(command);
        assertCommandHasHostOption(command, 'config');
    });

    test('repair command exposes --host', () => {
        const program = makeProgram();
        registerRepairCommand(program);

        const command = program.commands.find((entry) => entry.name() === 'repair');
        assert.ok(command);
        assertCommandHasHostOption(command, 'repair');
    });

    test('workflow list exposes --host', () => {
        const program = makeProgram();
        registerWorkflowCommand(program);

        const workflow = program.commands.find((entry) => entry.name() === 'workflow');
        assert.ok(workflow);
        const command = workflow.commands.find((entry) => entry.name() === 'list');
        assert.ok(command);
        assertCommandHasHostOption(command, 'workflow list');
    });
});
