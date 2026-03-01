import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import sinon from 'sinon';
import * as SettingsService from '../../core/services/SettingsService';
import * as SessionDataService from '../../core/session/SessionDataService';
import { getAgent } from '../../core/codeAgents';
import { buildAgentLaunchCommand, prepareAgentLaunchContext } from '../../core/services/AgentLaunchSetupService';

suite('AgentLaunchSetupService', () => {
    let settingsStub: sinon.SinonStub;
    let baseRepoStub: sinon.SinonStub;
    let sessionWorkflowStub: sinon.SinonStub;
    let sessionPermissionStub: sinon.SinonStub;
    let sessionIdStub: sinon.SinonStub;

    setup(() => {
        settingsStub = sinon.stub(SettingsService, 'getOrCreateExtensionSettingsFile');
        baseRepoStub = sinon.stub(SettingsService, 'getBaseRepoPath');
        sessionWorkflowStub = sinon.stub(SessionDataService, 'getSessionWorkflow');
        sessionPermissionStub = sinon.stub(SessionDataService, 'getSessionPermissionMode');
        sessionIdStub = sinon.stub(SessionDataService, 'getSessionId');
    });

    teardown(() => {
        settingsStub.restore();
        baseRepoStub.restore();
        sessionWorkflowStub.restore();
        sessionPermissionStub.restore();
        sessionIdStub.restore();
    });

    test('builds command with settings and mcp config for workflow sessions', async () => {
        const codeAgent = getAgent('claude');
        assert.ok(codeAgent);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-launch-setup-'));
        const settingsPath = path.join(tempDir, 'claude-settings.json');
        const workflowPath = path.join(tempDir, 'workflow.yaml');
        fs.writeFileSync(workflowPath, 'name: test\n');

        settingsStub.resolves(settingsPath);
        baseRepoStub.resolves('/repo');
        sessionWorkflowStub.resolves(null);
        sessionPermissionStub.resolves('acceptEdits');
        sessionIdStub.resolves(null);

        const context = await prepareAgentLaunchContext({
            worktreePath: path.join(tempDir, 'worktree'),
            workflow: workflowPath,
            codeAgent: codeAgent!,
            repoRoot: '/repo'
        });
        const launch = await buildAgentLaunchCommand(context, { preferResume: false });

        assert.ok(context.settingsPath?.endsWith('claude-settings.json'));
        assert.ok(context.mcpConfigPath?.endsWith('mcp-config.json'));
        assert.ok(launch.command.includes('--settings'));
        assert.ok(launch.command.includes('--mcp-config'));
        assert.strictEqual(launch.mode, 'start');
    });

    test('builds resume command when session id exists', async () => {
        const codeAgent = getAgent('claude');
        assert.ok(codeAgent);
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-launch-setup-resume-'));
        const settingsPath = path.join(tempDir, 'claude-settings.json');

        settingsStub.resolves(settingsPath);
        baseRepoStub.resolves('/repo');
        sessionWorkflowStub.resolves(null);
        sessionPermissionStub.resolves('acceptEdits');
        sessionIdStub.resolves({
            sessionId: '123e4567-e89b-12d3-a456-426614174000',
            timestamp: new Date().toISOString()
        });

        const context = await prepareAgentLaunchContext({
            worktreePath: path.join(tempDir, 'worktree'),
            workflow: null,
            codeAgent: codeAgent!,
            repoRoot: '/repo'
        });
        const launch = await buildAgentLaunchCommand(context);

        assert.ok(launch.command.includes('--resume 123e4567-e89b-12d3-a456-426614174000'));
        assert.ok(launch.command.includes('--settings'));
        assert.strictEqual(launch.mode, 'resume');
    });
});
