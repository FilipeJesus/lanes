/**
 * Tests for daemon lifecycle module.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import {
    DaemonStartupError,
    getDaemonErrorSummary,
    getDaemonLogPath,
    getDaemonPid,
    getDaemonPort,
    getMachineDaemonState,
    isDaemonRunning,
    readDaemonLogTail,
    startDaemon,
    stopDaemon,
} from '../../daemon/lifecycle';

function writeFakeDaemonFiles(homeDir: string, pid: number, port: number): void {
    const lanesDir = path.join(homeDir, '.lanes');
    fs.mkdirSync(lanesDir, { recursive: true });
    fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(pid), 'utf-8');
    fs.writeFileSync(path.join(lanesDir, 'daemon.port'), String(port), 'utf-8');
}

function writeScript(tempDir: string, fileName: string, content: string): string {
    const scriptPath = path.join(tempDir, fileName);
    fs.writeFileSync(scriptPath, content, 'utf-8');
    return scriptPath;
}

function createReadyDaemonScript(tempDir: string): string {
    return writeScript(
        tempDir,
        'ready-daemon.js',
        [
            'const fs = require("fs");',
            'const path = require("path");',
            'const os = require("os");',
            'const lanesDir = path.join(process.env.HOME || os.homedir(), ".lanes");',
            'fs.mkdirSync(lanesDir, { recursive: true });',
            'const portIndex = process.argv.indexOf("--port");',
            'const requestedPort = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 0;',
            'const port = requestedPort > 0 ? requestedPort : 4317;',
            'const startedAt = new Date().toISOString();',
            'fs.writeFileSync(path.join(lanesDir, "daemon.pid"), String(process.pid), "utf-8");',
            'fs.writeFileSync(path.join(lanesDir, "daemon.port"), String(port), "utf-8");',
            'fs.writeFileSync(path.join(lanesDir, "daemon.token"), "test-token", "utf-8");',
            'fs.writeFileSync(path.join(lanesDir, "daemon.startedAt"), startedAt, "utf-8");',
            'process.stderr.write(`[Daemon] ready on ${port}\\n`);',
            'setInterval(() => {}, 1000);',
            'process.on("SIGTERM", () => process.exit(0));',
        ].join('\n')
    );
}

function createFailingDaemonScript(tempDir: string): string {
    return writeScript(
        tempDir,
        'failing-daemon.js',
        [
            'process.stderr.write("[Daemon] fatal bootstrap issue\\n");',
            'process.exit(1);',
        ].join('\n')
    );
}

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

    test('startDaemon waits for readiness, writes lifecycle files, and reports the log path', async () => {
        const serverPath = createReadyDaemonScript(tempDir);
        const result = await startDaemon({
            workspaceRoot: tempDir,
            port: 4242,
            serverPath,
        });

        try {
            const pidPath = path.join(tempDir, '.lanes', 'daemon.pid');
            const portPath = path.join(tempDir, '.lanes', 'daemon.port');

            assert.strictEqual(result.reusedExisting, false);
            assert.strictEqual(result.port, 4242);
            assert.strictEqual(result.logPath, getDaemonLogPath());
            assert.ok(fs.existsSync(pidPath), 'daemon.pid should exist after successful startup');
            assert.ok(fs.existsSync(portPath), 'daemon.port should exist after successful startup');
            assert.strictEqual(await isDaemonRunning(), true);
        } finally {
            await stopDaemon();
        }
    });

    test('startDaemon reuses an already-running daemon and keeps the same lifecycle data', async () => {
        const serverPath = createReadyDaemonScript(tempDir);
        const first = await startDaemon({
            workspaceRoot: tempDir,
            port: 4242,
            serverPath,
        });

        try {
            const second = await startDaemon({
                workspaceRoot: tempDir,
                port: 4242,
                serverPath,
            });

            assert.strictEqual(second.reusedExisting, true);
            assert.strictEqual(second.pid, first.pid);
            assert.strictEqual(second.port, first.port);
            assert.strictEqual(second.logPath, first.logPath);
        } finally {
            await stopDaemon();
        }
    });

    test('startDaemon surfaces recent log output when startup fails', async () => {
        const serverPath = createFailingDaemonScript(tempDir);

        await assert.rejects(
            async () => startDaemon({ workspaceRoot: tempDir, port: 4242, serverPath }),
            (err: unknown) => {
                assert.ok(err instanceof DaemonStartupError);
                assert.match(err.message, /Failed to start daemon:/);
                assert.match(err.message, /fatal bootstrap issue/);
                assert.match(getDaemonErrorSummary(err), /Log:/);
                return true;
            }
        );

        const logTail = await readDaemonLogTail(10);
        assert.ok(
            logTail.some((line) => line.includes('fatal bootstrap issue')),
            'daemon log tail should include the startup failure'
        );
    });

    test('readDaemonLogTail returns the requested number of recent lines', async () => {
        const logPath = getDaemonLogPath();
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        fs.writeFileSync(logPath, ['one', 'two', 'three', 'four'].join('\n'), 'utf-8');

        const tail = await readDaemonLogTail(2);

        assert.deepStrictEqual(tail, ['three', 'four']);
    });

    test('stopDaemon removes lifecycle files and sends SIGTERM to the daemon pid', async () => {
        writeFakeDaemonFiles(tempDir, 12345, 4242);
        const pidPath = path.join(tempDir, '.lanes', 'daemon.pid');
        const portPath = path.join(tempDir, '.lanes', 'daemon.port');
        const killStub = sinon.stub(process, 'kill');

        await stopDaemon();

        killStub.restore();
        assert.ok(killStub.calledOnce);
        assert.strictEqual(killStub.firstCall.args[0], 12345);
        assert.strictEqual(killStub.firstCall.args[1], 'SIGTERM');
        assert.ok(!fs.existsSync(pidPath));
        assert.ok(!fs.existsSync(portPath));
    });

    test('isDaemonRunning returns false when the pid file is missing', async () => {
        assert.strictEqual(await isDaemonRunning(), false);
    });

    test('isDaemonRunning returns false and clears stale lifecycle files for a dead pid', async () => {
        writeFakeDaemonFiles(tempDir, 999999999, 4242);
        const killStub = sinon.stub(process, 'kill').throws(
            Object.assign(new Error('kill ESRCH 999999999'), { code: 'ESRCH' })
        );

        const running = await isDaemonRunning();

        killStub.restore();
        assert.strictEqual(running, false);
        assert.strictEqual(fs.existsSync(path.join(tempDir, '.lanes', 'daemon.pid')), false);
        assert.strictEqual(fs.existsSync(path.join(tempDir, '.lanes', 'daemon.port')), false);
    });

    test('getDaemonPort and getDaemonPid return parsed values from lifecycle files', async () => {
        writeFakeDaemonFiles(tempDir, 12345, 3000);

        assert.strictEqual(await getDaemonPort(), 3000);
        assert.strictEqual(await getDaemonPid(), 12345);
    });

    test('getDaemonPort and getDaemonPid return undefined for invalid content', async () => {
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.port'), 'not-a-number', 'utf-8');
        fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), 'not-a-number', 'utf-8');

        assert.strictEqual(await getDaemonPort(), undefined);
        assert.strictEqual(await getDaemonPid(), undefined);
    });

    test('getMachineDaemonState returns metadata for legacy lifecycle files without daemon.startedAt', async () => {
        const lanesDir = path.join(tempDir, '.lanes');
        fs.mkdirSync(lanesDir, { recursive: true });
        fs.writeFileSync(path.join(lanesDir, 'daemon.pid'), String(process.pid), 'utf-8');
        fs.writeFileSync(path.join(lanesDir, 'daemon.port'), '3000', 'utf-8');
        fs.writeFileSync(path.join(lanesDir, 'daemon.token'), 'legacy-token', 'utf-8');

        const state = await getMachineDaemonState();

        assert.ok(state, 'Expected legacy daemon files to produce a machine daemon state');
        assert.strictEqual(state?.pid, process.pid);
        assert.strictEqual(state?.port, 3000);
        assert.strictEqual(state?.token, 'legacy-token');
        assert.ok(state?.startedAt, 'Compatibility state should synthesize a startedAt value');
    });
});
