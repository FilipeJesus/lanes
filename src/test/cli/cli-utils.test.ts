import * as assert from 'assert';
import sinon from 'sinon';
import { CliGitPathResolver } from '../../cli/adapters/CliGitPathResolver';
import * as gitService from '../../core/gitService';
import * as FileService from '../../core/services/FileService';
import * as PreflightService from '../../core/services/PreflightService';
import * as SettingsService from '../../core/services/SettingsService';
import * as registry from '../../daemon/registry';
import * as daemonClientModule from '../../daemon/client';
import {
    resolveRepoRoot,
    getBranchesInWorktrees,
    getPackageRoot,
    initCliGit,
} from '../../cli/utils';
import { createCliDaemonClient, withCliDaemonTarget } from '../../cli/targeting';

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

    suite('initCliGit', () => {
        let resolveGitPathStub: sinon.SinonStub;
        let isCommandAvailableStub: sinon.SinonStub;
        let originalGitPath: string;

        setup(() => {
            originalGitPath = gitService.getGitPath();
            resolveGitPathStub = sinon.stub(CliGitPathResolver.prototype, 'resolveGitPath').resolves('/usr/bin/git');
            isCommandAvailableStub = sinon.stub(PreflightService.preflightDeps, 'isCommandAvailable').resolves(true);
        });

        teardown(() => {
            resolveGitPathStub.restore();
            isCommandAvailableStub.restore();
            gitService.initializeGitPath(originalGitPath);
        });

        test('checks jq before resolving git path', async () => {
            await initCliGit();

            sinon.assert.calledWith(isCommandAvailableStub, 'jq');
            sinon.assert.calledOnce(resolveGitPathStub);
            assert.strictEqual(gitService.getGitPath(), '/usr/bin/git');
        });

        test('throws when jq is missing', async () => {
            isCommandAvailableStub.resolves(false);

            await assert.rejects(
                () => initCliGit(),
                /jq is required for Lanes/
            );

            sinon.assert.notCalled(resolveGitPathStub);
        });
    });

    suite('createCliDaemonClient', () => {
        let fromWorkspaceStub: sinon.SinonStub;
        let listRegisteredRemoteDaemonsStub: sinon.SinonStub;
        let execGitStub: sinon.SinonStub;
        let listProjectsStub: sinon.SinonStub;
        let discoveryStub: sinon.SinonStub;

        setup(() => {
            fromWorkspaceStub = sinon.stub(daemonClientModule.DaemonClient, 'fromWorkspace');
            listRegisteredRemoteDaemonsStub = sinon.stub(registry, 'listRegisteredRemoteDaemons');
            execGitStub = sinon.stub(gitService, 'execGit');
            listProjectsStub = sinon.stub(daemonClientModule.DaemonClient.prototype, 'listProjects');
            discoveryStub = sinon.stub(daemonClientModule.DaemonClient.prototype, 'discovery');
        });

        teardown(() => {
            fromWorkspaceStub.restore();
            listRegisteredRemoteDaemonsStub.restore();
            execGitStub.restore();
            listProjectsStub.restore();
            discoveryStub.restore();
        });

        test('uses the local daemon client when --host is omitted', async () => {
            const localClient = {} as daemonClientModule.DaemonClient;
            fromWorkspaceStub.resolves(localClient);

            const result = await createCliDaemonClient('/repo');

            assert.strictEqual(result, localClient);
            sinon.assert.calledOnceWithExactly(fromWorkspaceStub, '/repo');
            sinon.assert.notCalled(listRegisteredRemoteDaemonsStub);
        });

        test('passes verbose tracing into the local daemon client when enabled', async () => {
            const localClient = {} as daemonClientModule.DaemonClient;
            const traceMessages: string[] = [];
            fromWorkspaceStub.resolves(localClient);

            const result = await createCliDaemonClient('/repo', {
                verbose: true,
                trace: (message) => traceMessages.push(message),
            });

            assert.strictEqual(result, localClient);
            sinon.assert.calledOnce(fromWorkspaceStub);
            const traceOptions = fromWorkspaceStub.firstCall.args[1];
            assert.strictEqual(traceOptions.verbose, true);
            assert.strictEqual(typeof traceOptions.trace, 'function');
            traceOptions.trace('local trace message');
            assert.deepStrictEqual(traceMessages, ['Using local daemon target for /repo', 'local trace message']);
        });

        test('resolves the matching remote daemon project when --host is provided', async () => {
            const registration = {
                registrationId: 'remote-1',
                baseUrl: 'https://remote.example.test',
                token: 'secret',
                registeredAt: '2026-03-16T00:00:00.000Z',
            };
            listRegisteredRemoteDaemonsStub.resolves([registration]);
            execGitStub.resolves('git@github.com:org/repo.git\n');
            listProjectsStub.resolves({
                projects: [
                    {
                        projectId: 'project-123',
                        workspaceRoot: '/srv/repo',
                        projectName: 'repo',
                        registeredAt: '2026-03-16T00:00:00.000Z',
                    },
                ],
            });
            discoveryStub.resolves({
                projectId: 'project-123',
                projectName: 'repo',
                gitRemote: 'git@github.com:org/repo.git',
                sessionCount: 0,
                uptime: 0,
                workspaceRoot: '/srv/repo',
                port: 9100,
                apiVersion: '1',
            });

            const result = await createCliDaemonClient('/repo', { host: 'https://remote.example.test/' });

            assert.ok(result instanceof daemonClientModule.DaemonClient);
            sinon.assert.calledOnce(listRegisteredRemoteDaemonsStub);
            sinon.assert.calledWith(execGitStub, ['remote', 'get-url', 'origin'], '/repo');
            sinon.assert.calledOnce(listProjectsStub);
            sinon.assert.calledOnce(discoveryStub);
        });

        test('matches equivalent git remotes across ssh and https forms', async () => {
            const registration = {
                registrationId: 'remote-1',
                baseUrl: 'https://remote.example.test',
                token: 'secret',
                registeredAt: '2026-03-16T00:00:00.000Z',
            };
            listRegisteredRemoteDaemonsStub.resolves([registration]);
            execGitStub.resolves('git@github.com:org/repo.git\n');
            listProjectsStub.resolves({
                projects: [
                    {
                        projectId: 'project-123',
                        workspaceRoot: '/srv/repo',
                        projectName: 'repo',
                        registeredAt: '2026-03-16T00:00:00.000Z',
                    },
                ],
            });
            discoveryStub.resolves({
                projectId: 'project-123',
                projectName: 'repo',
                gitRemote: 'https://github.com/org/repo.git',
                sessionCount: 0,
                uptime: 0,
                workspaceRoot: '/srv/repo',
                port: 9100,
                apiVersion: '1',
            });

            const result = await createCliDaemonClient('/repo', { host: 'https://remote.example.test' });

            assert.ok(result instanceof daemonClientModule.DaemonClient);
        });

        test('reports discovery failures when every remote project lookup fails', async () => {
            const registration = {
                registrationId: 'remote-1',
                baseUrl: 'https://remote.example.test',
                token: 'secret',
                registeredAt: '2026-03-16T00:00:00.000Z',
            };
            listRegisteredRemoteDaemonsStub.resolves([registration]);
            execGitStub.resolves('git@github.com:org/repo.git\n');
            listProjectsStub.resolves({
                projects: [
                    {
                        projectId: 'project-123',
                        workspaceRoot: '/srv/repo',
                        projectName: 'repo',
                        registeredAt: '2026-03-16T00:00:00.000Z',
                    },
                ],
            });
            discoveryStub.rejects(new Error('Unauthorized'));

            await assert.rejects(
                () => createCliDaemonClient('/repo', { host: 'https://remote.example.test' }),
                /Failed to inspect projects on remote daemon .*Unauthorized/
            );
        });
    });

    suite('withCliDaemonTarget', () => {
        let fromWorkspaceStub: sinon.SinonStub;
        let listRegisteredRemoteDaemonsStub: sinon.SinonStub;
        let execGitStub: sinon.SinonStub;
        let listProjectsStub: sinon.SinonStub;
        let discoveryStub: sinon.SinonStub;

        setup(() => {
            fromWorkspaceStub = sinon.stub(daemonClientModule.DaemonClient, 'fromWorkspace');
            listRegisteredRemoteDaemonsStub = sinon.stub(registry, 'listRegisteredRemoteDaemons');
            execGitStub = sinon.stub(gitService, 'execGit');
            listProjectsStub = sinon.stub(daemonClientModule.DaemonClient.prototype, 'listProjects');
            discoveryStub = sinon.stub(daemonClientModule.DaemonClient.prototype, 'discovery');
        });

        teardown(() => {
            fromWorkspaceStub.restore();
            listRegisteredRemoteDaemonsStub.restore();
            execGitStub.restore();
            listProjectsStub.restore();
            discoveryStub.restore();
        });

        test('uses the local handler when --host is omitted', async () => {
            const localClient = {} as daemonClientModule.DaemonClient;
            fromWorkspaceStub.resolves(localClient);

            const result = await withCliDaemonTarget('/repo', {}, {
                local: async (target) => {
                    assert.strictEqual(target.client, localClient);
                    return 'local';
                },
                daemon: async () => 'remote',
            });

            assert.strictEqual(result, 'local');
            sinon.assert.calledOnceWithExactly(fromWorkspaceStub, '/repo');
        });

        test('uses the daemon handler when --host is provided', async () => {
            const registration = {
                registrationId: 'remote-1',
                baseUrl: 'https://remote.example.test',
                token: 'secret',
                registeredAt: '2026-03-16T00:00:00.000Z',
            };
            listRegisteredRemoteDaemonsStub.resolves([registration]);
            execGitStub.resolves('git@github.com:org/repo.git\n');
            listProjectsStub.resolves({
                projects: [
                    {
                        projectId: 'project-123',
                        workspaceRoot: '/srv/repo',
                        projectName: 'repo',
                        registeredAt: '2026-03-16T00:00:00.000Z',
                    },
                ],
            });
            discoveryStub.resolves({
                projectId: 'project-123',
                projectName: 'repo',
                gitRemote: 'git@github.com:org/repo.git',
                sessionCount: 0,
                uptime: 0,
                workspaceRoot: '/srv/repo',
                port: 9100,
                apiVersion: '1',
            });

            const result = await withCliDaemonTarget('/repo', { host: 'https://remote.example.test/' }, {
                local: async () => 'local',
                daemon: async (target) => {
                    assert.strictEqual(target.host, 'https://remote.example.test');
                    assert.ok(target.client instanceof daemonClientModule.DaemonClient);
                    return 'remote';
                },
            });

            assert.strictEqual(result, 'remote');
            sinon.assert.calledOnce(listRegisteredRemoteDaemonsStub);
            sinon.assert.calledOnce(listProjectsStub);
            sinon.assert.calledOnce(discoveryStub);
        });

        test('emits verbose internal comments while resolving a remote target', async () => {
            const registration = {
                registrationId: 'remote-1',
                baseUrl: 'https://remote.example.test',
                token: 'secret',
                registeredAt: '2026-03-16T00:00:00.000Z',
            };
            const traceMessages: string[] = [];
            listRegisteredRemoteDaemonsStub.resolves([registration]);
            execGitStub.resolves('git@github.com:org/repo.git\n');
            listProjectsStub.resolves({
                projects: [
                    {
                        projectId: 'project-123',
                        workspaceRoot: '/srv/repo',
                        projectName: 'repo',
                        registeredAt: '2026-03-16T00:00:00.000Z',
                    },
                ],
            });
            discoveryStub.resolves({
                projectId: 'project-123',
                projectName: 'repo',
                gitRemote: 'git@github.com:org/repo.git',
                sessionCount: 0,
                uptime: 0,
                workspaceRoot: '/srv/repo',
                port: 9100,
                apiVersion: '1',
            });

            const result = await withCliDaemonTarget(
                '/repo',
                {
                    host: 'https://remote.example.test/',
                    verbose: true,
                    trace: (message) => traceMessages.push(message),
                },
                {
                    local: async () => 'local',
                    daemon: async () => 'remote',
                }
            );

            assert.strictEqual(result, 'remote');
            assert.ok(
                traceMessages.some((message) => message.includes('Resolving remote daemon project'))
            );
        });

        test('redacts scp-style credentials from verbose remote resolution traces', async () => {
            const registration = {
                registrationId: 'remote-1',
                baseUrl: 'https://remote.example.test',
                token: 'secret',
                registeredAt: '2026-03-16T00:00:00.000Z',
            };
            const traceMessages: string[] = [];
            listRegisteredRemoteDaemonsStub.resolves([registration]);
            execGitStub.resolves('token@github.com:org/repo.git\n');
            listProjectsStub.resolves({
                projects: [
                    {
                        projectId: 'project-123',
                        workspaceRoot: '/srv/repo',
                        projectName: 'repo',
                        registeredAt: '2026-03-16T00:00:00.000Z',
                    },
                ],
            });
            discoveryStub.resolves({
                projectId: 'project-123',
                projectName: 'repo',
                gitRemote: 'git@github.com:org/repo.git',
                sessionCount: 0,
                uptime: 0,
                workspaceRoot: '/srv/repo',
                port: 9100,
                apiVersion: '1',
            });

            const result = await withCliDaemonTarget(
                '/repo',
                {
                    host: 'https://remote.example.test/',
                    verbose: true,
                    trace: (message) => traceMessages.push(message),
                },
                {
                    local: async () => 'local',
                    daemon: async () => 'remote',
                }
            );

            assert.strictEqual(result, 'remote');
            assert.ok(traceMessages.some((message) => message.includes('github.com:org/repo.git')));
            assert.ok(traceMessages.every((message) => !message.includes('token@github.com')));
        });
    });
});
