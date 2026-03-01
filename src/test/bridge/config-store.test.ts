import * as assert from 'assert';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../bridge/config';
import { NotificationEmitter } from '../../bridge/notifications';
import { handleRequest, initializeHandlers, JsonRpcHandlerError } from '../../bridge/handlers';

suite('Bridge ConfigStore', () => {
    test('normalizes legacy terminalMode "code" to "vscode"', async () => {
        const workspace = await fsp.mkdtemp(path.join(os.tmpdir(), 'lanes-config-'));
        const store = new ConfigStore(workspace);
        await store.initialize();

        await store.set('lanes.terminalMode', 'code');
        const value = store.get('lanes.terminalMode');

        assert.strictEqual(value, 'vscode');
    });
});

suite('Bridge Handlers - config.get validation', () => {
    let tempDir: string;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-config-get-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('config.get with a valid key returns the value', async () => {
        const result = await handleRequest('config.get', { key: 'lanes.terminalMode' }) as { value: unknown };

        // The default value is 'vscode'
        assert.strictEqual(result.value, 'vscode');
    });

    test('config.get with a valid key lanes.defaultAgent returns the value', async () => {
        const result = await handleRequest('config.get', { key: 'lanes.defaultAgent' }) as { value: unknown };

        assert.strictEqual(result.value, 'claude');
    });

    test('config.get with an invalid key throws a JsonRpcHandlerError with code -32602', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('config.get', { key: 'lanes.unknownKey' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof JsonRpcHandlerError, 'Should throw JsonRpcHandlerError');
        assert.strictEqual((caughtError as JsonRpcHandlerError).code, -32602, 'Error code should be -32602 INVALID_PARAMS');
    });

    test('config.get with an invalid key error message lists valid keys', async () => {
        let caughtError: unknown;
        try {
            await handleRequest('config.get', { key: 'not.a.valid.key' });
        } catch (err) {
            caughtError = err;
        }

        assert.ok(caughtError instanceof JsonRpcHandlerError);
        assert.ok(
            (caughtError as JsonRpcHandlerError).message.includes('lanes.terminalMode'),
            'Error message should list at least one valid key'
        );
    });
});
