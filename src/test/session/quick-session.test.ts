import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import sinon from 'sinon';
import { getAgent } from '../../core/codeAgents';
import { ensureQuickSession, getQuickSession } from '../../core/session/QuickSessionService';
import * as SessionData from '../../core/session/SessionDataService';
import { prepareAgentLaunchContext } from '../../core/services/AgentLaunchService';
import * as Tmux from '../../core/services/TmuxService';
import * as gitAdapter from '../../gitService';
import * as ProjectManager from '../../vscode/ProjectManagerService';
import { AgentSessionProvider, SessionItem } from '../../vscode/providers/AgentSessionProvider';
import { GitChangesPanel } from '../../vscode/providers/GitChangesPanel';
import { registerSessionCommands } from '../../vscode/commands/sessionCommands';
import * as TerminalService from '../../vscode/services/TerminalService';
import * as Polling from '../../vscode/services/PollingStatusService';
import { executeQuickStart } from '../../vscode/services/QuickStartService';
import type { ServiceContainer } from '../../types/serviceContainer';

suite('Quick session lifecycle', () => {
    let repoRoot: string;
    let sessionPath: string;
    let provider: AgentSessionProvider;
    let sandbox: sinon.SinonSandbox;
    let context: vscode.ExtensionContext;

    setup(async () => {
        sandbox = sinon.createSandbox();
        repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-quick-session-'));
        await SessionData.initializeGlobalStorageContext('', repoRoot, getAgent('claude')!);
        sessionPath = await ensureQuickSession(repoRoot, 'quick-start-claude-test', 'claude');
        const state = new Map<string, unknown>();
        context = {
            subscriptions: [],
            workspaceState: {
                get: (key: string, fallback: unknown) => state.get(key) ?? fallback,
                update: async (key: string, value: unknown) => { state.set(key, value); },
            },
        } as unknown as vscode.ExtensionContext;
        provider = new AgentSessionProvider(repoRoot, undefined, undefined, context);
        sandbox.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    });

    teardown(async () => {
        sandbox.restore();
        context.subscriptions.forEach(disposable => disposable.dispose());
        provider.dispose();
        await SessionData.initializeGlobalStorageContext('');
        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    async function quickItem(): Promise<SessionItem> {
        const [item] = await provider.getChildren();
        assert.ok(item instanceof SessionItem);
        return item;
    }

    function registerCommands(): Map<string, (...args: any[]) => any> {
        const handlers = new Map<string, (...args: any[]) => any>();
        sandbox.stub(vscode.commands, 'registerCommand').callsFake((id, callback) => {
            handlers.set(id, callback);
            return { dispose() {} };
        });
        sandbox.stub(GitChangesPanel, 'setOnBranchChange');
        registerSessionCommands(context, {
            sessionProvider: provider, baseRepoPath: repoRoot, codeAgent: getAgent('claude'),
        } as unknown as ServiceContainer);
        return handlers;
    }

    function mockTerminal() {
        const terminal = { name: 'Claude: quick-start-claude-test', show: sandbox.stub(), sendText: sandbox.stub(), dispose: sandbox.stub() };
        const create = sandbox.stub(vscode.window, 'createTerminal').returns(terminal as unknown as vscode.Terminal);
        sandbox.stub(vscode.window, 'terminals').get(() => []);
        return { terminal, create };
    }

    test('appears without any worktrees, persists aliases and pins, and has no workflow details', async () => {
        await SessionData.saveSessionAlias(sessionPath, 'Plan the next task');
        await provider.pinSession(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'workflow-state.json'), JSON.stringify({ status: 'active', currentStep: 'plan' }));
        const item = await quickItem();
        assert.strictEqual(item.label, 'Plan the next task');
        assert.strictEqual(item.sessionName, 'quick-start-claude-test');
        assert.strictEqual(item.contextValue, 'sessionItemQuickPinned');
        assert.strictEqual(item.workingDirectory, repoRoot);
        assert.strictEqual(item.workflowStatus, null);
        assert.deepStrictEqual(await provider.getChildren(item), []);
        const reloadedProvider = new AgentSessionProvider(repoRoot);
        assert.strictEqual((await reloadedProvider.getChildren())[0].label, item.label);
        reloadedProvider.dispose();
    });

    test('keeps a saved quick session identity and history when reopening it or changing the default agent', async () => {
        await SessionData.saveSessionAlias(sessionPath, 'Planning');
        const metadata = JSON.parse(fs.readFileSync(SessionData.getSessionFilePath(sessionPath), 'utf8'));
        metadata.sessionId = '550e8400-e29b-41d4-a716-446655440000';
        fs.writeFileSync(SessionData.getSessionFilePath(sessionPath), JSON.stringify(metadata));
        await ensureQuickSession(repoRoot, 'quick-start-claude-test', 'claude');
        await SessionData.initializeGlobalStorageContext('', repoRoot, getAgent('codex')!);
        const data = await SessionData.getSessionId(sessionPath, getAgent('claude')!);
        assert.strictEqual(data?.sessionId, metadata.sessionId);
        assert.strictEqual(await SessionData.getSessionAgentName(sessionPath), 'claude');
        assert.strictEqual((await quickItem()).label, 'Planning');
    });

    test('lists multiple quick sessions for the same agent and resumes the selected entry', async () => {
        const handlers = registerCommands();
        const open = sandbox.stub(TerminalService, 'openAgentTerminal').resolves();
        const options = {
            repoRoot,
            getConfiguredAgentName: () => 'claude',
            openTerminal: async () => {},
            showError: (message: string) => { assert.fail(message); },
            showWarning: () => {},
            gitRepositoryCheck: async () => true,
            cliAvailabilityCheck: async () => true,
        };
        await executeQuickStart(options);
        await executeQuickStart(options);
        const items = await provider.getChildren();
        assert.strictEqual(items.length, 3, 'Existing quick sessions remain alongside new sessions');
        assert.strictEqual(new Set(items.map(item => item.label)).size, items.length);
        for (const item of items) {
            assert.ok(item instanceof SessionItem);
            await handlers.get('lanes.openSession')!(item);
            assert.strictEqual(open.lastCall.args[0], item.sessionName);
            assert.strictEqual(open.lastCall.args[1], item.worktreePath);
        }
        assert.strictEqual(open.callCount, items.length);
    });

    test('nests worktree sessions created by a quick session beneath their stable parent identity', async () => {
        const childPath = path.join(repoRoot, '.worktrees', 'child');
        fs.mkdirSync(childPath, { recursive: true });
        const childMetadata = SessionData.getSessionFilePath(childPath);
        fs.mkdirSync(path.dirname(childMetadata), { recursive: true });
        fs.writeFileSync(childMetadata, JSON.stringify({ parentSession: path.basename(sessionPath) }));
        const parent = await quickItem();
        assert.strictEqual(parent.worktreePath, sessionPath);
        assert.strictEqual(parent.childSessions[0].sessionName, 'child');
    });

    test('opens and resumes the agent in the repository with hooks and MCP pointing at isolated session metadata', async () => {
        const { terminal, create } = mockTerminal();
        await SessionData.saveSessionTerminalMode(sessionPath, 'code');
        await TerminalService.openAgentTerminal(path.basename(sessionPath), sessionPath, undefined, undefined, undefined, getAgent('claude')!, repoRoot);
        assert.strictEqual((create.firstCall.args[0] as vscode.TerminalOptions).cwd, repoRoot);
        assert.ok(!terminal.sendText.firstCall.args[0].includes('--resume'));
        const settings = fs.readFileSync(path.join(sessionPath, 'claude-settings.json'), 'utf8');
        assert.ok(settings.includes('session.json'));
        assert.ok(!settings.includes('workflow_status'));
        const config = JSON.parse(fs.readFileSync(path.join(sessionPath, 'mcp-config.json'), 'utf8'));
        assert.ok(!config.mcpServers['lanes-workflow'].args.includes('--workflow-path'));
        assert.strictEqual(config.mcpServers['lanes-workflow'].args[2], sessionPath);

        const data = JSON.parse(fs.readFileSync(SessionData.getSessionFilePath(sessionPath), 'utf8'));
        data.sessionId = '550e8400-e29b-41d4-a716-446655440000';
        fs.writeFileSync(SessionData.getSessionFilePath(sessionPath), JSON.stringify(data));
        terminal.sendText.resetHistory();
        await TerminalService.openAgentTerminal(path.basename(sessionPath), sessionPath, undefined, undefined, undefined, getAgent('claude')!, repoRoot);
        assert.ok(terminal.sendText.firstCall.args[0].includes(`--resume ${data.sessionId}`));
        assert.strictEqual((create.secondCall.args[0] as vscode.TerminalOptions).cwd, repoRoot);
        assert.ok(!fs.existsSync(path.join(repoRoot, '.claude')));
        assert.ok(!fs.existsSync(path.join(repoRoot, '.gitignore')));
    });

    test('starts quick sessions in the configured tmux backend despite their pre-existing metadata', async () => {
        const { create } = mockTerminal();
        const getConfig = vscode.workspace.getConfiguration.bind(vscode.workspace);
        sandbox.stub(vscode.workspace, 'getConfiguration').callsFake((section, scope) => section === 'lanes'
            ? { get: (key: string, fallback: unknown) => key === 'terminalMode' ? 'tmux' : fallback } as vscode.WorkspaceConfiguration
            : getConfig(section, scope));
        sandbox.stub(Tmux, 'isTmuxInstalled').resolves(true);
        sandbox.stub(Tmux, 'sessionExists').resolves(false);
        const tmuxCreate = sandbox.stub(Tmux, 'createSession').resolves();
        sandbox.stub(Tmux, 'sendCommand').resolves();
        await TerminalService.openAgentTerminal(path.basename(sessionPath), sessionPath, undefined, undefined, undefined, getAgent('claude')!, repoRoot);
        sinon.assert.calledWith(tmuxCreate, path.basename(sessionPath), repoRoot);
        assert.strictEqual((create.firstCall.args[0] as vscode.TerminalOptions).cwd, repoRoot);
        assert.strictEqual(await SessionData.getSessionTerminalMode(sessionPath), 'tmux');
    });

    test('creates ordinary shell terminals in the repository directory', async () => {
        const { create } = mockTerminal();
        await TerminalService.createTerminalForSession(await quickItem());
        assert.strictEqual((create.firstCall.args[0] as vscode.TerminalOptions).cwd, repoRoot);
    });

    for (const terminalMode of ['code', 'tmux'] as const) {
        test(`captures and resumes Codex history from the repository with the ${terminalMode} backend`, async () => {
            const agent = getAgent('codex')!;
            sessionPath = await ensureQuickSession(repoRoot, 'quick-start-codex-test', 'codex');
            await SessionData.saveSessionTerminalMode(sessionPath, terminalMode);
            const { terminal } = mockTerminal();
            let closeTerminal!: (terminal: vscode.Terminal) => Promise<void>;
            sandbox.stub(vscode.window, 'onDidCloseTerminal').callsFake(listener => {
                closeTerminal = listener;
                return { dispose() {} };
            });
            TerminalService.registerHooklessTerminalTracking(context);
            const sessionId = '550e8400-e29b-41d4-a716-446655440000';
            const logPath = path.join(repoRoot, 'codex-session.jsonl');
            const capture = sandbox.stub(agent, 'captureSessionIdForWorktree').resolves({ sessionId, logPath });
            let onPolling!: () => void;
            const pollingStarted = new Promise<void>(resolve => { onPolling = resolve; });
            const polling = sandbox.stub(Polling, 'startPolling').callsFake(() => onPolling());
            const send = sandbox.stub(Tmux, 'sendCommand').resolves();
            sandbox.stub(Tmux, 'isTmuxInstalled').resolves(true);
            sandbox.stub(Tmux, 'sessionExists').resolves(false);
            sandbox.stub(Tmux, 'createSession').resolves();

            await TerminalService.openAgentTerminal(path.basename(sessionPath), sessionPath, undefined, undefined, undefined, agent, repoRoot);
            await pollingStarted;
            assert.strictEqual(capture.firstCall.args[1], repoRoot);
            assert.strictEqual(polling.firstCall.args[2], sessionPath);
            assert.strictEqual((await getQuickSession(sessionPath))?.sessionId, sessionId);
            assert.strictEqual((await getQuickSession(sessionPath))?.agentName, 'codex');
            await closeTerminal(terminal as unknown as vscode.Terminal);
            assert.strictEqual((await SessionData.getAgentStatus(sessionPath))?.status, 'idle');

            terminal.sendText.resetHistory();
            send.resetHistory();
            await TerminalService.openAgentTerminal(path.basename(sessionPath), sessionPath, undefined, undefined, undefined, agent, repoRoot);
            const commands = terminalMode === 'tmux' ? send.getCalls().map(call => call.args[1]) : terminal.sendText.getCalls().map(call => call.args[0]);
            assert.ok(commands.some(command => command.includes(`resume ${sessionId}`)));
            sinon.assert.calledOnce(capture);
            fs.rmSync(sessionPath, { recursive: true, force: true });
            await closeTerminal(terminal as unknown as vscode.Terminal);
            assert.ok(!fs.existsSync(sessionPath), 'Closing a deleted quick session must not recreate its metadata directory');
        });
    }

    test('renames, opens and clears quick sessions through the existing commands', async () => {
        const handlers = registerCommands();
        sandbox.stub(vscode.window, 'showInputBox').resolves('Planning');
        const open = sandbox.stub(TerminalService, 'openAgentTerminal').resolves();
        let item = await quickItem();
        await handlers.get('lanes.renameSession')!(item);
        item = await quickItem();
        assert.strictEqual(item.label, 'Planning');
        await handlers.get('lanes.openSession')!(item);
        assert.strictEqual(open.firstCall.args[1], sessionPath);
        assert.strictEqual(open.firstCall.args[5]?.name, 'claude');
        const dispose = sandbox.stub();
        sandbox.stub(vscode.window, 'terminals').get(() => [{ name: 'Claude: quick-start-claude-test', dispose }]);
        const metadata = JSON.parse(fs.readFileSync(SessionData.getSessionFilePath(sessionPath), 'utf8'));
        fs.writeFileSync(SessionData.getSessionFilePath(sessionPath), JSON.stringify({ ...metadata, sessionId: 'old-session' }));
        await handlers.get('lanes.clearSession')!(item);
        sinon.assert.calledOnce(dispose);
        assert.strictEqual((await getQuickSession(sessionPath))?.sessionId, undefined);
        assert.strictEqual((await getQuickSession(sessionPath))?.alias, 'Planning');
        assert.strictEqual(open.secondCall.args[1], sessionPath);
        assert.strictEqual(open.secondCall.args[7], true);
    });

    test('deletes quick session metadata without touching Git, projects or repository contents', async () => {
        const handlers = registerCommands();
        sandbox.stub(vscode.window, 'showWarningMessage').resolves('Delete' as never);
        sandbox.stub(vscode.window, 'terminals').get(() => []);
        const git = sandbox.stub(gitAdapter, 'execGit');
        const removeProject = sandbox.stub(ProjectManager, 'removeProject');
        const keepPath = path.join(repoRoot, 'keep.txt');
        fs.writeFileSync(keepPath, 'keep');
        await provider.pinSession(sessionPath);
        await handlers.get('lanes.deleteSession')!(await quickItem());
        sinon.assert.notCalled(git);
        sinon.assert.notCalled(removeProject);
        assert.ok(!fs.existsSync(sessionPath));
        assert.strictEqual(fs.readFileSync(keepPath, 'utf8'), 'keep');
        assert.deepStrictEqual(await provider.getChildren(), []);
        assert.deepStrictEqual(provider.getPinnedSessions(), []);
    });

    test('configures MCP without workflows for settings-based agents too', async () => {
        const worktree = path.join(repoRoot, '.worktrees', 'pi-session');
        fs.mkdirSync(worktree, { recursive: true });
        await prepareAgentLaunchContext({ worktreePath: worktree, repoRoot, codeAgent: getAgent('pi')! });
        const config = JSON.parse(fs.readFileSync(path.join(worktree, '.pi', 'mcp.json'), 'utf8'));
        assert.ok(!config.mcpServers['lanes-workflow'].args.includes('--workflow-path'));
    });
});
