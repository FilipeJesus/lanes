import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as sessionDataService from '../../core/session/SessionDataService';
import { ConfigStore } from '../../bridge/config';
import { NotificationEmitter } from '../../bridge/notifications';
import { handleRequest, initializeHandlers } from '../../bridge/handlers';
import { getAgent } from '../../core/codeAgents';
import { initializeGlobalStorageContext } from '../../core/session/SessionDataService';

suite('Bridge session.getStatus', () => {
    let tempDir: string;
    let getAgentStatusStub: sinon.SinonStub;
    let getWorkflowStatusStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-session-status-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());
        initializeGlobalStorageContext('', tempDir, getAgent('claude')!);

        getAgentStatusStub = sinon.stub(sessionDataService, 'getAgentStatus');
        getWorkflowStatusStub = sinon.stub(sessionDataService, 'getWorkflowStatus');
    });

    teardown(() => {
        getAgentStatusStub.restore();
        getWorkflowStatusStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('returns status and workflowStatus for an existing session', async () => {
        const fakeStatus = { status: 'active', timestamp: '2024-01-01T00:00:00.000Z', message: undefined };
        const fakeWorkflowStatus = { active: true, workflow: 'my-workflow', step: 'step-1', progress: 'Task 1', summary: undefined };

        getAgentStatusStub.resolves(fakeStatus);
        getWorkflowStatusStub.resolves(fakeWorkflowStatus);

        const result = await handleRequest('session.getStatus', {
            sessionName: 'feat-status'
        }) as { status: typeof fakeStatus; workflowStatus: typeof fakeWorkflowStatus };

        assert.deepStrictEqual(result.status, fakeStatus);
        assert.deepStrictEqual(result.workflowStatus, fakeWorkflowStatus);

        const worktreePath = path.join(tempDir, '.worktrees', 'feat-status');
        sinon.assert.calledOnceWithExactly(getAgentStatusStub, worktreePath);
        sinon.assert.calledOnceWithExactly(getWorkflowStatusStub, worktreePath);
    });

    test('returns null status for a nonexistent session (no status file)', async () => {
        getAgentStatusStub.resolves(null);
        getWorkflowStatusStub.resolves(null);

        const result = await handleRequest('session.getStatus', {
            sessionName: 'feat-nonexistent'
        }) as { status: null; workflowStatus: null };

        assert.strictEqual(result.status, null);
        assert.strictEqual(result.workflowStatus, null);
    });

    test('resolves the correct worktree path from the session name', async () => {
        getAgentStatusStub.resolves(null);
        getWorkflowStatusStub.resolves(null);

        await handleRequest('session.getStatus', { sessionName: 'feat-path-check' });

        const expectedWorktreePath = path.join(tempDir, '.worktrees', 'feat-path-check');
        sinon.assert.calledWithExactly(getAgentStatusStub, expectedWorktreePath);
        sinon.assert.calledWithExactly(getWorkflowStatusStub, expectedWorktreePath);
    });
});
