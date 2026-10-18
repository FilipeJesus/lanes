import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import sinon from 'sinon';
import { getAgent, PiAgent } from '../../core/codeAgents';
import { prepareAgentLaunchContext, buildAgentLaunchCommand } from '../../core/services/AgentLaunchService';
import * as SessionData from '../../core/session/SessionDataService';
import * as Tmux from '../../core/services/TmuxService';
import * as Polling from '../../vscode/services/PollingStatusService';
import { openAgentTerminal, registerHooklessTerminalTracking } from '../../vscode/services/TerminalService';
import { propagateLocalSettings } from '../../core/localSettings';
import { execIntoAgent } from '../../cli/commands/open';
import { CliConfigProvider } from '../../cli/adapters/CliConfigProvider';

suite('Pi launch lifecycle', () => {
    let tempDir: string;
    let worktree: string;
    let agent: PiAgent;
    let sandbox: sinon.SinonSandbox;

    setup(async () => {
        sandbox = sinon.createSandbox();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-pi-launch-'));
        worktree = path.join(tempDir, '.worktrees', 'feature');
        fs.mkdirSync(worktree, { recursive: true });
        agent = getAgent('pi') as PiAgent;
        await SessionData.initializeGlobalStorageContext(path.join(tempDir, '.lanes'), tempDir, agent);
    });
    teardown(async () => {
        sandbox.restore();
        await SessionData.initializeGlobalStorageContext('');
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
    function metadata(): Record<string, any> {
        return JSON.parse(fs.readFileSync(SessionData.getSessionFilePath(worktree), 'utf8'));
    }
    async function prepare(workflow?: string) {
        return prepareAgentLaunchContext({ worktreePath: worktree, codeAgent: agent, repoRoot: tempDir, workflow });
    }

    test('workflow writes native MCP, preserves settings and unrelated configuration on repeat/resume', async () => {
        const piDir = path.join(worktree, '.pi');
        fs.mkdirSync(piDir);
        const settingsText = '{ "model": "personal-model", "quietStartup": true }\n';
        fs.writeFileSync(path.join(piDir, 'settings.json'), settingsText);
        const userServer = { url: 'https://example.test/mcp', headers: { 'X-User': 'preserved' } };
        fs.writeFileSync(path.join(piDir, 'mcp.json'), JSON.stringify({ customRoot: { keep: true }, mcpServers: { personal: userServer } }));
        const workflow = path.join(tempDir, 'workflow.yaml');
        const first = await prepare(workflow);
        assert.strictEqual(first.settingsPath, undefined);
        assert.strictEqual(first.mcpConfigPath, undefined);
        const resumed = await prepare(workflow);
        assert.strictEqual((await buildAgentLaunchCommand(resumed)).mode, 'resume');
        const mcp = JSON.parse(fs.readFileSync(path.join(piDir, 'mcp.json'), 'utf8'));
        assert.deepStrictEqual(mcp.customRoot, { keep: true });
        assert.deepStrictEqual(mcp.mcpServers.personal, userServer);
        assert.deepStrictEqual(Object.keys(mcp.mcpServers).sort(), ['lanes-workflow', 'personal']);
        const lanes = mcp.mcpServers['lanes-workflow'];
        assert.strictEqual(lanes.command, process.versions.electron ? 'node' : process.execPath);
        assert.strictEqual(lanes.exposure, 'direct');
        assert.deepStrictEqual(lanes.args.slice(1), ['--worktree', worktree, '--workflow-path', workflow, '--repo-root', tempDir]);
        assert.strictEqual(fs.readFileSync(path.join(piDir, 'settings.json'), 'utf8'), settingsText);
    });

    for (const mode of ['copy', 'symlink'] as const) {
        test(`project propagation ${mode} carries both Pi configuration files`, async () => {
            const piDir = path.join(tempDir, '.pi');
            fs.mkdirSync(piDir);
            for (const file of ['settings.json', 'mcp.json']) {
                fs.writeFileSync(path.join(piDir, file), JSON.stringify({ personal: file }));
            }
            await propagateLocalSettings(tempDir, worktree, mode, agent);
            for (const file of ['settings.json', 'mcp.json']) {
                const target = path.join(worktree, '.pi', file);
                assert.strictEqual(fs.readFileSync(target, 'utf8'), JSON.stringify({ personal: file }));
                assert.strictEqual(fs.lstatSync(target).isSymbolicLink(), mode === 'symlink');
            }
        });
    }

    test('launch reserves identity before first message and reopens it before or after log creation', async () => {
        const first = await prepare();
        assert.strictEqual(first.effectivePermissionMode, 'bypassPermissions');
        assert.strictEqual(first.sessionData, null);
        const saved = metadata();
        assert.strictEqual(saved.agentName, 'pi');
        assert.strictEqual(saved.sessionId, first.sessionPath);
        assert.strictEqual(saved.logPath, first.sessionPath);
        assert.strictEqual(fs.existsSync(first.sessionPath!), false);
        const start = await buildAgentLaunchCommand(first);
        assert.strictEqual(start.mode, 'start');
        assert.strictEqual(start.command, `pi --session '${first.sessionPath}'`);
        const beforeMessage = await prepare();
        assert.strictEqual(beforeMessage.sessionPath, undefined);
        assert.strictEqual((await buildAgentLaunchCommand(beforeMessage)).command, start.command);
        fs.writeFileSync(saved.logPath!, JSON.stringify({ type: 'session', id: 'native-id', cwd: worktree }) + '\n');
        const afterMessage = await prepare();
        assert.strictEqual(afterMessage.sessionData?.logPath, saved.logPath);
        assert.strictEqual((await buildAgentLaunchCommand(afterMessage)).mode, 'resume');
        assert.strictEqual(metadata().sessionId, saved.sessionId);
    });

    for (const useTmux of [false, true]) {
        test(`CLI ${useTmux ? 'tmux' : 'direct'} launch persists truthful permissions and resumes the same log`, async () => {
            const exec = sandbox.stub(require('child_process'), 'execSync').returns(Buffer.from(''));
            sandbox.stub(console, 'log');
            sandbox.stub(Tmux, 'isTmuxInstalled').resolves(true);
            const tmux = sandbox.stub(Tmux, 'launchInTmux').resolves({ attachCommand: 'tmux attach-session -t feature', wasExisting: false, tmuxSessionName: 'feature' });
            const options = { sessionName: 'feature', worktreePath: worktree, repoRoot: tempDir, codeAgent: agent,
                config: new CliConfigProvider(tempDir), useTmux, isNewSession: true, permissionMode: 'acceptEdits' };
            await execIntoAgent(options);
            const first = metadata();
            assert.strictEqual(first.agentName, 'pi');
            assert.strictEqual(first.permissionMode, 'bypassPermissions');
            assert.strictEqual(first.terminal, useTmux ? 'tmux' : 'code');
            assert.ok(first.logPath.endsWith('.jsonl'));
            const command = useTmux ? tmux.firstCall.args[0].command : exec.firstCall.args[0];
            assert.strictEqual(command, `pi --session '${first.logPath}'`);
            await execIntoAgent({ ...options, isNewSession: false });
            const resume = useTmux ? tmux.secondCall.args[0].command : exec.secondCall.args[0];
            assert.strictEqual(resume, command);
            assert.strictEqual(metadata().logPath, first.logPath);
        });
    }

    suite('VS Code terminal lifecycle', () => {
        let terminal: vscode.Terminal;
        let polling: sinon.SinonStub;
        let closeListener: (terminal: vscode.Terminal) => Promise<void>;
        let subscriptions: vscode.Disposable[];

        setup(() => {
            terminal = { name: 'Pi: feature', show: sandbox.stub(), sendText: sandbox.stub() } as unknown as vscode.Terminal;
            sandbox.stub(vscode.window, 'terminals').get(() => []);
            sandbox.stub(vscode.window, 'createTerminal').returns(terminal);
            sandbox.stub(vscode.window, 'onDidCloseTerminal').callsFake(listener => {
                closeListener = listener as typeof closeListener;
                return { dispose() {} };
            });
            polling = sandbox.stub(Polling, 'startPolling');
            sandbox.stub(Polling, 'stopPolling');
            subscriptions = [];
            registerHooklessTerminalTracking({ subscriptions } as vscode.ExtensionContext);
        });
        teardown(async () => {
            if (closeListener) { await closeListener(terminal); }
            subscriptions.forEach(disposable => disposable.dispose());
        });

        for (const useTmux of [false, true]) {
            test(`${useTmux ? 'tmux' : 'regular'} launch tracks reserved log, persists permissions, and resumes saved log`, async () => {
                sandbox.stub(SessionData, 'getSessionTerminalMode').resolves(useTmux ? 'tmux' : 'code');
                sandbox.stub(Tmux, 'isTmuxInstalled').resolves(true);
                sandbox.stub(Tmux, 'sessionExists').resolves(false);
                sandbox.stub(Tmux, 'createSession').resolves();
                const send = sandbox.stub(Tmux, 'sendCommand').resolves();
                await openAgentTerminal('feature', worktree, undefined, 'acceptEdits', null, agent, tempDir);
                const saved = metadata();
                assert.strictEqual(saved.permissionMode, 'bypassPermissions');
                assert.strictEqual(saved.agentName, 'pi');
                sinon.assert.calledWith(polling, terminal, saved.logPath, worktree);
                const command = `pi --session '${saved.logPath}'`;
                if (useTmux) { sinon.assert.calledWith(send, 'feature', command); }
                else { sinon.assert.calledWith(terminal.sendText as sinon.SinonStub, command); }
                await closeListener(terminal);
                assert.strictEqual(JSON.parse(fs.readFileSync(SessionData.getStatusFilePath(worktree), 'utf8')).status, 'idle');
                polling.resetHistory();
                await openAgentTerminal('feature', worktree, undefined, undefined, null, agent, tempDir);
                sinon.assert.calledWith(polling, terminal, saved.logPath, worktree);
                assert.strictEqual(metadata().logPath, saved.logPath);
            });
        }

        test('reattaching an existing tmux session restores polling and close tracking without relaunch', async () => {
            const savedLog = path.join(tempDir, 'existing.jsonl');
            const metadataPath = SessionData.getSessionFilePath(worktree);
            fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
            fs.writeFileSync(metadataPath, JSON.stringify({ agentName: 'pi', sessionId: 'native-id', logPath: savedLog, terminal: 'tmux' }));
            sandbox.stub(Tmux, 'isTmuxInstalled').resolves(true);
            sandbox.stub(Tmux, 'sessionExists').resolves(true);
            const create = sandbox.stub(Tmux, 'createSession').resolves();
            const send = sandbox.stub(Tmux, 'sendCommand').resolves();
            await openAgentTerminal('feature', worktree, undefined, undefined, null, agent, tempDir);
            sinon.assert.notCalled(create);
            sinon.assert.notCalled(send);
            sinon.assert.notCalled(terminal.sendText as sinon.SinonStub);
            sinon.assert.calledWith(vscode.window.createTerminal as sinon.SinonStub, sinon.match({
                shellPath: 'tmux', shellArgs: ['attach-session', '-t', 'feature'], cwd: worktree
            }));
            sinon.assert.calledWith(polling, terminal, savedLog, worktree);
            await closeListener(terminal);
            sinon.assert.calledWith(Polling.stopPolling as sinon.SinonStub, terminal);
            assert.strictEqual(JSON.parse(fs.readFileSync(SessionData.getStatusFilePath(worktree), 'utf8')).status, 'idle');
        });
    });
});
