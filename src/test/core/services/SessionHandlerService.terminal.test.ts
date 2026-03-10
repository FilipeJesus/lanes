/**
 * Tests for SessionHandlerService — handleTerminalOutput and handleTerminalResize.
 *
 * Covers:
 *  - handleTerminalOutput: valid name returns { content, rows, cols }
 *  - handleTerminalOutput: invalid name throws validation error
 *  - handleTerminalResize: valid name and dimensions returns { success: true }
 *  - handleTerminalResize: invalid name throws validation error
 *  - handleTerminalResize: missing cols or rows throws validation error
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import { SessionHandlerService } from '../../../core/services/SessionHandlerService';
import type {
    IHandlerContext,
    ISimpleConfigStore,
    INotificationEmitter,
    IFileWatchManager,
} from '../../../core/interfaces/IHandlerContext';
import * as TmuxService from '../../../core/services/TmuxService';

// ---------------------------------------------------------------------------
// Minimal stub implementations
// ---------------------------------------------------------------------------

class StubConfigStore implements ISimpleConfigStore {
    private readonly data: Record<string, unknown>;

    constructor(initial: Record<string, unknown> = {}) {
        this.data = { ...initial };
    }

    get(key: string): unknown {
        return this.data[key];
    }

    async set(key: string, value: unknown): Promise<void> {
        this.data[key] = value;
    }

    getAll(prefix?: string): Record<string, unknown> {
        if (!prefix) {
            return { ...this.data };
        }
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(this.data)) {
            if (k.startsWith(prefix)) {
                result[k] = v;
            }
        }
        return result;
    }
}

class StubNotificationEmitter implements INotificationEmitter {
    sessionStatusChanged(
        _sessionName: string,
        _status: { status: string; timestamp?: string; message?: string }
    ): void {}

    fileChanged(_filePath: string, _eventType: 'created' | 'changed' | 'deleted'): void {}

    sessionCreated(_sessionName: string, _worktreePath: string): void {}

    sessionDeleted(_sessionName: string): void {}
}

class StubFileWatchManager implements IFileWatchManager {
    private nextId = 0;

    watch(_basePath: string, _pattern: string): string {
        return `watch-${this.nextId++}`;
    }

    async unwatch(_watchId: string): Promise<boolean> {
        return true;
    }

    dispose(): void {}
}

function makeContext(
    workspaceRoot: string,
    configOverrides: Record<string, unknown> = {}
): IHandlerContext {
    return {
        workspaceRoot,
        config: new StubConfigStore(configOverrides),
        notificationEmitter: new StubNotificationEmitter(),
        fileWatchManager: new StubFileWatchManager(),
    };
}

// ---------------------------------------------------------------------------
// Suite: SessionHandlerService - handleTerminalOutput
// ---------------------------------------------------------------------------

suite('SessionHandlerService - handleTerminalOutput', () => {
    let tempDir: string;
    let service: SessionHandlerService;
    let capturePaneStub: sinon.SinonStub;
    let getPaneSizeStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-terminal-output-'));
        service = new SessionHandlerService(makeContext(tempDir));

        // Stub TmuxService functions used by TmuxTerminalIOProvider internally
        capturePaneStub = sinon.stub(TmuxService, 'capturePane');
        getPaneSizeStub = sinon.stub(TmuxService, 'getPaneSize');
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given a valid terminal name, when handleTerminalOutput is called, then it returns { content, rows, cols }', async () => {
        // Arrange
        capturePaneStub.resolves('some terminal output\n');
        getPaneSizeStub.resolves({ cols: 80, rows: 24 });

        // Act
        const result = await service.handleTerminalOutput({ name: 'valid-terminal' }) as {
            content: string;
            rows: number;
            cols: number;
        };

        // Assert
        assert.strictEqual(result.content, 'some terminal output\n');
        assert.strictEqual(result.rows, 24);
        assert.strictEqual(result.cols, 80);
    });

    test('Given an invalid terminal name, when handleTerminalOutput is called, then it throws a validation error', async () => {
        // Arrange — name contains slashes which are not allowed
        const invalidNames = ['../etc/passwd', 'feat/branch', 'bad name', 'bad!name'];

        for (const invalidName of invalidNames) {
            let thrown: unknown;
            try {
                await service.handleTerminalOutput({ name: invalidName });
            } catch (err) {
                thrown = err;
            }

            assert.ok(
                thrown instanceof Error,
                `Should throw an Error for invalid terminal name '${invalidName}'`
            );
            const message = (thrown as Error).message.toLowerCase();
            assert.ok(
                message.includes('invalid') || message.includes('terminal') || message.includes('required'),
                `Error should indicate invalid terminal name for '${invalidName}', got: ${(thrown as Error).message}`
            );
        }
    });
});

// ---------------------------------------------------------------------------
// Suite: SessionHandlerService - handleTerminalResize
// ---------------------------------------------------------------------------

suite('SessionHandlerService - handleTerminalResize', () => {
    let tempDir: string;
    let service: SessionHandlerService;
    let resizePaneStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-terminal-resize-'));
        service = new SessionHandlerService(makeContext(tempDir));

        // Stub TmuxService.resizePane used by TmuxTerminalIOProvider internally
        resizePaneStub = sinon.stub(TmuxService, 'resizePane');
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('Given a valid terminal name and dimensions, when handleTerminalResize is called, then it returns { success: true }', async () => {
        // Arrange
        resizePaneStub.resolves();

        // Act
        const result = await service.handleTerminalResize({
            name: 'valid-terminal',
            cols: 120,
            rows: 40,
        }) as { success: boolean };

        // Assert
        assert.strictEqual(result.success, true);
        assert.ok(
            resizePaneStub.calledOnceWith('valid-terminal', 120, 40),
            'resizePane should be called with the terminal name, cols, and rows'
        );
    });

    test('Given an invalid terminal name, when handleTerminalResize is called, then it throws a validation error', async () => {
        // Arrange — name contains path separators / special chars
        let thrown: unknown;
        try {
            await service.handleTerminalResize({ name: 'bad/name', cols: 80, rows: 24 });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error for invalid terminal name');
        const message = (thrown as Error).message.toLowerCase();
        assert.ok(
            message.includes('invalid') || message.includes('terminal'),
            `Error should indicate invalid terminal name, got: ${(thrown as Error).message}`
        );
    });

    test('Given missing cols, when handleTerminalResize is called, then it throws a validation error', async () => {
        // Act & Assert
        let thrown: unknown;
        try {
            await service.handleTerminalResize({ name: 'valid-terminal', rows: 24 });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error when cols is missing');
        const message = (thrown as Error).message.toLowerCase();
        assert.ok(
            message.includes('cols') || message.includes('missing') || message.includes('required'),
            `Error should mention missing cols/rows, got: ${(thrown as Error).message}`
        );
    });

    test('Given missing rows, when handleTerminalResize is called, then it throws a validation error', async () => {
        // Act & Assert
        let thrown: unknown;
        try {
            await service.handleTerminalResize({ name: 'valid-terminal', cols: 80 });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error when rows is missing');
        const message = (thrown as Error).message.toLowerCase();
        assert.ok(
            message.includes('rows') || message.includes('missing') || message.includes('required'),
            `Error should mention missing cols/rows, got: ${(thrown as Error).message}`
        );
    });
});
