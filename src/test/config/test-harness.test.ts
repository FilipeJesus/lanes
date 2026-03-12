import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');
const VSCODE_TEST_CONFIG_PATH = path.join(PROJECT_ROOT, '.vscode-test.mjs');
const PRE_COMMIT_HOOK_PATH = path.join(PROJECT_ROOT, '.husky', 'pre-commit');

interface PackageJson {
    scripts?: Record<string, string>;
}

suite('Test Harness Configuration', () => {
    let pkg: PackageJson;

    setup(() => {
        pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as PackageJson;
    });

    test('pre-commit uses the hook-safe test entrypoint', () => {
        const hook = fs.readFileSync(PRE_COMMIT_HOOK_PATH, 'utf-8');

        assert.ok(
            hook.includes('npm run test:hook'),
            'pre-commit should run the hook-safe VS Code test command'
        );
        assert.ok(
            !hook.includes('npm run test ||'),
            'pre-commit should not call npm run test directly'
        );
        assert.ok(
            hook.includes('LANES_NO_INSTALL_IN_HOOKS=1 npm run compile'),
            'pre-commit should disable opportunistic dependency installs during compile'
        );
    });

    test('package.json separates the raw vscode test runner from the hook runner', () => {
        assert.strictEqual(
            pkg.scripts?.test,
            'npm run test:vscode',
            'npm test should delegate to the raw VS Code test runner'
        );
        assert.strictEqual(
            pkg.scripts?.['test:vscode'],
            'vscode-test',
            'test:vscode should be the direct VS Code test harness'
        );
        assert.strictEqual(
            pkg.scripts?.['test:hook'],
            'node scripts/run-vscode-test.mjs',
            'test:hook should use the dedicated hook-safe wrapper'
        );
    });

    test('vscode-test config supports local-install reuse for git hooks', () => {
        const config = fs.readFileSync(VSCODE_TEST_CONFIG_PATH, 'utf-8');

        assert.ok(
            config.includes('LANES_VSCODE_TEST_USE_MACHINE'),
            '.vscode-test.mjs should allow hooks to request a machine install'
        );
        assert.ok(
            config.includes('LANES_VSCODE_TEST_EXECUTABLE'),
            '.vscode-test.mjs should allow an explicit executable override'
        );
        assert.ok(
            config.includes('useInstallation'),
            '.vscode-test.mjs should configure a reusable local installation'
        );
    });
});
