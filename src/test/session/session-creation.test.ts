import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import { getAgent } from '../../core/codeAgents';
import * as gitService from '../../core/gitService';
import * as brokenWorktreeService from '../../core/services/BrokenWorktreeService';
import { createSessionWorktree, SessionCreationOptions } from '../../core/services/SessionCreationService';
import {
    initializeGlobalStorageContext,
    getSessionFilePath,
    getSessionParent,
    clearSessionId,
    saveSessionWorkflow,
} from '../../core/session/SessionDataService';

suite('Session creation parent tracking', () => {
    let repoRoot: string;
    let options: SessionCreationOptions;
    const sandbox = sinon.createSandbox();

    setup(async () => {
        repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-session-creation-'));
        await initializeGlobalStorageContext(path.join(repoRoot, '.storage'), repoRoot);
        sandbox.stub(gitService, 'execGit').resolves('');
        sandbox.stub(brokenWorktreeService, 'branchExists').resolves(false);
        options = {
            repoRoot,
            sessionName: 'child',
            parentSession: 'parent',
            worktreesFolder: '.worktrees',
            codeAgent: getAgent('claude')!,
            localSettingsPropagation: 'disabled',
        };
    });

    teardown(() => {
        sandbox.restore();
        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    test('seeds the parent before the agent starts and preserves it across workflow updates and clears', async () => {
        const { worktreePath } = await createSessionWorktree(options);
        const sessionPath = getSessionFilePath(worktreePath);
        const seed = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        assert.strictEqual(seed.parentSession, 'parent');
        assert.strictEqual(seed.agentName, 'claude');
        assert.strictEqual(seed.sessionId, undefined);
        assert.strictEqual(await getSessionParent(worktreePath), 'parent');

        fs.writeFileSync(sessionPath, JSON.stringify({ ...seed, sessionId: 'agent-session-id' }));
        await saveSessionWorkflow(worktreePath, 'feature');
        await clearSessionId(worktreePath);

        const cleared = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        assert.strictEqual(cleared.parentSession, 'parent');
        assert.strictEqual(cleared.workflow, 'feature');
        assert.strictEqual(cleared.sessionId, undefined);
    });

    test('creates root sessions without parent metadata', async () => {
        const { worktreePath } = await createSessionWorktree({ ...options, parentSession: undefined });
        const data = JSON.parse(fs.readFileSync(getSessionFilePath(worktreePath), 'utf-8'));
        assert.ok(!('parentSession' in data));
        assert.strictEqual(await getSessionParent(worktreePath), null);
    });

    test('records the parent even when no code agent is configured', async () => {
        const { worktreePath } = await createSessionWorktree({ ...options, codeAgent: undefined });
        assert.strictEqual(await getSessionParent(worktreePath), 'parent');
    });

    test('does not record the new session as its own parent', async () => {
        const { worktreePath } = await createSessionWorktree({ ...options, parentSession: 'child' });
        assert.strictEqual(await getSessionParent(worktreePath), null);
    });
});
