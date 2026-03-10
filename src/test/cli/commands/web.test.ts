/**
 * Tests for src/cli/commands/web.ts — registerWebCommand.
 *
 * Verifies that the `lanes web` command:
 *  - Is registered on the Commander program
 *  - Starts the gateway on the specified --port
 *  - Uses DEFAULT_GATEWAY_PORT when --port is not supplied
 *  - Exits with an error for an invalid port
 *
 * The action handler calls runGatewayServer, which is stubbed so no real
 * HTTP server is started.
 */

import * as assert from 'assert';
import sinon from 'sinon';
import { Command } from 'commander';
import { registerWebCommand } from '../../../cli/commands/web';
import * as gatewayModule from '../../../daemon/gateway';
import { DEFAULT_GATEWAY_PORT } from '../../../daemon/gateway';

suite('WebCommand', () => {
    let program: Command;
    let runGatewayServerStub: sinon.SinonStub;
    let processExitStub: sinon.SinonStub;

    setup(() => {
        program = new Command();
        // Suppress Commander's built-in process.exit so tests don't abort
        program.exitOverride();
        program.configureOutput({
            writeOut: () => {},
            writeErr: () => {},
        });

        // Stub runGatewayServer so no real server is started.
        runGatewayServerStub = sinon.stub(gatewayModule, 'runGatewayServer').resolves();

        // Stub process.exit to capture exit-code assertions and stop execution.
        processExitStub = sinon.stub(process, 'exit').callsFake(((code?: number) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);

        registerWebCommand(program);
    });

    teardown(() => {
        sinon.restore();
    });

    // -----------------------------------------------------------------------
    // web-cli-command-starts-gateway
    // -----------------------------------------------------------------------

    test('Given --port 4000, when lanes web is run, then gateway starts on port 4000', async () => {
        // Act
        await program.parseAsync(['node', 'lanes', 'web', '--port', '4000']);

        // Assert
        assert.ok(
            runGatewayServerStub.calledOnce,
            'runGatewayServer should have been called once'
        );
        const opts = runGatewayServerStub.firstCall.args[0] as { port: number };
        assert.strictEqual(opts.port, 4000, 'Gateway should be started on port 4000');
    });

    test('Given no --port, when lanes web is run, then gateway starts on default port', async () => {
        // Act
        await program.parseAsync(['node', 'lanes', 'web']);

        // Assert
        assert.ok(
            runGatewayServerStub.calledOnce,
            'runGatewayServer should have been called once'
        );
        const opts = runGatewayServerStub.firstCall.args[0] as { port: number };
        assert.strictEqual(
            opts.port,
            DEFAULT_GATEWAY_PORT,
            `Gateway should use default port ${DEFAULT_GATEWAY_PORT}`
        );
    });

    test('Given invalid port, when lanes web is run, then exits with error', async () => {
        // Act: pass an invalid port value
        await assert.rejects(
            program.parseAsync(['node', 'lanes', 'web', '--port', 'not-a-number']),
            /process\.exit:1/
        );

        // Assert: process.exit(1) should have been called for the invalid port.
        assert.ok(
            processExitStub.calledWith(1),
            'process.exit(1) should be called for an invalid port'
        );
    });
});
