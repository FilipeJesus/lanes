import * as assert from 'assert';
import sinon from 'sinon';
import * as gitService from '../../core/gitService';
import * as FileService from '../../core/services/FileService';
import * as SettingsService from '../../core/services/SettingsService';
import { resolveRepoRoot, getBranchesInWorktrees, getPackageRoot } from '../../cli/utils';

suite('CLI utils', () => {
    suite('resolveRepoRoot', () => {
        let fileExistsStub: sinon.SinonStub;
        let execGitStub: sinon.SinonStub;
        let baseRepoStub: sinon.SinonStub;
        let originalCwd: string;

        setup(() => {
            originalCwd = process.cwd();
            fileExistsStub = sinon.stub(FileService, 'fileExists');
            execGitStub = sinon.stub(gitService, 'execGit');
            baseRepoStub = sinon.stub(SettingsService, 'getBaseRepoPath');
        });

        teardown(() => {
            fileExistsStub.restore();
            execGitStub.restore();
            baseRepoStub.restore();
        });

        test('returns cwd when .git exists', async () => {
            fileExistsStub.resolves(true);
            baseRepoStub.resolves(process.cwd());

            const result = await resolveRepoRoot();
            assert.strictEqual(result, process.cwd());
            sinon.assert.notCalled(execGitStub);
        });

        test('uses rev-parse fallback when no .git in cwd', async () => {
            fileExistsStub.resolves(false);
            execGitStub.resolves('/parent/repo\n');
            baseRepoStub.resolves('/parent/repo');

            const result = await resolveRepoRoot();
            assert.strictEqual(result, '/parent/repo');
            sinon.assert.calledWithMatch(execGitStub, ['rev-parse', '--show-toplevel']);
        });

        test('throws when not in git repo', async () => {
            fileExistsStub.resolves(false);
            execGitStub.rejects(new Error('not a git repo'));

            await assert.rejects(
                () => resolveRepoRoot(),
                /Not a git repository/
            );
        });

        test('resolves worktree to base repo', async () => {
            fileExistsStub.resolves(true);
            baseRepoStub.resolves('/base/repo');

            const result = await resolveRepoRoot();
            assert.strictEqual(result, '/base/repo');
            sinon.assert.calledOnce(baseRepoStub);
        });
    });

    suite('getBranchesInWorktrees', () => {
        let execGitStub: sinon.SinonStub;

        setup(() => {
            execGitStub = sinon.stub(gitService, 'execGit');
        });

        teardown(() => {
            execGitStub.restore();
        });

        test('parses single branch', async () => {
            execGitStub.resolves(
                'worktree /repo\nHEAD abc123\nbranch refs/heads/main\n\n'
            );
            const branches = await getBranchesInWorktrees('/repo');
            assert.ok(branches.has('main'));
            assert.strictEqual(branches.size, 1);
        });

        test('parses multiple branches', async () => {
            execGitStub.resolves(
                'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n' +
                'worktree /repo/.worktrees/feat\nHEAD def\nbranch refs/heads/feature-a\n\n'
            );
            const branches = await getBranchesInWorktrees('/repo');
            assert.ok(branches.has('main'));
            assert.ok(branches.has('feature-a'));
            assert.strictEqual(branches.size, 2);
        });

        test('ignores non-branch lines', async () => {
            execGitStub.resolves(
                'worktree /repo\nHEAD abc\ndetached\n\n'
            );
            const branches = await getBranchesInWorktrees('/repo');
            assert.strictEqual(branches.size, 0);
        });

        test('returns empty set on error', async () => {
            execGitStub.rejects(new Error('git error'));
            const branches = await getBranchesInWorktrees('/repo');
            assert.strictEqual(branches.size, 0);
        });

        test('handles empty output', async () => {
            execGitStub.resolves('');
            const branches = await getBranchesInWorktrees('/repo');
            assert.strictEqual(branches.size, 0);
        });
    });

    suite('getPackageRoot', () => {
        test('returns parent of __dirname equivalent', () => {
            const root = getPackageRoot();
            assert.ok(root);
            assert.ok(typeof root === 'string');
            // Should be an absolute path
            assert.ok(root.startsWith('/') || /^[a-zA-Z]:/.test(root));
        });
    });
});
