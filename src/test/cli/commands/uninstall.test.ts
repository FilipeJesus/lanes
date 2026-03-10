import * as assert from 'assert';
import { Command } from 'commander';
import {
    listInstalledGlobalLanesVersions,
    registerUninstallCommand,
    uninstallAllGlobalLanesVersions,
    type CommandRunner,
} from '../../../cli/commands/uninstall';

suite('UninstallCommand', () => {
    test('listInstalledGlobalLanesVersions returns empty when npm ls reports no package', async () => {
        const runCommand: CommandRunner = async () => {
            const err = new Error('missing') as Error & { stdout?: string };
            err.stdout = JSON.stringify({ dependencies: {} });
            throw err;
        };

        const versions = await listInstalledGlobalLanesVersions(runCommand);
        assert.deepStrictEqual(versions, []);
    });

    test('uninstallAllGlobalLanesVersions removes detected installation', async () => {
        const seenCommands: string[] = [];
        let listCallCount = 0;

        const runCommand: CommandRunner = async (_command, args) => {
            seenCommands.push(args.join(' '));

            if (args[0] === 'ls') {
                listCallCount += 1;
                if (listCallCount === 1) {
                    return {
                        stdout: JSON.stringify({
                            dependencies: {
                                lanes: { version: '1.3.3' },
                            },
                        }),
                        stderr: '',
                    };
                }

                return {
                    stdout: JSON.stringify({ dependencies: {} }),
                    stderr: '',
                };
            }

            return { stdout: '', stderr: '' };
        };

        const result = await uninstallAllGlobalLanesVersions(runCommand);

        assert.deepStrictEqual(result.removedVersions, [{ name: 'lanes', version: '1.3.3' }]);
        assert.deepStrictEqual(result.remainingVersions, []);
        assert.ok(seenCommands.includes('unlink -g lanes'));
        assert.ok(seenCommands.includes('uninstall -g lanes'));
    });

    test('uninstallAllGlobalLanesVersions reports remaining versions when removal makes no progress', async () => {
        const runCommand: CommandRunner = async (_command, args) => {
            if (args[0] === 'ls') {
                return {
                    stdout: JSON.stringify({
                        dependencies: {
                            lanes: { version: '1.3.3' },
                        },
                    }),
                    stderr: '',
                };
            }

            return { stdout: '', stderr: '' };
        };

        const result = await uninstallAllGlobalLanesVersions(runCommand);

        assert.deepStrictEqual(result.removedVersions, [{ name: 'lanes', version: '1.3.3' }]);
        assert.deepStrictEqual(result.remainingVersions, [{ name: 'lanes', version: '1.3.3' }]);
    });

    test('registerUninstallCommand adds uninstall to the root program', () => {
        const program = new Command();

        registerUninstallCommand(program);

        const uninstallCommand = program.commands.find((command) => command.name() === 'uninstall');
        assert.ok(uninstallCommand);
        assert.strictEqual(
            uninstallCommand?.description(),
            'Uninstall all globally installed Lanes CLI versions'
        );
    });
});
