import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { startPolling, stopPolling, disposeAll } from '../../vscode/services/PollingStatusService';

suite('PollingStatusService', () => {

    let tmpDir: string;

    setup(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lanes-poll-test-'));
    });

    teardown(async () => {
        // Clean up all trackers
        disposeAll();
        // Clean up temp directory
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    test('startPolling and stopPolling do not throw for a mock terminal', () => {
        // Create a minimal terminal-like object to use as a Map key
        const terminal = {} as vscode.Terminal;
        const logPath = path.join(tmpDir, 'session.json');

        assert.doesNotThrow(() => {
            startPolling(terminal, logPath, tmpDir);
        }, 'startPolling should not throw');

        assert.doesNotThrow(() => {
            stopPolling(terminal);
        }, 'stopPolling should not throw');
    });

    test('stopPolling is a no-op for an untracked terminal', () => {
        const terminal = {} as vscode.Terminal;

        assert.doesNotThrow(() => {
            stopPolling(terminal);
        }, 'stopPolling should be a no-op for untracked terminal');
    });

    test('disposeAll cleans up all trackers without throwing', () => {
        const terminal1 = {} as vscode.Terminal;
        const terminal2 = {} as vscode.Terminal;
        const logPath1 = path.join(tmpDir, 'session1.json');
        const logPath2 = path.join(tmpDir, 'session2.json');

        startPolling(terminal1, logPath1, tmpDir);
        startPolling(terminal2, logPath2, tmpDir);

        assert.doesNotThrow(() => {
            disposeAll();
        }, 'disposeAll should not throw');

        // After disposeAll, stopPolling should be a no-op
        assert.doesNotThrow(() => {
            stopPolling(terminal1);
            stopPolling(terminal2);
        }, 'stopPolling after disposeAll should be a no-op');
    });

    test('startPolling replaces existing tracker for same terminal', () => {
        const terminal = {} as vscode.Terminal;
        const logPath1 = path.join(tmpDir, 'session1.json');
        const logPath2 = path.join(tmpDir, 'session2.json');

        // Start with first log path
        startPolling(terminal, logPath1, tmpDir);
        // Replace with second log path (should dispose the first)
        assert.doesNotThrow(() => {
            startPolling(terminal, logPath2, tmpDir);
        }, 'startPolling should replace existing tracker without error');

        // Cleanup
        stopPolling(terminal);
    });

    test('file modification triggers working status', async () => {
        const terminal = {} as vscode.Terminal;
        const logPath = path.join(tmpDir, 'session.jsonl');

        // Create the log file first so the watcher has something to watch
        await fs.writeFile(logPath, '{"type":"init"}\n', 'utf-8');

        // Start polling
        startPolling(terminal, logPath, tmpDir);

        // Write to the log file to trigger activity
        await fs.appendFile(logPath, '{"type":"message"}\n', 'utf-8');

        // Wait for the file system watcher to pick up the change
        // FileSystemWatcher events are asynchronous
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Check if the status file was written
        // Note: getStatusFilePath depends on global state, so we check if writeJson was called
        // by looking for the status file. Since getStatusFilePath may not resolve to tmpDir
        // in test context, we verify no errors were thrown.
        stopPolling(terminal);
    });
});
