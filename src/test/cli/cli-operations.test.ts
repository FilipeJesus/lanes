import * as assert from 'assert';
import sinon from 'sinon';
import * as targeting from '../../cli/targeting';
import { withCliOperations } from '../../cli/operations';

suite('CLI operations', () => {
    teardown(() => {
        sinon.restore();
    });

    test('local workflow list is served through the shared daemon operations facade', async () => {
        const client = {
            listWorkflows: sinon.stub().resolves({
                workflows: [
                    { name: 'ship-it', description: 'Deploy it', isBuiltin: true },
                ],
            }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'local',
            client: client as unknown as targeting.CliLocalDaemonTarget['client'],
        });

        const workflows = await withCliOperations('/repo', {}, {}, async (operations) => {
            assert.strictEqual(operations.targetKind, 'local');
            assert.strictEqual(operations.host, undefined);
            return operations.listWorkflows();
        });

        assert.deepStrictEqual(workflows, [
            { name: 'ship-it', description: 'Deploy it', isBuiltin: true },
        ]);
        sinon.assert.calledOnce(client.listWorkflows);
    });

    test('remote workflow list is served through the shared daemon operations facade', async () => {
        const client = {
            listWorkflows: sinon.stub().resolves({
                workflows: [
                    { name: 'ship-it', description: 'Deploy it', isBuiltin: true },
                ],
            }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'remote',
            host: 'https://remote.example.test',
            client: client as unknown as targeting.CliRemoteDaemonTarget['client'],
        });

        const workflows = await withCliOperations('/repo', {}, { host: 'https://remote.example.test' }, async (operations) => {
            assert.strictEqual(operations.targetKind, 'remote');
            assert.strictEqual(operations.host, 'https://remote.example.test');
            return operations.listWorkflows();
        });

        assert.deepStrictEqual(workflows, [
            { name: 'ship-it', description: 'Deploy it', isBuiltin: true },
        ]);
        sinon.assert.calledOnce(client.listWorkflows);
    });

    test('createSession returns a daemon launch request for the local daemon target', async () => {
        const client = {
            createSession: sinon.stub().resolves({
                worktreePath: '/repo/.worktrees/feat-demo',
                command: 'claude',
                tmuxSessionName: 'lanes-feat-demo',
            }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'local',
            client: client as unknown as targeting.CliLocalDaemonTarget['client'],
        });

        const launch = await withCliOperations('/repo', {}, {}, async (operations) => operations.createSession({
            sessionName: 'feat-demo',
            agentName: 'claude',
            prompt: 'hello',
            workflow: 'ship-it',
            permissionMode: 'acceptEdits',
            preferTmux: true,
        }));

        assert.strictEqual(launch.kind, 'daemon');
        assert.strictEqual(launch.sessionName, 'feat-demo');
        assert.strictEqual(launch.target.kind, 'local');
        assert.strictEqual(launch.launch.worktreePath, '/repo/.worktrees/feat-demo');
        sinon.assert.calledOnceWithExactly(client.createSession, {
            name: 'feat-demo',
            branch: undefined,
            agent: 'claude',
            prompt: 'hello',
            workflow: 'ship-it',
            permissionMode: 'acceptEdits',
            tmux: true,
        });
    });

    test('workflow creation is delegated to the daemon client', async () => {
        const client = {
            createWorkflow: sinon.stub().resolves({ path: '/repo/.lanes/workflows/ship-it.yaml' }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'local',
            client: client as unknown as targeting.CliLocalDaemonTarget['client'],
        });

        const result = await withCliOperations('/repo', {}, {}, async (operations) => operations.createWorkflow({
            name: 'ship-it',
            from: 'starter',
        }));

        assert.deepStrictEqual(result, { path: '/repo/.lanes/workflows/ship-it.yaml' });
        sinon.assert.calledOnceWithExactly(client.createWorkflow, {
            name: 'ship-it',
            from: 'starter',
        });
    });

    test('workflow validation is delegated to the daemon client', async () => {
        const client = {
            validateWorkflow: sinon.stub().resolves({ isValid: true, errors: [] }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'local',
            client: client as unknown as targeting.CliLocalDaemonTarget['client'],
        });

        const result = await withCliOperations('/repo', {}, {}, async (operations) => operations.validateWorkflow({
            content: 'name: ship-it\nsteps: []\n',
        }));

        assert.deepStrictEqual(result, { isValid: true, errors: [] });
        sinon.assert.calledOnceWithExactly(client.validateWorkflow, {
            content: 'name: ship-it\nsteps: []\n',
        });
    });

    test('hook setup is delegated to the daemon client', async () => {
        const client = {
            setupSessionHooks: sinon.stub().resolves({
                settingsPath: '/repo/.lanes/current-sessions/feat-demo/claude-settings.json',
            }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'local',
            client: client as unknown as targeting.CliLocalDaemonTarget['client'],
        });

        const settingsPath = await withCliOperations('/repo', {}, {}, async (operations) => operations.setupSessionHooks('feat-demo'));

        assert.strictEqual(settingsPath, '/repo/.lanes/current-sessions/feat-demo/claude-settings.json');
        sinon.assert.calledOnceWithExactly(client.setupSessionHooks, 'feat-demo');
    });

    test('clearSession reopens through the local daemon target after clearing', async () => {
        const client = {
            clearSession: sinon.stub().resolves(),
            openSession: sinon.stub().resolves({
                worktreePath: '/repo/.worktrees/feat-demo',
                command: 'claude --resume',
                tmuxSessionName: 'lanes-feat-demo',
            }),
        };

        sinon.stub(targeting, 'resolveCliDaemonTarget').resolves({
            kind: 'local',
            client: client as unknown as targeting.CliLocalDaemonTarget['client'],
        });

        const launch = await withCliOperations('/repo', {}, {}, async (operations) => operations.clearSession('feat-demo', {
            preferTmux: true,
        }));

        assert.strictEqual(launch.kind, 'daemon');
        assert.strictEqual(launch.target.kind, 'local');
        sinon.assert.calledOnceWithExactly(client.clearSession, 'feat-demo');
        sinon.assert.calledOnceWithExactly(client.openSession, 'feat-demo', { tmux: true });
    });
});
