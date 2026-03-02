import * as assert from 'assert';
import sinon from 'sinon';
import * as FileService from '../../core/services/FileService';
import { CliConfigProvider } from '../../cli/adapters/CliConfigProvider';

suite('CliConfigProvider', () => {
    let readJsonStub: sinon.SinonStub;

    setup(() => {
        readJsonStub = sinon.stub(FileService, 'readJson');
    });

    teardown(() => {
        readJsonStub.restore();
    });

    test('get() returns DEFAULTS value before load', () => {
        const provider = new CliConfigProvider('/repo');
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), '.worktrees');
        assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'claude');
        assert.strictEqual(provider.get('lanes', 'permissionMode', 'fallback'), 'acceptEdits');
    });

    test('get() returns config file value after load', async () => {
        readJsonStub.resolves({ worktreesFolder: '.custom-worktrees', defaultAgent: 'codex' });
        const provider = new CliConfigProvider('/repo');
        await provider.load();
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'fallback'), '.custom-worktrees');
        assert.strictEqual(provider.get('lanes', 'defaultAgent', 'fallback'), 'codex');
    });

    test('falls back config → DEFAULTS → provided default', async () => {
        readJsonStub.resolves({ worktreesFolder: '.custom' });
        const provider = new CliConfigProvider('/repo');
        await provider.load();

        // Config has it
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'x'), '.custom');
        // Config doesn't have it, DEFAULTS does
        assert.strictEqual(provider.get('lanes', 'baseBranch', 'x'), '');
        // Neither config nor DEFAULTS — use provided default
        assert.strictEqual(provider.get('lanes', 'unknownKey', 'my-default'), 'my-default');
    });

    test('load() with missing file (readJson returns null) — get() still works', async () => {
        readJsonStub.resolves(null);
        const provider = new CliConfigProvider('/nonexistent');
        await provider.load();
        // Should fall through to DEFAULTS
        assert.strictEqual(provider.get('lanes', 'worktreesFolder', 'x'), '.worktrees');
        assert.strictEqual(provider.get('lanes', 'unknownKey', 'fallback'), 'fallback');
    });

    test('onDidChange returns a disposable', () => {
        const provider = new CliConfigProvider('/repo');
        const disposable = provider.onDidChange('lanes', () => {});
        assert.ok(disposable);
        assert.ok(typeof disposable.dispose === 'function');
        // Should not throw
        disposable.dispose();
    });

    test('reads from .lanes/config.json path', async () => {
        readJsonStub.resolves({});
        const provider = new CliConfigProvider('/my/repo');
        await provider.load();
        sinon.assert.calledOnce(readJsonStub);
        const calledPath = readJsonStub.firstCall.args[0];
        assert.ok(calledPath.includes('.lanes'));
        assert.ok(calledPath.includes('config.json'));
    });

    test('get() for unknown section falls back to provided default', () => {
        const provider = new CliConfigProvider('/repo');
        assert.strictEqual(provider.get('unknown-section', 'key', 'default-val'), 'default-val');
    });
});
