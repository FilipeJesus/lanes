import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chmodSync } from 'fs';
import { Command } from 'commander';
import sinon from 'sinon';
import { registerCreateCommand } from '../../../cli/commands/create';
import * as cliUtils from '../../../cli/utils';
import * as PreflightService from '../../../core/services/PreflightService';
import * as SessionCreationService from '../../../core/services/SessionCreationService';
import * as SessionDataService from '../../../core/session/SessionDataService';
import * as openCommand from '../../../cli/commands/open';

suite('CreateCommand', () => {
    let tempDir: string;
    let binDir: string;
    let originalPath: string | undefined;
    let program: Command;
    let initCliStub: sinon.SinonStub;
    let initializeStorageStub: sinon.SinonStub;
    let isCommandAvailableStub: sinon.SinonStub;
    let createSessionWorktreeStub: sinon.SinonStub;
    let execIntoAgentStub: sinon.SinonStub;
    let processExitStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-create-command-'));
        binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-create-bin-'));
        fs.writeFileSync(path.join(binDir, 'claude'), '#!/bin/sh\nexit 0\n', 'utf-8');
        chmodSync(path.join(binDir, 'claude'), 0o755);
        originalPath = process.env.PATH;
        process.env.PATH = `${binDir}:${originalPath ?? ''}`;

        program = new Command();
        program.exitOverride();
        program.configureOutput({
            writeOut: () => {},
            writeErr: () => {},
        });

        initCliStub = sinon.stub(cliUtils, 'initCli').resolves({
            config: {
                get: <T>(_section: string, key: string, fallback: T): T => {
                    if (key === 'worktreesFolder') { return '.worktrees' as T; }
                    if (key === 'defaultAgent') { return 'claude' as T; }
                    if (key === 'localSettingsPropagation') { return 'copy' as T; }
                    if (key === 'terminalMode') { return 'vscode' as T; }
                    return fallback;
                },
            } as never,
            repoRoot: tempDir,
        });
        initializeStorageStub = sinon.stub(SessionDataService, 'initializeGlobalStorageContext').returns(undefined);
        isCommandAvailableStub = sinon.stub(PreflightService.preflightDeps, 'isCommandAvailable').callsFake(async (command: string) => {
            return command === 'claude';
        });
        createSessionWorktreeStub = sinon.stub(SessionCreationService, 'createSessionWorktree').resolves({
            worktreePath: path.join(tempDir, '.worktrees', 'feat-preflight'),
        });
        execIntoAgentStub = sinon.stub(openCommand, 'execIntoAgent').resolves();
        processExitStub = sinon.stub(process, 'exit').callsFake(((code?: number) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);

        registerCreateCommand(program);
    });

    teardown(() => {
        sinon.restore();
        process.env.PATH = originalPath;
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(binDir, { recursive: true, force: true });
    });

    test('exits before creating a session when preflight fails', async () => {
        await assert.rejects(
            program.parseAsync(['node', 'lanes', 'create', '--name', 'feat-preflight']),
            /process\.exit:1/
        );

        sinon.assert.calledWith(isCommandAvailableStub, 'jq');
        sinon.assert.notCalled(createSessionWorktreeStub);
        sinon.assert.notCalled(execIntoAgentStub);
        sinon.assert.calledWith(processExitStub, 1);
    });
});
