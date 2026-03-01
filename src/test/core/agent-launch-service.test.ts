import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import sinon from 'sinon';
import * as SettingsService from '../../core/services/SettingsService';
import * as SessionDataService from '../../core/session/SessionDataService';
import * as discovery from '../../core/workflow/discovery';
import { getAgent } from '../../core/codeAgents';
import { prepareAgentLaunchContext } from '../../core/services/AgentLaunchService';
import type { McpConfig } from '../../core/codeAgents';

suite('AgentLaunchService', () => {
    let settingsStub: sinon.SinonStub;
    let baseRepoStub: sinon.SinonStub;
    let sessionWorkflowStub: sinon.SinonStub;
    let sessionPermissionStub: sinon.SinonStub;
    let sessionIdStub: sinon.SinonStub;
    let discoverStub: sinon.SinonStub;
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-als-'));
        settingsStub = sinon.stub(SettingsService, 'getOrCreateExtensionSettingsFile');
        baseRepoStub = sinon.stub(SettingsService, 'getBaseRepoPath');
        sessionWorkflowStub = sinon.stub(SessionDataService, 'getSessionWorkflow');
        sessionPermissionStub = sinon.stub(SessionDataService, 'getSessionPermissionMode');
        sessionIdStub = sinon.stub(SessionDataService, 'getSessionId');
        discoverStub = sinon.stub(discovery, 'discoverWorkflows');

        // Sensible defaults — settingsPath must exist on disk so writeFile succeeds
        const settingsDir = path.join(tempDir, 'settings-dir');
        fs.mkdirSync(settingsDir, { recursive: true });
        settingsStub.resolves(path.join(settingsDir, 'settings.json'));
        baseRepoStub.resolves('/repo');
        sessionWorkflowStub.resolves(null);
        sessionPermissionStub.resolves(null);
        sessionIdStub.resolves(null);
        discoverStub.resolves([]);
    });

    teardown(() => {
        settingsStub.restore();
        baseRepoStub.restore();
        sessionWorkflowStub.restore();
        sessionPermissionStub.restore();
        sessionIdStub.restore();
        discoverStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // ── Workflow resolution ─────────────────────────────────────────

    suite('workflow resolution', () => {
        test('absolute .yaml path is passed through without discovery', async () => {
            const absPath = '/workflows/my-workflow.yaml';
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                workflow: absPath,
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.effectiveWorkflow, absPath);
            sinon.assert.notCalled(discoverStub);
        });

        test('workflow name is resolved via discovery', async () => {
            discoverStub.resolves([
                { name: 'feature-dev', path: '/repo/.lanes/workflows/feature-dev.yaml', isBuiltIn: false, description: '' },
            ]);
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                workflow: 'feature-dev',
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.effectiveWorkflow, '/repo/.lanes/workflows/feature-dev.yaml');
        });

        test('not-found workflow warns and nullifies', async () => {
            discoverStub.resolves([]);
            const warnings: string[] = [];
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                workflow: 'nonexistent',
                repoRoot: '/repo',
                onWarning: (msg) => warnings.push(msg),
            });
            assert.strictEqual(ctx.effectiveWorkflow, null);
            assert.ok(warnings.some(w => w.includes('nonexistent')));
        });

        test('falls back to session-stored workflow', async () => {
            sessionWorkflowStub.resolves('/stored/workflow.yaml');
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.effectiveWorkflow, '/stored/workflow.yaml');
        });

        test('passes extensionPath and customWorkflowsFolder to discovery', async () => {
            discoverStub.resolves([
                { name: 'my-wf', path: '/ext/workflows/my-wf.yaml', isBuiltIn: true, description: '' },
            ]);
            await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                workflow: 'my-wf',
                repoRoot: '/repo',
                extensionPath: '/ext',
                customWorkflowsFolder: 'custom/wf',
            });
            sinon.assert.calledOnce(discoverStub);
            const args = discoverStub.firstCall.args[0];
            assert.strictEqual(args.extensionPath, '/ext');
            assert.strictEqual(args.customWorkflowsFolder, 'custom/wf');
        });
    });

    // ── Permission mode ─────────────────────────────────────────────

    suite('permission mode', () => {
        test('uses explicit value', async () => {
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                permissionMode: 'fullAuto',
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.effectivePermissionMode, 'fullAuto');
        });

        test('falls back to session-stored value', async () => {
            sessionPermissionStub.resolves('bypassPermissions');
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.effectivePermissionMode, 'bypassPermissions');
        });

        test('defaults to acceptEdits', async () => {
            sessionPermissionStub.resolves(null);
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.effectivePermissionMode, 'acceptEdits');
        });
    });

    // ── MCP routing ─────────────────────────────────────────────────

    suite('MCP routing', () => {
        test('writes mcp-config.json for cli delivery', async () => {
            const agent = getAgent('claude')!;
            assert.ok(agent);
            const workflowPath = '/repo/workflow.yaml';

            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                workflow: workflowPath,
                codeAgent: agent,
                repoRoot: '/repo',
            });

            assert.ok(ctx.mcpConfigPath);
            assert.ok(ctx.mcpConfigPath!.endsWith('mcp-config.json'));
            // Verify the file was actually written to disk
            const content = fs.readFileSync(ctx.mcpConfigPath!, 'utf-8');
            const parsed = JSON.parse(content);
            assert.ok(parsed.mcpServers);
        });

        test('uses fallbackMcpConfigFactory when agent has no MCP', async () => {
            const workflowPath = '/repo/workflow.yaml';
            let factoryCalled = false;
            const fallbackConfig: McpConfig = {
                mcpServers: { 'test-server': { command: 'node', args: ['server.js'] } }
            };

            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                workflow: workflowPath,
                repoRoot: '/repo',
                // No codeAgent — so agent?.supportsMcp() is false
                fallbackMcpConfigFactory: () => {
                    factoryCalled = true;
                    return fallbackConfig;
                },
            });

            assert.ok(factoryCalled);
            assert.ok(ctx.mcpConfigPath);
        });

        test('skips MCP when no workflow', async () => {
            const agent = getAgent('claude')!;
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                codeAgent: agent,
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.mcpConfigPath, undefined);
            assert.strictEqual(ctx.mcpConfigOverrides, undefined);
        });
    });

    // ── Settings ─────────────────────────────────────────────────────

    suite('settings', () => {
        test('calls getOrCreateExtensionSettingsFile', async () => {
            const wt = path.join(tempDir, 'wt');
            await prepareAgentLaunchContext({
                worktreePath: wt,
                repoRoot: '/repo',
            });
            sinon.assert.calledOnce(settingsStub);
            assert.strictEqual(settingsStub.firstCall.args[0], wt);
        });

        test('clears settingsPath when agent has projectSettingsPath', async () => {
            const agent = getAgent('claude')!;
            const stub = sinon.stub(agent, 'getProjectSettingsPath').returns('/project/.claude/settings.json');

            try {
                const ctx = await prepareAgentLaunchContext({
                    worktreePath: path.join(tempDir, 'wt'),
                    codeAgent: agent,
                    repoRoot: '/repo',
                });
                assert.strictEqual(ctx.settingsPath, undefined);
            } finally {
                stub.restore();
            }
        });

        test('onWarning called on settings error', async () => {
            settingsStub.rejects(new Error('disk full'));
            const warnings: string[] = [];
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                repoRoot: '/repo',
                onWarning: (msg) => warnings.push(msg),
            });
            assert.ok(warnings.some(w => w.includes('disk full')));
            assert.strictEqual(ctx.settingsPath, undefined);
        });
    });

    // ── Session data ─────────────────────────────────────────────────

    suite('session data', () => {
        test('returns sessionData from getSessionId', async () => {
            const data = { sessionId: 'abc-123', timestamp: '2025-01-01' };
            sessionIdStub.resolves(data);
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                repoRoot: '/repo',
            });
            assert.deepStrictEqual(ctx.sessionData, data);
        });

        test('returns null sessionData when no session exists', async () => {
            sessionIdStub.resolves(null);
            const ctx = await prepareAgentLaunchContext({
                worktreePath: path.join(tempDir, 'wt'),
                repoRoot: '/repo',
            });
            assert.strictEqual(ctx.sessionData, null);
        });
    });
});
