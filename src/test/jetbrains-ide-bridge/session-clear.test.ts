import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as sessionDataService from '../../core/session/SessionDataService';
import { ConfigStore } from '../../jetbrains-ide-bridge/config';
import { NotificationEmitter } from '../../jetbrains-ide-bridge/notifications';
import { handleRequest, initializeHandlers } from '../../jetbrains-ide-bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext } from '../../core/session/SessionDataService';

suite('Bridge session.clear', () => {
    let tempDir: string;
    let clearSessionIdStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-session-clear-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
        initializeGlobalStorageContext('', tempDir, getAgent('claude')!);

        clearSessionIdStub = sinon.stub(sessionDataService, 'clearSessionId').resolves();
    });

    teardown(() => {
        clearSessionIdStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('clears a session successfully and returns success', async () => {
        const result = await handleRequest('session.clear', {
            sessionName: 'feat-clear'
        }) as { success: boolean };

        assert.strictEqual(result.success, true);
        sinon.assert.calledOnce(clearSessionIdStub);
    });

    test('calls clearSessionId with the correct worktree path', async () => {
        await handleRequest('session.clear', { sessionName: 'feat-clear-path' });

        const expectedWorktreePath = path.join(tempDir, '.worktrees', 'feat-clear-path');
        sinon.assert.calledOnceWithExactly(clearSessionIdStub, expectedWorktreePath);
    });

    test('handles a nonexistent session gracefully (clearSessionId is a no-op when no file exists)', async () => {
        // clearSessionId already handles missing files gracefully internally.
        // The handler should still return success without throwing.
        const result = await handleRequest('session.clear', {
            sessionName: 'feat-nonexistent-clear'
        }) as { success: boolean };

        assert.strictEqual(result.success, true);
        sinon.assert.calledOnce(clearSessionIdStub);
    });

    test('propagates errors thrown by clearSessionId', async () => {
        clearSessionIdStub.rejects(new Error('disk write failure'));

        await assert.rejects(
            () => handleRequest('session.clear', { sessionName: 'feat-error-clear' }),
            (err: Error) => {
                assert.strictEqual(err.message, 'disk write failure');
                return true;
            }
        );
    });
});
