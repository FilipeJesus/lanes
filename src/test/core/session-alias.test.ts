import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    clearSessionId,
    getSessionAlias,
    getSessionFilePath,
    getSessionId,
    initializeGlobalStorageContext,
    saveSessionAlias,
} from '../../core/session/SessionDataService';

suite('Session Alias Storage', () => {
    let tempDir: string;
    let storageDir: string;
    let worktreePath: string;

    setup(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-alias-'));
        storageDir = path.join(tempDir, 'global-storage');
        worktreePath = path.join(tempDir, '.worktrees', 'original-branch');
        fs.mkdirSync(worktreePath, { recursive: true });
        await initializeGlobalStorageContext(storageDir, tempDir);
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('persists a trimmed alias while preserving session metadata and paths', async () => {
        const sessionPath = getSessionFilePath(worktreePath);
        const data = { sessionId: 'abc-123', workflow: 'feature', agentName: 'codex', terminal: 'tmux', taskListId: 'tasks-123', parentSession: 'parent-branch' };
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
        fs.writeFileSync(sessionPath, JSON.stringify(data));

        await saveSessionAlias(worktreePath, '  Fix login: review / polish 🚀  ');

        assert.deepStrictEqual(JSON.parse(fs.readFileSync(sessionPath, 'utf8')), {
            ...data, alias: 'Fix login: review / polish 🚀',
        });
        assert.strictEqual(getSessionFilePath(worktreePath), sessionPath);
        assert.ok(fs.existsSync(worktreePath));
        await initializeGlobalStorageContext(storageDir, tempDir);
        assert.strictEqual(await getSessionAlias(worktreePath), 'Fix login: review / polish 🚀');
        assert.strictEqual((await getSessionId(worktreePath))?.sessionId, data.sessionId);
    });

    test('can create and replace an alias before a session ID has been captured', async () => {
        await saveSessionAlias(worktreePath, 'First alias');
        await saveSessionAlias(worktreePath, 'Second alias');

        assert.strictEqual(await getSessionAlias(worktreePath), 'Second alias');
        assert.strictEqual(await getSessionId(worktreePath), null);
    });

    test('rejects empty names without changing the saved alias', async () => {
        await saveSessionAlias(worktreePath, 'Saved name');

        await assert.rejects(saveSessionAlias(worktreePath, ' \t '), /cannot be empty/);

        assert.strictEqual(await getSessionAlias(worktreePath), 'Saved name');
    });

    test('returns no alias for missing, malformed, or invalid alias data', async () => {
        assert.strictEqual(await getSessionAlias(worktreePath), null);
        const sessionPath = getSessionFilePath(worktreePath);
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
        for (const content of ['invalid json', 'null', '{}', '{"alias":42}', '{"alias":"  "}']) {
            fs.writeFileSync(sessionPath, content);
            assert.strictEqual(await getSessionAlias(worktreePath), null);
        }
    });

    test('preserves legacy session metadata when saving an alias to repo-local storage', async () => {
        const hash = crypto.createHash('sha256').update(path.normalize(tempDir).toLowerCase()).digest('hex').substring(0, 8);
        const repoName = path.basename(tempDir).replace(/[^a-zA-Z0-9_-]/g, '_');
        const legacyPath = path.join(storageDir, `${repoName}-${hash}`, 'original-branch', '.claude-session');
        const data = { sessionId: 'legacy-123', workflow: 'feature', permissionMode: 'acceptEdits' };
        fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
        fs.writeFileSync(legacyPath, JSON.stringify(data));

        await saveSessionAlias(worktreePath, 'Legacy session');

        assert.deepStrictEqual(JSON.parse(fs.readFileSync(getSessionFilePath(worktreePath), 'utf8')), {
            ...data, alias: 'Legacy session',
        });
    });

    test('retains the alias when clearing the agent session ID', async () => {
        const sessionPath = getSessionFilePath(worktreePath);
        fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
        fs.writeFileSync(sessionPath, JSON.stringify({ sessionId: 'abc-123' }));
        await saveSessionAlias(worktreePath, 'Keep this name');

        await clearSessionId(worktreePath);

        assert.strictEqual(await getSessionId(worktreePath), null);
        assert.strictEqual(await getSessionAlias(worktreePath), 'Keep this name');
    });
});
