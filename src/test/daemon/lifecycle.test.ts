/**
 * Tests for daemon lifecycle module.
 *
 * Covers:
 *  - startDaemon() writes .lanes/daemon.pid and .lanes/daemon.port files
 *  - stopDaemon() removes the PID/port files
 *  - isDaemonRunning() returns false when no PID file exists
 *  - getDaemonPort() / getDaemonPid() return values from files or undefined
 *
 * NOTE: child_process.spawn is non-configurable in Node.js and cannot be
 * stubbed via Sinon directly.  For the startDaemon tests we launch a real
 * short-lived process (node --version) so the child gets a real PID.
 * For stopDaemon we simulate existing daemon files by writing them by hand.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import {
    startDaemon,
    stopDaemon,
    isDaemonRunning,
    getDaemonPort,
    getDaemonPid,
} from '../../daemon/lifecycle';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write fake global daemon PID/port files to simulate a running daemon. */
function writeFakeDaemonFiles(homeDir: string, pid: number, port: number): void {
    const lanesDir = path.join(homeDir, '.lanes');
    fs.mkdirSync(lanesDir, { recursive: true });
    fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(pid), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.port'), String(port), 'utf-8');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

suite('daemon lifecycle', () => {
    let tempDir: string;
    let originalHome: string | undefined;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-daemon-lifecycle-test-'));
        originalHome = process.env.HOME;
        process.env.HOME = tempDir;
    });

    teardown(() => {
        sinon.restore();
        if (originalHome !== undefined) {
            process.env.HOME = originalHome;
        } else {
            delete process.env.HOME;
        }
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // daemon-lifecycle-pid-port-files
    // -------------------------------------------------------------------------

    test('Given a call to startDaemon(), when the daemon starts, then .lanes/daemon.pid is created', async () => {
        // Use "node --version" as a server that immediately exits — we just
        // need spawn to succeed and return a PID.
        const serverPath = process.execPath; // node binary itself
        await startDaemon({
            workspaceRoot: tempDir,
            port: 4242,
            // Pass "--version" as the "server" — it exits immediately which is fine
            serverPath,
        });

        const pidPath = path.join(tempDir, '.lanes', 'daemon.pid');
        assert.ok(fs.existsSync(pidPath), '.lanes/daemon.pid should be created by startDaemon()');
        const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
        assert.ok(!isNaN(pid) && pid > 0, 'PID file should contain a positive integer');
    });

    test('Given a call to startDaemon(), when the daemon starts, then .lanes/daemon.port is created', async () => {
        const serverPath = process.execPath;
        await startDaemon({
            workspaceRoot: tempDir,
            port: 4242,
            serverPath,
        });

        const portPath = path.join(tempDir, '.lanes', 'daemon.port');
        assert.ok(fs.existsSync(portPath), '.lanes/daemon.port should be created by startDaemon()');
        const port = parseInt(fs.readFileSync(portPath, 'utf-8').trim(), 10);
        assert.strictEqual(port, 4242, 'Port file should contain the port passed to startDaemon()');
    });

    test('Given running daemon files, when stopDaemon() is called, then the PID file is removed', async () => {
        // Arrange: write fake daemon files (pretend the daemon is the current process)
        writeFakeDaemonFiles(tempDir, process.pid, 4242);
        const pidPath = path.join(tempDir, '.lanes', 'daemon.pid');
        assert.ok(fs.existsSync(pidPath), 'Precondition: PID file should exist');

        // Stub process.kill so we don't actually kill ourselves
        const killStub = sinon.stub(process, 'kill');

        // Act
        await stopDaemon(tempDir);

        // Assert
        killStub.restore();
        assert.ok(!fs.existsSync(pidPath), 'PID file should be removed after stopDaemon()');
    });

    test('Given running daemon files, when stopDaemon() is called, then the port file is removed', async () => {
        // Arrange
        writeFakeDaemonFiles(tempDir, process.pid, 4242);
        const portPath = path.join(tempDir, '.lanes', 'daemon.port');
        assert.ok(fs.existsSync(portPath), 'Precondition: port file should exist');

        const killStub = sinon.stub(process, 'kill');

        // Act
        await stopDaemon(tempDir);

        // Assert
        killStub.restore();
        assert.ok(!fs.existsSync(portPath), 'Port file should be removed after stopDaemon()');
    });

    test('Given running daemon files, when stopDaemon() is called, then process.kill is invoked with SIGTERM', async () => {
        // Arrange
        const fakePid = 12345;
        writeFakeDaemonFiles(tempDir, fakePid, 4242);

        const killStub = sinon.stub(process, 'kill');

        // Act
        await stopDaemon(tempDir);

        // Assert
        killStub.restore();
        assert.ok(killStub.calledOnce, 'process.kill should be called once');
        assert.strictEqual(killStub.firstCall.args[0], fakePid, 'process.kill should be called with the PID from the file');
        assert.strictEqual(killStub.firstCall.args[1], 'SIGTERM', 'process.kill should be called with SIGTERM');
    });

    test('Given no daemon files, when stopDaemon() is called, then it does not throw', async () => {
        // Act & Assert: should be a no-op when no PID file exists
        await stopDaemon(tempDir);
    });

    // -------------------------------------------------------------------------
    // daemon-lifecycle-is-running
    // -------------------------------------------------------------------------

    test('Given no .lanes/daemon.pid file, when isDaemonRunning is called, then it returns false', async () => {
        const running = await isDaemonRunning(tempDir);

        assert.strictEqual(running, false);
    });

    test('Given a PID file with a non-existent PID, when isDaemonRunning is called, then it returns false', async () => {
        // Arrange: write a PID file and stub process.kill to throw ESRCH
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), '999999999', 'utf-8');

        const killStub = sinon.stub(process, 'kill').throws(
            Object.assign(new Error('kill ESRCH 999999999'), { code: 'ESRCH' })
        );

        // Act
        const running = await isDaemonRunning(tempDir);

        // Assert
        killStub.restore();
        assert.strictEqual(running, false);
    });

    test('Given a PID file with the current process PID, when isDaemonRunning is called, then it returns true', async () => {
        // Arrange: write the current process's PID — it is definitely alive
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(process.pid), 'utf-8');

        // Act
        const running = await isDaemonRunning(tempDir);

        // Assert
        assert.strictEqual(running, true);
    });

    // -------------------------------------------------------------------------
    // getDaemonPort / getDaemonPid
    // -------------------------------------------------------------------------

    test('Given no port file, when getDaemonPort is called, then it returns undefined', async () => {
        const port = await getDaemonPort(tempDir);
        assert.strictEqual(port, undefined);
    });

    test('Given a port file with value 3000, when getDaemonPort is called, then it returns 3000', async () => {
        // Arrange
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.port'), '3000', 'utf-8');

        // Act
        const port = await getDaemonPort(tempDir);

        // Assert
        assert.strictEqual(port, 3000);
    });

    test('Given no PID file, when getDaemonPid is called, then it returns undefined', async () => {
        const pid = await getDaemonPid(tempDir);
        assert.strictEqual(pid, undefined);
    });

    test('Given a PID file with value 12345, when getDaemonPid is called, then it returns 12345', async () => {
        // Arrange
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), '12345', 'utf-8');

        // Act
        const pid = await getDaemonPid(tempDir);

        // Assert
        assert.strictEqual(pid, 12345);
    });

    test('Given a port file with non-numeric content, when getDaemonPort is called, then it returns undefined', async () => {
        // Arrange
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.port'), 'not-a-number', 'utf-8');

        // Act
        const port = await getDaemonPort(tempDir);

        // Assert
        assert.strictEqual(port, undefined);
    });

    test('Given a PID file with non-numeric content, when getDaemonPid is called, then it returns undefined', async () => {
        // Arrange
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), 'not-a-number', 'utf-8');

        // Act
        const pid = await getDaemonPid(tempDir);

        // Assert
        assert.strictEqual(pid, undefined);
    });
});
