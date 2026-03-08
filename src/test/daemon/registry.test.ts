/**
 * Tests for daemon registry module.
 *
 * Covers:
 *  - getRegistryPath() returns path relative to os.homedir()
 *  - registerDaemon() adds an entry to the registry
 *  - registerDaemon() replaces an existing entry for the same workspaceRoot (upsert)
 *  - deregisterDaemon() removes the entry for a given workspaceRoot
 *  - deregisterDaemon() is a no-op when the entry does not exist
 *  - listRegisteredDaemons() returns all entries (empty when no file)
 *  - listRegisteredDaemons() returns all entries after multiple registrations
 *  - cleanStaleEntries() removes entries whose PID is no longer alive
 *  - cleanStaleEntries() keeps entries whose PID is alive
 *  - cleanStaleEntries() handles an empty registry without throwing
 *  - Registry file and directory are created automatically
 *  - Malformed JSON in registry returns empty array (graceful degradation)
 *
 * The HOME environment variable is overridden in each test to point to a temp
 * directory, so os.homedir() resolves to a temp path and the real ~/.lanes is
 * never touched.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import {
    getRegistryPath,
    registerDaemon,
    deregisterDaemon,
    listRegisteredDaemons,
    cleanStaleEntries,
} from '../../daemon/registry';
import type { DaemonRegistryEntry } from '../../daemon/registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid registry entry for testing. */
function makeEntry(overrides: Partial<DaemonRegistryEntry> = {}): DaemonRegistryEntry {
    return {
        workspaceRoot: '/tmp/test-workspace',
        port: 3000,
        pid: process.pid,
        token: 'abc123',
        startedAt: new Date().toISOString(),
        projectName: 'test-project',
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Suite: daemon registry
// ---------------------------------------------------------------------------

suite('daemon registry', () => {
    let tempDir: string;
    let originalHome: string | undefined;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-registry-test-'));
        // Override HOME so that os.homedir() points to our temp directory.
        // On Linux/macOS os.homedir() reads from process.env.HOME.
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });

    teardown(() => {
        sinon.restore();
        // Restore the original HOME
        if (originalHome !== undefined) {
            process.env.HOME = originalHome;
        } else {
            delete process.env.HOME;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // daemon-registry-get-path
    // -------------------------------------------------------------------------

    test('Given HOME is set to tempDir, when getRegistryPath() is called, then it returns <tempDir>/.lanes/daemons.json', () => {
        const result = getRegistryPath();

        const expected = path.join(tempDir, '.lanes', 'daemons.json');
        assert.strictEqual(result, expected, `Expected registry path to be ${expected}`);
    });

    // -------------------------------------------------------------------------
    // daemon-registry-list-empty
    // -------------------------------------------------------------------------

    test('Given no registry file exists, when listRegisteredDaemons() is called, then it returns an empty array', async () => {
        const result = await listRegisteredDaemons();

        assert.ok(Array.isArray(result), 'listRegisteredDaemons should return an array');
        assert.strictEqual(result.length, 0, 'Should return empty array when no registry file exists');
    });

    // -------------------------------------------------------------------------
    // daemon-registry-register
    // -------------------------------------------------------------------------

    test('Given no existing registry, when registerDaemon() is called, then the entry appears in listRegisteredDaemons()', async () => {
        // Arrange
        const entry = makeEntry({ workspaceRoot: '/workspace/alpha', projectName: 'alpha' });

        // Act
        await registerDaemon(entry);
        const result = await listRegisteredDaemons();

        // Assert
        assert.strictEqual(result.length, 1, 'Registry should contain exactly one entry');
        assert.strictEqual(result[0].workspaceRoot, entry.workspaceRoot);
        assert.strictEqual(result[0].projectName, entry.projectName);
        assert.strictEqual(result[0].port, entry.port);
        assert.strictEqual(result[0].pid, entry.pid);
        assert.strictEqual(result[0].token, entry.token);
    });

    test('Given no existing registry, when registerDaemon() is called, then ~/.lanes/daemons.json is created on disk', async () => {
        // Arrange
        const entry = makeEntry({ workspaceRoot: '/workspace/beta' });
        const expectedPath = path.join(tempDir, '.lanes', 'daemons.json');

        // Act
        await registerDaemon(entry);

        // Assert
        assert.ok(fs.existsSync(expectedPath), 'daemons.json should be created after registerDaemon()');
    });

    test('Given no existing registry, when registerDaemon() is called, then the ~/.lanes directory is created automatically', async () => {
        // Arrange: ensure .lanes directory does not exist yet
        const lanesDir = path.join(tempDir, '.lanes');
        assert.ok(!fs.existsSync(lanesDir), 'Precondition: .lanes dir should not exist');

        // Act
        await registerDaemon(makeEntry());

        // Assert
        assert.ok(fs.existsSync(lanesDir), '.lanes directory should be created by registerDaemon()');
    });

    test('Given two different workspaceRoots, when both are registered, then listRegisteredDaemons() returns two entries', async () => {
        // Arrange
        const entry1 = makeEntry({ workspaceRoot: '/workspace/project-one', port: 3001 });
        const entry2 = makeEntry({ workspaceRoot: '/workspace/project-two', port: 3002 });

        // Act
        await registerDaemon(entry1);
        await registerDaemon(entry2);
        const result = await listRegisteredDaemons();

        // Assert
        assert.strictEqual(result.length, 2, 'Registry should contain two entries');
        const roots = result.map((e) => e.workspaceRoot);
        assert.ok(roots.includes(entry1.workspaceRoot), 'Entry 1 should be present');
        assert.ok(roots.includes(entry2.workspaceRoot), 'Entry 2 should be present');
    });

    // -------------------------------------------------------------------------
    // daemon-registry-upsert (concurrent daemon handling)
    // -------------------------------------------------------------------------

    test('Given an existing entry for a workspaceRoot, when registerDaemon() is called again with the same root, then it is replaced (upsert)', async () => {
        // Arrange: register an initial entry
        const initial = makeEntry({ workspaceRoot: '/workspace/upsert', port: 3000, pid: 1001 });
        await registerDaemon(initial);

        // Act: re-register with updated port and pid
        const updated = makeEntry({ workspaceRoot: '/workspace/upsert', port: 4000, pid: 2002 });
        await registerDaemon(updated);
        const result = await listRegisteredDaemons();

        // Assert: only one entry should exist with the updated values
        assert.strictEqual(result.length, 1, 'Upsert should not create a duplicate; only one entry should remain');
        assert.strictEqual(result[0].port, 4000, 'Port should be updated to 4000');
        assert.strictEqual(result[0].pid, 2002, 'PID should be updated to 2002');
    });

    test('Given an existing entry for workspaceRoot A, when a different workspaceRoot B is registered, then A is not replaced', async () => {
        // Arrange
        const entryA = makeEntry({ workspaceRoot: '/workspace/a', port: 3001 });
        const entryB = makeEntry({ workspaceRoot: '/workspace/b', port: 3002 });
        await registerDaemon(entryA);

        // Act
        await registerDaemon(entryB);
        const result = await listRegisteredDaemons();

        // Assert
        assert.strictEqual(result.length, 2, 'Both entries should be present');
        const portA = result.find((e) => e.workspaceRoot === '/workspace/a')?.port;
        assert.strictEqual(portA, 3001, 'Entry A port should remain unchanged');
    });

    // -------------------------------------------------------------------------
    // daemon-registry-deregister
    // -------------------------------------------------------------------------

    test('Given a registered entry, when deregisterDaemon() is called with that workspaceRoot, then listRegisteredDaemons() returns an empty array', async () => {
        // Arrange
        const entry = makeEntry({ workspaceRoot: '/workspace/to-remove' });
        await registerDaemon(entry);

        // Act
        await deregisterDaemon('/workspace/to-remove');
        const result = await listRegisteredDaemons();

        // Assert
        assert.strictEqual(result.length, 0, 'Registry should be empty after deregistration');
    });

    test('Given two registered entries, when deregisterDaemon() is called for one, then the other remains', async () => {
        // Arrange
        const entryA = makeEntry({ workspaceRoot: '/workspace/keep', port: 3001 });
        const entryB = makeEntry({ workspaceRoot: '/workspace/remove', port: 3002 });
        await registerDaemon(entryA);
        await registerDaemon(entryB);

        // Act
        await deregisterDaemon('/workspace/remove');
        const result = await listRegisteredDaemons();

        // Assert
        assert.strictEqual(result.length, 1, 'One entry should remain');
        assert.strictEqual(result[0].workspaceRoot, '/workspace/keep', 'Remaining entry should be the one that was kept');
    });

    test('Given an empty registry, when deregisterDaemon() is called, then it does not throw', async () => {
        // Act & Assert: should not throw even though no entry exists
        await deregisterDaemon('/workspace/nonexistent');
    });

    test('Given no registry file, when deregisterDaemon() is called, then it does not throw', async () => {
        // The registry file does not exist at all — no .lanes directory
        await deregisterDaemon('/workspace/ghost');
    });

    // -------------------------------------------------------------------------
    // daemon-registry-clean-stale
    // -------------------------------------------------------------------------

    test('Given an entry with the current process PID, when cleanStaleEntries() is called, then the entry is kept', async () => {
        // Arrange: use the current process PID — guaranteed to be alive
        const entry = makeEntry({ workspaceRoot: '/workspace/alive', pid: process.pid });
        await registerDaemon(entry);

        // Act
        const live = await cleanStaleEntries();

        // Assert
        assert.strictEqual(live.length, 1, 'Live entry should be kept');
        assert.strictEqual(live[0].workspaceRoot, '/workspace/alive');
    });

    test('Given an entry with a dead PID, when cleanStaleEntries() is called, then the entry is removed', async () => {
        // Arrange: stub process.kill to throw ESRCH for all PIDs (simulating a dead process)
        const fakePid = 999999999;
        const killStub = sinon.stub(process, 'kill').throws(
            Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' })
        );

        const entry = makeEntry({ workspaceRoot: '/workspace/dead', pid: fakePid });
        await registerDaemon(entry);

        // Act
        const live = await cleanStaleEntries();

        // Assert
        killStub.restore();
        assert.strictEqual(live.length, 0, 'Stale entry should be removed');
    });

    test('Given one live entry and one stale entry, when cleanStaleEntries() is called, then only the live entry is returned', async () => {
        // Arrange: register both entries before stubbing process.kill
        const liveEntry = makeEntry({ workspaceRoot: '/workspace/live', pid: process.pid, port: 3001 });
        const fakePid = 888888888;
        const staleEntry = makeEntry({ workspaceRoot: '/workspace/stale', pid: fakePid, port: 3002 });

        await registerDaemon(liveEntry);
        await registerDaemon(staleEntry);

        // Stub process.kill: throw ESRCH only for the fake PID, pass for the real PID
        const killStub = sinon.stub(process, 'kill').callsFake((pid: number | NodeJS.Signals, _signal?: string | number) => {
            if (pid === fakePid) {
                throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
            }
            // Let process.pid through — it is alive (no throw means alive)
            return true;
        });

        // Act
        const live = await cleanStaleEntries();

        // Assert
        killStub.restore();
        assert.strictEqual(live.length, 1, 'Only the live entry should remain');
        assert.strictEqual(live[0].workspaceRoot, '/workspace/live', 'Remaining entry should be the live one');
    });

    test('Given an empty registry, when cleanStaleEntries() is called, then it returns an empty array without throwing', async () => {
        // Act
        const result = await cleanStaleEntries();

        // Assert
        assert.ok(Array.isArray(result), 'cleanStaleEntries should return an array');
        assert.strictEqual(result.length, 0, 'Empty registry should yield empty result');
    });

    test('Given all entries are alive, when cleanStaleEntries() is called, then the registry file is not rewritten', async () => {
        // Arrange: register a live entry
        const entry = makeEntry({ workspaceRoot: '/workspace/all-live', pid: process.pid });
        await registerDaemon(entry);

        const registryPath = getRegistryPath();
        const statBefore = fs.statSync(registryPath);

        // Small delay to ensure mtime would differ if written
        await new Promise<void>((resolve) => setTimeout(resolve, 10));

        // Act
        await cleanStaleEntries();

        // Assert: mtime should be unchanged since no rewrite was needed
        const statAfter = fs.statSync(registryPath);
        assert.strictEqual(
            statBefore.mtimeMs,
            statAfter.mtimeMs,
            'Registry file should not be rewritten when no stale entries exist'
        );
    });

    // -------------------------------------------------------------------------
    // daemon-registry-malformed-json
    // -------------------------------------------------------------------------

    test('Given a registry file with malformed JSON, when listRegisteredDaemons() is called, then it returns an empty array (graceful degradation)', async () => {
        // Arrange: write malformed JSON to the registry file
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        const registryPath = path.join(lanesDir, 'daemons.json');
        fs.writeFileSync(registryPath, '{ this is not valid json', 'utf-8');

        // Act
        const result = await listRegisteredDaemons();

        // Assert
        assert.ok(Array.isArray(result), 'Should return an array even for malformed JSON');
        assert.strictEqual(result.length, 0, 'Malformed registry should be treated as empty');
    });

    test('Given a registry file containing a non-array JSON value, when listRegisteredDaemons() is called, then it returns an empty array', async () => {
        // Arrange: write a JSON object (not an array) to the registry file
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        const registryPath = path.join(lanesDir, 'daemons.json');
        fs.writeFileSync(registryPath, JSON.stringify({ entry: 'not-an-array' }), 'utf-8');

        // Act
        const result = await listRegisteredDaemons();

        // Assert
        assert.strictEqual(result.length, 0, 'Non-array registry content should be treated as empty');
    });

    // -------------------------------------------------------------------------
    // daemon-registry-write-atomically
    // -------------------------------------------------------------------------

    test('Given a registered entry, when the registry file is read directly, then it contains valid JSON', async () => {
        // Arrange
        const entry = makeEntry({ workspaceRoot: '/workspace/json-check' });

        // Act
        await registerDaemon(entry);

        // Assert: the file should be parseable JSON
        const registryPath = path.join(tempDir, '.lanes', 'daemons.json');
        const raw = fs.readFileSync(registryPath, 'utf-8');
        let parsed: unknown;
        assert.doesNotThrow(() => {
            parsed = JSON.parse(raw);
        }, 'Registry file should contain valid JSON after registration');
        assert.ok(Array.isArray(parsed), 'Registry file content should be a JSON array');
    });

    test('Given an entry was deregistered, when the registry file is read directly, then the entry is absent from the JSON', async () => {
        // Arrange
        const entry = makeEntry({ workspaceRoot: '/workspace/gone' });
        await registerDaemon(entry);

        // Act
        await deregisterDaemon('/workspace/gone');

        // Assert
        const registryPath = path.join(tempDir, '.lanes', 'daemons.json');
        const raw = fs.readFileSync(registryPath, 'utf-8');
        const parsed = JSON.parse(raw) as DaemonRegistryEntry[];
        const found = parsed.find((e) => e.workspaceRoot === '/workspace/gone');
        assert.strictEqual(found, undefined, 'Deregistered entry should not be present in the JSON file');
    });
});
