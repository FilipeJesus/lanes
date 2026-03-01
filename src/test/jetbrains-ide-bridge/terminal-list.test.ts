import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import * as TmuxService from '../../core/services/TmuxService';
import { ConfigStore } from '../../jetbrains-ide-bridge/config';
import { NotificationEmitter } from '../../jetbrains-ide-bridge/notifications';
import { handleRequest, initializeHandlers } from '../../jetbrains-ide-bridge/handlers';

suite('Bridge Handlers - terminal.list', () => {
    let tempDir: string;
    let listSessionsStub: sinon.SinonStub;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-bridge-terminal-list-'));
        const config = new ConfigStore(tempDir);
        await config.initialize();
        initializeHandlers(tempDir, config, new NotificationEmitter());

        listSessionsStub = sinon.stub(TmuxService, 'listSessions');
    });

    teardown(() => {
        listSessionsStub.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('returns terminals when tmux sessions exist', async () => {
        listSessionsStub.resolves(['feat-auth', 'feat-ui']);

        const result = await handleRequest('terminal.list', {}) as { terminals: Array<{ name: string; sessionName: string }> };

        assert.ok(Array.isArray(result.terminals), 'terminals should be an array');
        assert.strictEqual(result.terminals.length, 2);
        assert.ok(result.terminals.some(t => t.name === 'feat-auth'), 'feat-auth should be in list');
        assert.ok(result.terminals.some(t => t.name === 'feat-ui'), 'feat-ui should be in list');
    });

    test('returns empty array when no tmux sessions exist', async () => {
        listSessionsStub.resolves([]);

        const result = await handleRequest('terminal.list', {}) as { terminals: Array<unknown> };

        assert.ok(Array.isArray(result.terminals), 'terminals should be an array');
        assert.strictEqual(result.terminals.length, 0);
    });

    test('does not throw when tmux is not running', async () => {
        // TmuxService.listSessions already swallows errors and returns [], mirror that here
        listSessionsStub.resolves([]);

        let threw = false;
        try {
            await handleRequest('terminal.list', {});
        } catch {
            threw = true;
        }

        assert.strictEqual(threw, false, 'terminal.list should not throw when tmux is unavailable');
    });

    test('filters by sessionName when provided', async () => {
        listSessionsStub.resolves(['feat-auth', 'feat-ui', 'feat-backend']);

        const result = await handleRequest('terminal.list', { sessionName: 'feat-ui' }) as {
            terminals: Array<{ name: string; sessionName: string }>;
        };

        assert.strictEqual(result.terminals.length, 1, 'Only the matching session should be returned');
        assert.strictEqual(result.terminals[0].name, 'feat-ui');
        assert.strictEqual(result.terminals[0].sessionName, 'feat-ui');
    });

    test('each returned terminal object has name and sessionName fields', async () => {
        listSessionsStub.resolves(['my-session']);

        const result = await handleRequest('terminal.list', {}) as {
            terminals: Array<Record<string, unknown>>;
        };

        assert.strictEqual(result.terminals.length, 1);
        const terminal = result.terminals[0];
        assert.ok('name' in terminal, 'terminal should have a name field');
        assert.ok('sessionName' in terminal, 'terminal should have a sessionName field');
        assert.strictEqual(typeof terminal.name, 'string');
        assert.strictEqual(typeof terminal.sessionName, 'string');
    });

    test('returns empty array when sessionName filter matches nothing', async () => {
        listSessionsStub.resolves(['feat-auth', 'feat-ui']);

        const result = await handleRequest('terminal.list', { sessionName: 'nonexistent' }) as {
            terminals: Array<unknown>;
        };

        assert.strictEqual(result.terminals.length, 0);
    });
});
