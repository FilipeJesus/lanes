import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import { AgentSessionProvider } from '../../vscode/providers/AgentSessionProvider';
import * as sessionService from '../../vscode/services/SessionService';
import { processPendingSession } from '../../vscode/services/SessionProcessService';

suite('Pending session parent tracking', () => {
    let tempDir: string;
    let createStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-process-'));
        createStub = sinon.stub(sessionService, 'createSession').resolves();
    });

    teardown(() => {
        createStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    for (const parentSession of ['parent-lane', undefined]) {
        test(`passes ${parentSession ?? 'legacy root'} metadata through pending request processing`, async () => {
            const configPath = path.join(tempDir, 'pending.json');
            fs.writeFileSync(configPath, JSON.stringify({
                name: 'child-lane', sourceBranch: 'main', parentSession, requestedAt: new Date().toISOString()
            }));
            const provider = new AgentSessionProvider(tempDir);
            try {
                await processPendingSession(configPath, tempDir, tempDir, provider);

                sinon.assert.calledOnce(createStub);
                assert.strictEqual(createStub.firstCall.args[0], 'child-lane');
                assert.strictEqual(createStub.firstCall.args[9], parentSession);
                assert.strictEqual(fs.existsSync(configPath), false);
            } finally {
                provider.dispose();
            }
        });
    }
});
