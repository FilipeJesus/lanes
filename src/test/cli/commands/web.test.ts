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
        // Return a never-resolving promise to simulate the blocking `await`.
        runGatewayServerStub = sinon.stub(gatewayModule, 'runGatewayServer').returns(
            new Promise<void>(() => { /* never resolves */ })
        );

        // Stub process.exit to capture exit-code assertions without crashing
        processExitStub = sinon.stub(process, 'exit');

        registerWebCommand(program);
    });

    teardown(() => {
        sinon.restore();
    });

    // -----------------------------------------------------------------------
    // web-cli-command-starts-gateway
    // -----------------------------------------------------------------------

    test('Given --port 4000, when lanes web is run, then gateway starts on port 4000', async () => {
        // Act: parse the command — the action fires asynchronously, so we
        // flush the microtask queue with a short tick.
        program.parse(['node', 'lanes', 'web', '--port', '4000']);
        await new Promise<void>((resolve) => setImmediate(resolve));

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
        program.parse(['node', 'lanes', 'web']);
        await new Promise<void>((resolve) => setImmediate(resolve));

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
        program.parse(['node', 'lanes', 'web', '--port', 'not-a-number']);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // Assert: process.exit(1) should have been called for the invalid port.
        // Note: because process.exit is stubbed (not a real exit), execution
        // continues after the stub call, but the error path was taken.
        assert.ok(
            processExitStub.calledWith(1),
            'process.exit(1) should be called for an invalid port'
        );
    });
});
