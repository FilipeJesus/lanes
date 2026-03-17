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
import { applyCliDaemonTargeting } from '../../cli/targeting';

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

function makeTargetedProgram(): Command {
    const program = makeProgram();
    registerCreateCommand(program);
    registerListCommand(program);
    registerStatusCommand(program);
    registerDeleteCommand(program);
    registerOpenCommand(program);
    registerClearCommand(program);
    registerDiffCommand(program);
    registerInsightsCommand(program);
    registerConfigCommand(program);
    registerRepairCommand(program);
    registerWorkflowCommand(program);
    applyCliDaemonTargeting(program);
    return program;
}

suite('CLI daemon host options', () => {
    test('create command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'create');
        assert.ok(command);
        assertCommandHasHostOption(command, 'create');
    });

    test('list command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'list');
        assert.ok(command);
        assertCommandHasHostOption(command, 'list');
    });

    test('status command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'status');
        assert.ok(command);
        assertCommandHasHostOption(command, 'status');
    });

    test('delete command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'delete');
        assert.ok(command);
        assertCommandHasHostOption(command, 'delete');
    });

    test('open command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'open');
        assert.ok(command);
        assertCommandHasHostOption(command, 'open');
    });

    test('clear command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'clear');
        assert.ok(command);
        assertCommandHasHostOption(command, 'clear');
    });

    test('diff command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'diff');
        assert.ok(command);
        assertCommandHasHostOption(command, 'diff');
    });

    test('insights command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'insights');
        assert.ok(command);
        assertCommandHasHostOption(command, 'insights');
    });

    test('config command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'config');
        assert.ok(command);
        assertCommandHasHostOption(command, 'config');
    });

    test('repair command exposes --host', () => {
        const program = makeTargetedProgram();

        const command = program.commands.find((entry) => entry.name() === 'repair');
        assert.ok(command);
        assertCommandHasHostOption(command, 'repair');
    });

    test('workflow list exposes --host', () => {
        const program = makeTargetedProgram();

        const workflow = program.commands.find((entry) => entry.name() === 'workflow');
        assert.ok(workflow);
        const command = workflow.commands.find((entry) => entry.name() === 'list');
        assert.ok(command);
        assertCommandHasHostOption(command, 'workflow list');
    });

    test('workflow create exposes --host', () => {
        const program = makeTargetedProgram();

        const workflow = program.commands.find((entry) => entry.name() === 'workflow');
        assert.ok(workflow);
        const command = workflow.commands.find((entry) => entry.name() === 'create');
        assert.ok(command);
        assertCommandHasHostOption(command, 'workflow create');
    });

    test('workflow validate exposes --host', () => {
        const program = makeTargetedProgram();

        const workflow = program.commands.find((entry) => entry.name() === 'workflow');
        assert.ok(workflow);
        const command = workflow.commands.find((entry) => entry.name() === 'validate');
        assert.ok(command);
        assertCommandHasHostOption(command, 'workflow validate');
    });
});
