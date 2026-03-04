/**
 * Tests for scripts/bundle-daemon.mjs — Daemon Bundle Script.
 *
 * Verifies that the bundle script exists and contains the expected configuration:
 *  - The file exists at scripts/bundle-daemon.mjs
 *  - Entry point is src/daemon/server.ts
 *  - Output is out/daemon.js
 *  - CLI_VERSION define is present
 *  - No shebang banner (it is a module script invoked via node, not a CLI tool)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Resolve project root: test files are compiled to out/test/daemon/,
// so project root is three levels up from __dirname.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const BUNDLE_SCRIPT_PATH = path.join(PROJECT_ROOT, 'scripts', 'bundle-daemon.mjs');

suite('Daemon Bundle Script', () => {
    let scriptContent: string;

    setup(() => {
        // Read the file once for all tests in this suite.
        scriptContent = fs.readFileSync(BUNDLE_SCRIPT_PATH, 'utf-8');
    });

    // -------------------------------------------------------------------------
    // daemon-bundle-script-exists
    // -------------------------------------------------------------------------

    test('Given the project root, when checking scripts/bundle-daemon.mjs, then it exists', () => {
        assert.ok(
            fs.existsSync(BUNDLE_SCRIPT_PATH),
            `Expected scripts/bundle-daemon.mjs to exist at: ${BUNDLE_SCRIPT_PATH}`
        );
    });

    test('Given bundle-daemon.mjs, when reading its content, then it has no shebang banner', () => {
        assert.ok(
            !scriptContent.startsWith('#!/'),
            'bundle-daemon.mjs should not start with a shebang (#!) — it is a module, not a CLI tool'
        );
    });

    test('Given bundle-daemon.mjs, when reading its content, then entry point is src/daemon/server.ts', () => {
        assert.ok(
            scriptContent.includes('src/daemon/server.ts'),
            'bundle-daemon.mjs should reference src/daemon/server.ts as the entry point'
        );
    });

    test('Given bundle-daemon.mjs, when reading its content, then output is out/daemon.js', () => {
        assert.ok(
            scriptContent.includes('out/daemon.js'),
            'bundle-daemon.mjs should reference out/daemon.js as the output file'
        );
    });

    test('Given bundle-daemon.mjs, when reading its content, then CLI_VERSION is defined', () => {
        assert.ok(
            scriptContent.includes('CLI_VERSION'),
            'bundle-daemon.mjs should define CLI_VERSION in the esbuild define option'
        );
    });
});
