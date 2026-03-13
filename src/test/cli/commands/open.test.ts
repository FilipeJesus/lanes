import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { chmodSync } from 'fs';
import { Command } from 'commander';
import sinon from 'sinon';
import { registerOpenCommand } from '../../../cli/commands/open';
import * as cliUtils from '../../../cli/utils';
import * as PreflightService from '../../../core/services/PreflightService';

suite('OpenCommand', () => {
    let tempDir: string;
    let worktreePath: string;
    let binDir: string;
    let originalPath: string | undefined;
    let program: Command;
    let initCliStub: sinon.SinonStub;
    let isCommandAvailableStub: sinon.SinonStub;
    let processExitStub: sinon.SinonStub;
    let consoleErrorStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-open-command-'));
        worktreePath = path.join(tempDir, '.worktrees', 'feat-preflight');
        fs.mkdirSync(worktreePath, { recursive: true });
        binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-open-bin-'));
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
                    if (key === 'terminalMode') { return 'tmux' as T; }
                    return fallback;
                },
            } as never,
            repoRoot: tempDir,
        });
        isCommandAvailableStub = sinon.stub(PreflightService.preflightDeps, 'isCommandAvailable').callsFake(async (command: string) => {
            return command !== 'tmux';
        });
        consoleErrorStub = sinon.stub(console, 'error');
        processExitStub = sinon.stub(process, 'exit').callsFake(((code?: number) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);

        registerOpenCommand(program);
    });

    teardown(() => {
        sinon.restore();
        process.env.PATH = originalPath;
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.rmSync(binDir, { recursive: true, force: true });
    });

    test('exits before launching a session when preflight fails', async () => {
        await assert.rejects(
            program.parseAsync(['node', 'lanes', 'open', 'feat-preflight']),
            /process\.exit:1/
        );

        sinon.assert.calledWith(isCommandAvailableStub, 'tmux');
        sinon.assert.calledWith(
            consoleErrorStub,
            'Error: tmux is required when lanes.terminalMode is set to tmux. Install it and try again.'
        );
        sinon.assert.calledWith(processExitStub, 1);
    });
});
