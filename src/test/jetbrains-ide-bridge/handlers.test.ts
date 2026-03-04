/**
 * Tests that handlers.ts delegates to SessionHandlerService rather than
 * implementing logic directly.
 *
 * Verifies:
 *  - initializeHandlers() creates a SessionHandlerService with the correct context
 *  - handleRequest() dispatches to SessionHandlerService methods
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import { ConfigStore } from '../../jetbrains-ide-bridge/config';
import { NotificationEmitter } from '../../jetbrains-ide-bridge/notifications';
import { handleRequest, initializeHandlers } from '../../jetbrains-ide-bridge/handlers';
import * as SessionHandlerServiceModule from '../../core/services/SessionHandlerService';
import * as TmuxService from '../../core/services/TmuxService';

suite('handlers delegation', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-handlers-deleg-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('initializeHandlers() creates a SessionHandlerService with the workspace root', async () => {
        // We can verify delegation by spying on the SessionHandlerService method.
        // After initializeHandlers() is called (in setup), dispatching to
        // 'terminal.list' should call SessionHandlerService.handleTerminalList.
        const listSessionsStub = sinon.stub(TmuxService, 'listSessions').resolves([]);

        const result = await handleRequest('terminal.list', {}) as { terminals: unknown[] };

        // The terminal list should be dispatched and return successfully.
        assert.ok(Array.isArray(result.terminals), 'terminals should be an array');
        sinon.assert.calledOnce(listSessionsStub);
    });

    test('handleRequest dispatches to SessionHandlerService.handleConfigGet', async () => {
        // Spy on the SessionHandlerService prototype to confirm delegation.
        const spy = sinon.spy(SessionHandlerServiceModule.SessionHandlerService.prototype, 'handleConfigGet');

        try {
            await handleRequest('config.get', { key: 'lanes.defaultAgent' });
        } catch {
            // Ignore any error; we just care that the method was called.
        }

        assert.ok(spy.called, 'SessionHandlerService.handleConfigGet should have been called');
    });

    test('handleRequest dispatches to SessionHandlerService.handleAgentList', async () => {
        const spy = sinon.spy(SessionHandlerServiceModule.SessionHandlerService.prototype, 'handleAgentList');

        await handleRequest('agent.list', {});

        assert.ok(spy.calledOnce, 'SessionHandlerService.handleAgentList should have been called once');
    });

    test('handleRequest throws "Method not found" for an unknown method', async () => {
        let thrown: unknown;
        try {
            await handleRequest('unknown.method', {});
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error for unknown method');
        assert.ok(
            (thrown as Error).message.includes('Method not found') ||
            (thrown as Error).message.includes('unknown.method'),
            `Error should indicate method not found, got: ${(thrown as Error).message}`
        );
    });

    test('handleRequest delegates session.pin to SessionHandlerService.handleSessionPin', async () => {
        const spy = sinon.spy(SessionHandlerServiceModule.SessionHandlerService.prototype, 'handleSessionPin');

        await handleRequest('session.pin', { sessionName: 'my-session' });

        assert.ok(spy.calledOnce, 'SessionHandlerService.handleSessionPin should have been called once');
        sinon.assert.calledWithMatch(spy, sinon.match({ sessionName: 'my-session' }));
    });

    test('re-initializing handlers with a new workspace does not break subsequent calls', async () => {
        // Create a second temp dir and re-initialize
        const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-handlers-reinit-'));
        try {
            const config2 = new ConfigStore(tempDir2);
            await config2.initialize();
            initializeHandlers(tempDir2, config2, new NotificationEmitter());

            const listSessionsStub = sinon.stub(TmuxService, 'listSessions').resolves([]);

            const result = await handleRequest('terminal.list', {}) as { terminals: unknown[] };
            assert.ok(Array.isArray(result.terminals), 'terminals should be an array after re-initialization');

            sinon.assert.calledOnce(listSessionsStub);
        } finally {
            fs.rmSync(tempDir2, { recursive: true, force: true });
        }
    });
});
