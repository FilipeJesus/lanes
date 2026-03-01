import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as diffService from '../../core/services/DiffService';
import { ConfigStore } from '../../bridge/config';
import { NotificationEmitter } from '../../bridge/notifications';
import { handleRequest, initializeHandlers } from '../../bridge/handlers';

suite('Bridge git.getDiffFiles', () => {
    let tempDir: string;
    let getBaseBranchStub: sinon.SinonStub;
    let generateDiffFilesStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-diff-files-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());

        getBaseBranchStub = sinon.stub(diffService, 'getBaseBranch').resolves('main');
        generateDiffFilesStub = sinon.stub(diffService, 'generateDiffFiles').resolves([
            {
                path: 'src/app.ts',
                status: 'M',
                beforeContent: 'old',
                afterContent: 'new'
            }
        ]);
    });

    teardown(() => {
        getBaseBranchStub.restore();
        generateDiffFilesStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('returns structured diff files for a session', async () => {
        const result = await handleRequest('git.getDiffFiles', {
            sessionName: 'feat-diff',
            includeUncommitted: true
        }) as { files: Array<{ path: string; status: string }> };

        assert.strictEqual(result.files.length, 1);
        assert.strictEqual(result.files[0].path, 'src/app.ts');
        assert.strictEqual(result.files[0].status, 'M');
        sinon.assert.calledOnce(generateDiffFilesStub);
    });
});
