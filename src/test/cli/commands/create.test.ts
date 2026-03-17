import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Command } from 'commander';
import sinon from 'sinon';
import { registerCreateCommand } from '../../../cli/commands/create';
import * as cliUtils from '../../../cli/utils';
import * as codeAgents from '../../../core/codeAgents';
import * as SessionDataService from '../../../core/session/SessionDataService';
import * as sessionLauncher from '../../../cli/sessionLauncher';
import * as targeting from '../../../cli/targeting';

suite('CreateCommand', () => {
    let tempDir: string;
    let program: Command;
    let launchCliSessionStub: sinon.SinonStub;
    let processExitStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-create-command-'));

        program = new Command();
        program.exitOverride();
        program.configureOutput({
            writeOut: () => {},
            writeErr: () => {},
        });

        sinon.stub(cliUtils, 'initCli').resolves({
            config: {
                get: <T>(_section: string, key: string, fallback: T): T => {
                    if (key === 'defaultAgent') { return 'claude' as T; }
                    if (key === 'permissionMode') { return 'acceptEdits' as T; }
                    return fallback;
                },
            } as never,
            repoRoot: tempDir,
        });
        sinon.stub(codeAgents, 'validateAndGetAgent').resolves({
            agent: codeAgents.getAgent('claude'),
        });
        sinon.stub(SessionDataService, 'initializeGlobalStorageContext').returns(undefined);
        launchCliSessionStub = sinon.stub(sessionLauncher, 'launchCliSession').resolves();
        processExitStub = sinon.stub(process, 'exit').callsFake(((code?: number) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);

        registerCreateCommand(program);
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('exits before launching when the local daemon target cannot be resolved', async () => {
        sinon.stub(targeting, 'resolveCliDaemonTarget').rejects(
            new Error('Daemon port file not found or invalid. Is the daemon running?')
        );

        await assert.rejects(
            program.parseAsync(['node', 'lanes', 'create', '--name', 'feat-preflight']),
            /process\.exit:1/
        );

        sinon.assert.notCalled(launchCliSessionStub);
        sinon.assert.calledWith(processExitStub, 1);
    });
});
