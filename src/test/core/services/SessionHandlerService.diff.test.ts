/**
 * Tests for SessionHandlerService - handleGitGetDiff and handleGitGetDiffFiles
 * with baseBranch parameter support.
 *
 * Covers:
 *  - handleGitGetDiff uses params.baseBranch when provided instead of config
 *  - handleGitGetDiff uses config value when params.baseBranch is absent
 *  - handleGitGetDiff returns baseBranch in the response
 *  - handleGitGetDiffFiles uses params.baseBranch when provided instead of config
 *  - handleGitGetDiffFiles uses config value when params.baseBranch is absent
 *  - handleGitGetDiffFiles returns baseBranch in the response
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import {
    SessionHandlerService,
} from '../../../core/services/SessionHandlerService';
import type {
    IHandlerContext,
    ISimpleConfigStore,
    INotificationEmitter,
    IFileWatchManager,
} from '../../../core/interfaces/IHandlerContext';
import * as DiffService from '../../../core/services/DiffService';

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
// Suite: SessionHandlerService diff baseBranch
// ---------------------------------------------------------------------------

suite('SessionHandlerService diff baseBranch', () => {
    let tempDir: string;
    let service: SessionHandlerService;
    let getBaseBranchStub: sinon.SinonStub;
    let generateDiffContentStub: sinon.SinonStub;
    let generateDiffFilesStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-diff-test-'));
        // Create the expected worktree directory structure
        const worktreesDir = path.join(tempDir, '.worktrees');
        fs.mkdirSync(worktreesDir, { recursive: true });
        const sessionDir = path.join(worktreesDir, 'test-session');
        fs.mkdirSync(sessionDir, { recursive: true });

        service = new SessionHandlerService(makeContext(tempDir, {
            'lanes.baseBranch': 'config-base-branch',
        }));

        getBaseBranchStub = sinon.stub(DiffService, 'getBaseBranch');
        generateDiffContentStub = sinon.stub(DiffService, 'generateDiffContent');
        generateDiffFilesStub = sinon.stub(DiffService, 'generateDiffFiles');

        // Default stubs return resolved values
        getBaseBranchStub.resolves('origin/main');
        generateDiffContentStub.resolves('');
        generateDiffFilesStub.resolves([]);
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // diff-basebranch-params-override
    // -------------------------------------------------------------------------

    test('Given params.baseBranch is "main", when handleGitGetDiff is called, then DiffService.getBaseBranch is called with "main" as the baseBranch argument', async () => {
        getBaseBranchStub.withArgs(sinon.match.string, 'main').resolves('main');

        await service.handleGitGetDiff({ sessionName: 'test-session', baseBranch: 'main' });

        assert.ok(getBaseBranchStub.calledOnce, 'getBaseBranch should be called exactly once');
        const secondArg: string = getBaseBranchStub.firstCall.args[1] as string;
        assert.strictEqual(
            secondArg,
            'main',
            `Expected getBaseBranch to be called with "main" but got: ${secondArg}`
        );
    });

    test('Given params.baseBranch is absent, when handleGitGetDiff is called, then DiffService.getBaseBranch is called with the config value', async () => {
        getBaseBranchStub.resolves('config-base-branch');

        await service.handleGitGetDiff({ sessionName: 'test-session' });

        assert.ok(getBaseBranchStub.calledOnce, 'getBaseBranch should be called exactly once');
        const secondArg: string = getBaseBranchStub.firstCall.args[1] as string;
        assert.strictEqual(
            secondArg,
            'config-base-branch',
            `Expected getBaseBranch to be called with config value "config-base-branch" but got: ${secondArg}`
        );
    });

    // -------------------------------------------------------------------------
    // diff-basebranch-returned-in-response
    // -------------------------------------------------------------------------

    test('Given a call to handleGitGetDiff, the response object contains baseBranch equal to the resolved branch name', async () => {
        getBaseBranchStub.resolves('origin/main');
        generateDiffContentStub.resolves('some diff content');

        const result = await service.handleGitGetDiff({
            sessionName: 'test-session',
            baseBranch: 'origin/main',
        }) as { diff: string; baseBranch: string };

        assert.ok(result !== null && typeof result === 'object', 'Result should be an object');
        assert.ok('baseBranch' in result, 'Result should contain baseBranch field');
        assert.strictEqual(
            result.baseBranch,
            'origin/main',
            `Expected baseBranch to be "origin/main" but got: ${result.baseBranch}`
        );
    });

    // -------------------------------------------------------------------------
    // diff-files-basebranch-params-override
    // -------------------------------------------------------------------------

    test('Given params.baseBranch is "develop", when handleGitGetDiffFiles is called, then DiffService.getBaseBranch is called with "develop"', async () => {
        getBaseBranchStub.withArgs(sinon.match.string, 'develop').resolves('develop');

        await service.handleGitGetDiffFiles({ sessionName: 'test-session', baseBranch: 'develop' });

        assert.ok(getBaseBranchStub.calledOnce, 'getBaseBranch should be called exactly once');
        const secondArg: string = getBaseBranchStub.firstCall.args[1] as string;
        assert.strictEqual(
            secondArg,
            'develop',
            `Expected getBaseBranch to be called with "develop" but got: ${secondArg}`
        );
    });

    test('Given params.baseBranch is absent, when handleGitGetDiffFiles is called, then the config-based resolution path is used', async () => {
        getBaseBranchStub.resolves('config-base-branch');

        await service.handleGitGetDiffFiles({ sessionName: 'test-session' });

        assert.ok(getBaseBranchStub.calledOnce, 'getBaseBranch should be called exactly once');
        const secondArg: string = getBaseBranchStub.firstCall.args[1] as string;
        assert.strictEqual(
            secondArg,
            'config-base-branch',
            `Expected getBaseBranch to be called with config value "config-base-branch" but got: ${secondArg}`
        );
    });

    // -------------------------------------------------------------------------
    // diff-files-basebranch-returned-in-response
    // -------------------------------------------------------------------------

    test('Given a call to handleGitGetDiffFiles, the response object contains baseBranch equal to the resolved branch name', async () => {
        getBaseBranchStub.resolves('origin/develop');
        generateDiffFilesStub.resolves(['src/foo.ts', 'src/bar.ts']);

        const result = await service.handleGitGetDiffFiles({
            sessionName: 'test-session',
            baseBranch: 'origin/develop',
        }) as { files: string[]; baseBranch: string };

        assert.ok(result !== null && typeof result === 'object', 'Result should be an object');
        assert.ok('baseBranch' in result, 'Result should contain baseBranch field');
        assert.strictEqual(
            result.baseBranch,
            'origin/develop',
            `Expected baseBranch to be "origin/develop" but got: ${result.baseBranch}`
        );
    });
});
