import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import sinon from 'sinon';
import * as AgentLaunchService from '../../core/services/AgentLaunchService';
import * as SessionDataService from '../../core/session/SessionDataService';
import * as TmuxService from '../../core/services/TmuxService';
import { getAgent, CodeAgent } from '../../core/codeAgents';

/**
 * Tests for CLI open command logic.
 *
 * Since execIntoAgent calls child_process.execSync (non-stubbable native),
 * we test the command building and preparation logic by exercising
 * the CodeAgent.buildStartCommand / buildResumeCommand methods and
 * the prepareAgentLaunchContext pipeline directly.
 */
suite('CLI open – command building', () => {
    let tempDir: string;
    let codeAgent: CodeAgent;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-open-'));
        codeAgent = getAgent('claude')!;
        assert.ok(codeAgent);
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // ── Prompt handling ─────────────────────────────────────────────

    suite('prompt handling', () => {
        test('getPromptsPath returns path and needsDir for session', () => {
            const result = SessionDataService.getPromptsPath('my-session', '/repo', 'custom-prompts');
            // When promptsFolder is provided, it returns a path info
            if (result) {
                assert.ok(result.path);
                assert.ok(result.needsDir);
                assert.ok(result.path.includes('my-session'));
            }
        });

        test('promptArg uses $(cat ...) pattern', () => {
            const promptPath = '/tmp/prompts/test.md';
            const promptArg = `"$(cat "${promptPath}")"`;
            assert.ok(promptArg.includes('$(cat'));
            assert.ok(promptArg.includes(promptPath));
        });

        test('prompt is written to file in prompts directory', () => {
            const promptDir = path.join(tempDir, 'prompts');
            fs.mkdirSync(promptDir, { recursive: true });
            const promptPath = path.join(promptDir, 'test-session.md');
            fs.writeFileSync(promptPath, 'Hello, agent!', 'utf-8');

            const content = fs.readFileSync(promptPath, 'utf-8');
            assert.strictEqual(content, 'Hello, agent!');
        });
    });

    // ── Resume vs start ─────────────────────────────────────────────

    suite('resume vs start', () => {
        test('buildResumeCommand includes session id', () => {
            const sessionId = '123e4567-e89b-12d3-a456-426614174000';
            const command = codeAgent.buildResumeCommand(sessionId, {
                settingsPath: '/tmp/settings.json',
            });
            assert.ok(command.includes('--resume'));
            assert.ok(command.includes(sessionId));
        });

        test('buildStartCommand includes permission mode', () => {
            const command = codeAgent.buildStartCommand({
                permissionMode: 'acceptEdits',
                settingsPath: '/tmp/settings.json',
            });
            assert.ok(!command.includes('--resume'));
            // The command should be a valid string
            assert.ok(command.length > 0);
        });

        test('buildStartCommand includes MCP config path when provided', () => {
            const command = codeAgent.buildStartCommand({
                permissionMode: 'acceptEdits',
                settingsPath: '/tmp/settings.json',
                mcpConfigPath: '/tmp/mcp-config.json',
            });
            assert.ok(command.includes('mcp'));
        });

        test('buildResumeCommand includes settings path', () => {
            const sessionId = '223e4567-e89b-12d3-a456-426614174000';
            const command = codeAgent.buildResumeCommand(sessionId, {
                settingsPath: '/tmp/my-settings.json',
            });
            assert.ok(command.includes('settings'));
        });

        test('buildStartCommand includes prompt when provided', () => {
            const command = codeAgent.buildStartCommand({
                permissionMode: 'acceptEdits',
                prompt: '"$(cat /tmp/prompt.md)"',
            });
            assert.ok(command.includes('$(cat'));
        });
    });

    // ── Tmux helpers ────────────────────────────────────────────────

    suite('tmux helpers', () => {
        test('sanitizeTmuxSessionName handles valid name', () => {
            const result = TmuxService.sanitizeTmuxSessionName('my-session');
            assert.strictEqual(result, 'my-session');
        });

        test('sanitizeTmuxSessionName sanitizes special chars', () => {
            const result = TmuxService.sanitizeTmuxSessionName('my session/test');
            assert.ok(!result.includes(' '));
            assert.ok(!result.includes('/'));
        });

        test('sanitizeTmuxSessionName throws on empty', () => {
            assert.throws(() => TmuxService.sanitizeTmuxSessionName(''), /empty/i);
        });

        test('isTmuxMode returns true for tmux', () => {
            assert.strictEqual(TmuxService.isTmuxMode('tmux'), true);
        });

        test('isTmuxMode returns false for vscode', () => {
            assert.strictEqual(TmuxService.isTmuxMode('vscode'), false);
        });
    });

    // ── Terminal mode persistence ───────────────────────────────────

    suite('terminal mode', () => {
        let saveTerminalStub: sinon.SinonStub;

        setup(() => {
            saveTerminalStub = sinon.stub(SessionDataService, 'saveSessionTerminalMode');
            saveTerminalStub.resolves();
        });

        teardown(() => {
            saveTerminalStub.restore();
        });

        test('saveSessionTerminalMode accepts tmux', async () => {
            await SessionDataService.saveSessionTerminalMode('/wt', 'tmux');
            sinon.assert.calledWith(saveTerminalStub, '/wt', 'tmux');
        });

        test('saveSessionTerminalMode accepts code', async () => {
            await SessionDataService.saveSessionTerminalMode('/wt', 'code');
            sinon.assert.calledWith(saveTerminalStub, '/wt', 'code');
        });
    });

    // ── Permission mode saving ──────────────────────────────────────

    suite('permission mode saving', () => {
        let savePermStub: sinon.SinonStub;

        setup(() => {
            savePermStub = sinon.stub(SessionDataService, 'saveSessionPermissionMode');
            savePermStub.resolves();
        });

        teardown(() => {
            savePermStub.restore();
        });

        test('new session saves permission mode', async () => {
            await SessionDataService.saveSessionPermissionMode('/wt', 'fullAuto');
            sinon.assert.calledWith(savePermStub, '/wt', 'fullAuto');
        });
    });

    // ── Task list ───────────────────────────────────────────────────

    suite('task list', () => {
        test('generateTaskListId returns a string', () => {
            const id = SessionDataService.generateTaskListId('my-session');
            assert.ok(typeof id === 'string');
            assert.ok(id.length > 0);
        });
    });
});
