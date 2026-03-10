/**
 * Tests for TmuxTerminalIOProvider.
 *
 * Covers:
 *  - readOutput: uses capturePane and getPaneSize, returns combined result
 *  - readOutput error propagation
 *  - sendInput: delegates to TmuxService.sendCommand
 *  - sendInput error propagation
 *  - resize: delegates to TmuxService.resizePane
 *  - isAvailable: delegates to TmuxService.sessionExists (true / false)
 */

import * as assert from 'assert';
import sinon from 'sinon';
import { TmuxTerminalIOProvider } from '../../../core/services/TmuxTerminalIOProvider';
import * as TmuxService from '../../../core/services/TmuxService';

// ---------------------------------------------------------------------------
// Suite: TmuxTerminalIOProvider - readOutput
// ---------------------------------------------------------------------------

suite('TmuxTerminalIOProvider - readOutput', () => {
    let capturePaneStub: sinon.SinonStub;
    let getPaneSizeStub: sinon.SinonStub;
    let provider: TmuxTerminalIOProvider;

    setup(() => {
        capturePaneStub = sinon.stub(TmuxService, 'capturePane');
        getPaneSizeStub = sinon.stub(TmuxService, 'getPaneSize');
        provider = new TmuxTerminalIOProvider();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Given a terminal name, when readOutput is called, then it returns content from capturePane and dimensions from getPaneSize', async () => {
        // Arrange
        capturePaneStub.resolves('terminal output content\n');
        getPaneSizeStub.resolves({ cols: 120, rows: 40 });

        // Act
        const result = await provider.readOutput('my-terminal');

        // Assert
        assert.ok(capturePaneStub.calledOnceWith('my-terminal'), 'capturePane should be called with the terminal name');
        assert.ok(getPaneSizeStub.calledOnceWith('my-terminal'), 'getPaneSize should be called with the terminal name');
        assert.strictEqual(result.content, 'terminal output content\n');
        assert.strictEqual(result.cols, 120);
        assert.strictEqual(result.rows, 40);
    });

    test('Given tmux operations fail, when readOutput is called, then the error is propagated', async () => {
        // Arrange
        capturePaneStub.rejects(new Error('capturePane failed'));
        getPaneSizeStub.resolves({ cols: 80, rows: 24 });

        // Act & Assert
        let thrown: unknown;
        try {
            await provider.readOutput('my-terminal');
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an error when capturePane fails');
    });
});

// ---------------------------------------------------------------------------
// Suite: TmuxTerminalIOProvider - sendInput
// ---------------------------------------------------------------------------

suite('TmuxTerminalIOProvider - sendInput', () => {
    let sendKeysStub: sinon.SinonStub;
    let provider: TmuxTerminalIOProvider;

    setup(() => {
        sendKeysStub = sinon.stub(TmuxService, 'sendKeys');
        provider = new TmuxTerminalIOProvider();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Given a terminal name and text, when sendInput is called, then it calls TmuxService.sendKeys with those arguments', async () => {
        // Arrange
        sendKeysStub.resolves();

        // Act
        await provider.sendInput('my-terminal', 'ls -la');

        // Assert
        assert.ok(
            sendKeysStub.calledOnceWith('my-terminal', 'ls -la'),
            'sendKeys should be called with the terminal name and text'
        );
    });

    test('Given tmux command fails, when sendInput is called, then the error is propagated', async () => {
        // Arrange
        sendKeysStub.rejects(new Error('Failed to send command to tmux session'));

        // Act & Assert
        let thrown: unknown;
        try {
            await provider.sendInput('my-terminal', 'some command');
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an error when sendKeys fails');
    });
});

// ---------------------------------------------------------------------------
// Suite: TmuxTerminalIOProvider - resize
// ---------------------------------------------------------------------------

suite('TmuxTerminalIOProvider - resize', () => {
    let resizePaneStub: sinon.SinonStub;
    let provider: TmuxTerminalIOProvider;

    setup(() => {
        resizePaneStub = sinon.stub(TmuxService, 'resizePane');
        provider = new TmuxTerminalIOProvider();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Given a terminal name, cols and rows, when resize is called, then it calls TmuxService.resizePane with those arguments', async () => {
        // Arrange
        resizePaneStub.resolves();

        // Act
        await provider.resize('my-terminal', 120, 40);

        // Assert
        assert.ok(
            resizePaneStub.calledOnceWith('my-terminal', 120, 40),
            'resizePane should be called with the terminal name, cols, and rows'
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: TmuxTerminalIOProvider - isAvailable
// ---------------------------------------------------------------------------

suite('TmuxTerminalIOProvider - isAvailable', () => {
    let sessionExistsStub: sinon.SinonStub;
    let provider: TmuxTerminalIOProvider;

    setup(() => {
        sessionExistsStub = sinon.stub(TmuxService, 'sessionExists');
        provider = new TmuxTerminalIOProvider();
    });

    teardown(() => {
        sinon.restore();
    });

    test('Given an existing session, when isAvailable is called, then it returns true', async () => {
        // Arrange
        sessionExistsStub.resolves(true);

        // Act
        const result = await provider.isAvailable('existing-terminal');

        // Assert
        assert.strictEqual(result, true);
        assert.ok(
            sessionExistsStub.calledOnceWith('existing-terminal'),
            'sessionExists should be called with the terminal name'
        );
    });

    test('Given a non-existing session, when isAvailable is called, then it returns false', async () => {
        // Arrange
        sessionExistsStub.resolves(false);

        // Act
        const result = await provider.isAvailable('nonexistent-terminal');

        // Assert
        assert.strictEqual(result, false);
        assert.ok(
            sessionExistsStub.calledOnceWith('nonexistent-terminal'),
            'sessionExists should be called with the terminal name'
        );
    });
});
