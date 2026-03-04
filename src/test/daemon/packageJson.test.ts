/**
 * Tests for package.json — Daemon configuration.
 *
 * Verifies that package.json has the expected entries for the daemon:
 *  - bin section contains a lanes-daemon entry pointing to ./out/daemon.js
 *  - scripts section contains a bundle:daemon script
 *  - compile script includes npm run bundle:daemon
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Resolve project root: test files are compiled to out/test/daemon/,
// so project root is three levels up from __dirname.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const PACKAGE_JSON_PATH = path.join(PROJECT_ROOT, 'package.json');

interface PackageJson {
    bin?: Record<string, string>;
    scripts?: Record<string, string>;
    [key: string]: unknown;
}

suite('Package JSON Daemon Config', () => {
    let pkg: PackageJson;

    setup(() => {
        const raw = fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8');
        pkg = JSON.parse(raw) as PackageJson;
    });

    // -------------------------------------------------------------------------
    // package-json-daemon-bin
    // -------------------------------------------------------------------------

    test('Given package.json, when reading bin section, then lanes-daemon points to ./out/daemon.js', () => {
        assert.ok(
            pkg.bin !== undefined && pkg.bin !== null,
            'package.json should have a bin section'
        );
        assert.strictEqual(
            pkg.bin!['lanes-daemon'],
            './out/daemon.js',
            `Expected bin["lanes-daemon"] to be "./out/daemon.js", got: ${pkg.bin!['lanes-daemon']}`
        );
    });

    test('Given package.json, when reading scripts section, then bundle:daemon script exists', () => {
        assert.ok(
            pkg.scripts !== undefined && pkg.scripts !== null,
            'package.json should have a scripts section'
        );
        assert.ok(
            'bundle:daemon' in pkg.scripts!,
            'package.json scripts should contain a bundle:daemon entry'
        );
        assert.ok(
            typeof pkg.scripts!['bundle:daemon'] === 'string' &&
                pkg.scripts!['bundle:daemon'].length > 0,
            'bundle:daemon script should be a non-empty string'
        );
    });

    test('Given package.json, when reading compile script, then it includes npm run bundle:daemon', () => {
        assert.ok(
            pkg.scripts !== undefined && pkg.scripts !== null,
            'package.json should have a scripts section'
        );
        const compileScript = pkg.scripts!['compile'];
        assert.ok(
            typeof compileScript === 'string',
            'package.json should have a compile script'
        );
        assert.ok(
            compileScript.includes('bundle:daemon'),
            `Expected compile script to include "bundle:daemon", got: ${compileScript}`
        );
    });
});
