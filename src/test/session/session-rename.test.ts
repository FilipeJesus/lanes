import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import sinon from 'sinon';
import * as gitAdapter from '../../gitService';
import { ClaudeCodeAgent } from '../../core/codeAgents/ClaudeCodeAgent';
import * as DiffService from '../../core/services/DiffService';
import * as TmuxService from '../../core/services/TmuxService';
import { execGit } from '../../core/gitService';
import { getSessionFilePath, saveSessionAlias } from '../../core/session/SessionDataService';
import type { ServiceContainer } from '../../types/serviceContainer';
import { registerSessionCommands } from '../../vscode/commands/sessionCommands';
import { GitChangesPanel } from '../../vscode/providers/GitChangesPanel';
import { AgentSessionProvider, SessionItem, initializeGlobalStorageContext } from '../../vscode/providers/AgentSessionProvider';
import * as TerminalService from '../../vscode/services/TerminalService';
import * as ProjectManagerService from '../../vscode/ProjectManagerService';

suite('Session Rename', () => {
    let tempDir: string;
    let worktreePath: string;
    let provider: AgentSessionProvider;
    let item: SessionItem;
    let handlers: Map<string, (...args: unknown[]) => unknown>;
    let inputStub: sinon.SinonStub;
    let errorStub: sinon.SinonStub;
    let refreshSpy: sinon.SinonSpy;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-rename-'));
        worktreePath = path.join(tempDir, '.worktrees', 'original-branch');
        fs.mkdirSync(worktreePath, { recursive: true });
        await initializeGlobalStorageContext(vscode.Uri.file(path.join(tempDir, 'storage')), tempDir);
        provider = new AgentSessionProvider(tempDir);
        item = new SessionItem('original-branch', worktreePath, vscode.TreeItemCollapsibleState.None);
        handlers = new Map();
        sinon.stub(vscode.commands, 'registerCommand').callsFake((command, callback) => {
            handlers.set(command, callback);
            return { dispose() {} };
        });
        sinon.stub(GitChangesPanel, 'setOnBranchChange');
        inputStub = sinon.stub(vscode.window, 'showInputBox');
        errorStub = sinon.stub(vscode.window, 'showErrorMessage');
        refreshSpy = sinon.spy(provider, 'refresh');
        const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
        registerSessionCommands(context, {
            sessionProvider: provider,
            baseRepoPath: tempDir,
            codeAgent: new ClaudeCodeAgent(),
        } as unknown as ServiceContainer);
    });

    teardown(() => {
        sinon.restore();
        provider.dispose();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('renames the displayed session and preserves the actual Git branch and worktree', async () => {
        await execGit(['init', '-b', 'main'], tempDir);
        await execGit(['-c', 'user.name=Lanes Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'Initial'], tempDir);
        await execGit(['worktree', 'add', '-b', 'original-branch', worktreePath], tempDir);
        const branchBefore = await execGit(['branch', '--show-current'], worktreePath);
        inputStub.resolves('  Fix login: review / polish 🚀  ');

        await handlers.get('lanes.renameSession')!(item);

        sinon.assert.calledOnce(refreshSpy);
        const [renamed] = await new AgentSessionProvider(tempDir).getChildren();
        assert.ok(renamed instanceof SessionItem);
        assert.strictEqual(renamed.label, 'Fix login: review / polish 🚀');
        assert.strictEqual(renamed.sessionName, 'original-branch');
        assert.strictEqual(renamed.worktreePath, worktreePath);
        assert.strictEqual(renamed.id, item.id);
        assert.strictEqual(await execGit(['branch', '--show-current'], worktreePath), branchBefore);
        assert.strictEqual(inputStub.firstCall.args[0].value, 'original-branch');
        sinon.assert.notCalled(errorStub);
    });

    test('prefills the existing alias and validates that names are not empty', async () => {
        item = new SessionItem('Existing alias', worktreePath, vscode.TreeItemCollapsibleState.None);
        inputStub.resolves(undefined);

        await handlers.get('lanes.renameSession')!(item);

        const options = inputStub.firstCall.args[0] as vscode.InputBoxOptions;
        assert.strictEqual(options.value, 'Existing alias');
        assert.ok(await options.validateInput!('  '));
        assert.strictEqual(await options.validateInput!('Name with spaces / punctuation'), null);
    });

    test('cancelling preserves the alias without refreshing the tree', async () => {
        await saveSessionAlias(worktreePath, 'Saved name');
        const before = fs.readFileSync(getSessionFilePath(worktreePath), 'utf8');
        inputStub.resolves(undefined);

        await handlers.get('lanes.renameSession')!(item);

        assert.strictEqual(fs.readFileSync(getSessionFilePath(worktreePath), 'utf8'), before);
        sinon.assert.notCalled(refreshSpy);
    });

    test('reports save errors without refreshing or overwriting existing metadata', async () => {
        const sessionPath = getSessionFilePath(worktreePath);
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
        fs.writeFileSync(sessionPath, 'invalid json');
        inputStub.resolves('New name');

        await handlers.get('lanes.renameSession')!(item);

        sinon.assert.calledOnce(errorStub);
        assert.ok(errorStub.firstCall.args[0].startsWith('Failed to rename session:'));
        assert.strictEqual(fs.readFileSync(sessionPath, 'utf8'), 'invalid json');
        sinon.assert.notCalled(refreshSpy);
    });

    test('requires a selected session', async () => {
        await handlers.get('lanes.renameSession')!();

        sinon.assert.calledOnce(errorStub);
        sinon.assert.notCalled(inputStub);
    });

    test('uses the original terminal identity when opening an aliased session', async () => {
        const openStub = sinon.stub(TerminalService, 'openAgentTerminal').resolves();
        item = new SessionItem('Friendly name / review', worktreePath, vscode.TreeItemCollapsibleState.None);

        await handlers.get('lanes.openSession')!(item);

        assert.strictEqual(openStub.firstCall.args[0], 'original-branch');
        assert.strictEqual(openStub.firstCall.args[1], worktreePath);
    });

    test('detects an existing terminal before opening an aliased session in a new window', async () => {
        sinon.stub(vscode.window, 'terminals').get(() => [{ name: 'Claude: original-branch' }]);
        const pickerStub = sinon.stub(vscode.window, 'showQuickPick').resolves(undefined);
        const executeStub = sinon.stub(vscode.commands, 'executeCommand');
        item = new SessionItem('Friendly name', worktreePath, vscode.TreeItemCollapsibleState.None);

        await handlers.get('lanes.openInNewWindow')!(item);

        sinon.assert.calledOnce(pickerStub);
        sinon.assert.notCalled(executeStub);
    });

    test('numbers shell terminals using the original session identity after a rename', async () => {
        sinon.stub(vscode.window, 'terminals').get(() => [{ name: 'original-branch [1]' }]);
        const showStub = sinon.stub();
        const createStub = sinon.stub(vscode.window, 'createTerminal').returns({ show: showStub } as unknown as vscode.Terminal);
        item = new SessionItem('Friendly name / review', worktreePath, vscode.TreeItemCollapsibleState.None);

        await TerminalService.createTerminalForSession(item);

        const options = createStub.firstCall.args[0] as vscode.TerminalOptions;
        assert.strictEqual(options.name, 'original-branch [2]');
        assert.strictEqual(options.cwd, worktreePath);
        sinon.assert.calledOnce(showStub);
        sinon.assert.notCalled(errorStub);
    });

    test('shows Git changes for an alias containing characters invalid in a branch name', async () => {
        sinon.stub(DiffService, 'getBaseBranch').resolves('main');
        const diffStub = sinon.stub(DiffService, 'generateDiffContent').resolves('test diff');
        const panelStub = sinon.stub(GitChangesPanel, 'createOrShow');
        item = new SessionItem('Friendly name / review', worktreePath, vscode.TreeItemCollapsibleState.None);

        await handlers.get('lanes.showGitChanges')!(item);

        sinon.assert.calledOnce(diffStub);
        assert.strictEqual(panelStub.firstCall.args[1], 'original-branch');
        sinon.assert.notCalled(errorStub);
    });

    test('deletes the original tmux session when the display name is aliased', async () => {
        const sessionPath = getSessionFilePath(worktreePath);
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
        fs.writeFileSync(sessionPath, JSON.stringify({ terminal: 'tmux', alias: 'Friendly name' }));
        sinon.stub(vscode.window, 'showWarningMessage').resolves('Delete' as never);
        sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
        const killStub = sinon.stub(TmuxService, 'killSession').resolves();
        sinon.stub(gitAdapter, 'execGit').resolves('');
        sinon.stub(ProjectManagerService, 'removeProject').resolves(true);
        item = new SessionItem('Friendly name', worktreePath, vscode.TreeItemCollapsibleState.None);

        await handlers.get('lanes.deleteSession')!(item);

        sinon.assert.calledWithExactly(killStub, 'original-branch');
        assert.ok(!fs.existsSync(path.dirname(sessionPath)));
        sinon.assert.notCalled(errorStub);
    });
});
