/**
 * Tests for src/cli/commands/daemon.ts — registerDaemonCommand.
 *
 * Verifies that calling registerDaemonCommand on a Commander program registers
 * the 'daemon' top-level command with the expected subcommands.
 *
 * These tests do NOT invoke the command actions (which would spawn real
 * processes) — they only inspect the Commander command structure.
 */

import * as assert from 'assert';
import { Command } from 'commander';
import { registerDaemonCommand } from '../../cli/commands/daemon';

suite('Daemon CLI Command', () => {
    let program: Command;

    setup(() => {
        program = new Command();
        // Disable output and error handling for tests
        program.exitOverride();
        program.configureOutput({
            writeOut: () => {},
            writeErr: () => {},
        });
    });

    // -------------------------------------------------------------------------
    // daemon-cli-command-registers
    // -------------------------------------------------------------------------

    test('Given a Commander program, when registerDaemonCommand is called, then the daemon command is registered', () => {
        // Act
        registerDaemonCommand(program);

        // Assert
        const commands = program.commands.map((c) => c.name());
        assert.ok(
            commands.includes('daemon'),
            `Expected 'daemon' to be registered, found: ${commands.join(', ')}`
        );
    });

    test('Given the daemon command, when listing subcommands, then start, register, unregister, registered, stop, status, and logs subcommands are present', () => {
        // Arrange
        registerDaemonCommand(program);
        const daemonCommand = program.commands.find((c) => c.name() === 'daemon');

        assert.ok(daemonCommand, 'daemon command should exist');

        // Act
        const subcommandNames = daemonCommand!.commands.map((c) => c.name());

        // Assert
        const expectedSubcommands = ['start', 'register', 'unregister', 'registered', 'stop', 'status', 'logs'];
        for (const expectedName of expectedSubcommands) {
            assert.ok(
                subcommandNames.includes(expectedName),
                `Expected subcommand '${expectedName}' to be present, found: ${subcommandNames.join(', ')}`
            );
        }
    });

    test('Given the daemon start subcommand, when inspecting its options, then --port option is present', () => {
        // Arrange
        registerDaemonCommand(program);
        const daemonCommand = program.commands.find((c) => c.name() === 'daemon');
        assert.ok(daemonCommand, 'daemon command should exist');
        const startCommand = daemonCommand!.commands.find((c) => c.name() === 'start');
        assert.ok(startCommand, 'start subcommand should exist');

        // Act
        const optionNames = startCommand!.options.map((o) => o.long);

        // Assert
        assert.ok(
            optionNames.includes('--port'),
            `Expected --port option on start subcommand, found: ${optionNames.join(', ')}`
        );
    });

    test('Given the daemon command, when checking descriptions, then the daemon command has a description', () => {
        // Arrange
        registerDaemonCommand(program);
        const daemonCommand = program.commands.find((c) => c.name() === 'daemon');
        assert.ok(daemonCommand, 'daemon command should exist');

        // Assert
        const desc = daemonCommand!.description();
        assert.ok(
            typeof desc === 'string' && desc.length > 0,
            'daemon command should have a non-empty description'
        );
    });
});
