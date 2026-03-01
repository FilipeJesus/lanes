import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { FileWatchManager } from '../../bridge/fileWatcher';
import { NotificationEmitter } from '../../bridge/notifications';

class TestNotificationEmitter extends NotificationEmitter {
    public readonly events: Array<{ method: string; params: Record<string, unknown> }> = [];

    sendNotification(method: string, params: Record<string, unknown>): void {
        this.events.push({ method, params });
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

suite('Bridge FileWatchManager', () => {
    test('respects glob pattern and unwatch lifecycle', async function () {
        this.timeout(10_000);
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'lanes-watch-'));
        const emitter = new TestNotificationEmitter();
        const manager = new FileWatchManager(emitter, { usePolling: true });

        const watchId = manager.watch(workspace, '**/*.txt');
        await manager.waitForReady(watchId);

        await fs.writeFile(path.join(workspace, 'match.txt'), 'a');
        await fs.writeFile(path.join(workspace, 'ignore.ts'), 'b');
        await sleep(1500);

        const matchingEvents = emitter.events.filter(event => {
            return String(event.params.path).endsWith('match.txt');
        });
        const ignoredEvents = emitter.events.filter(event => {
            return String(event.params.path).endsWith('ignore.ts');
        });

        assert.ok(matchingEvents.length > 0, 'Expected a notification for matching file');
        assert.strictEqual(ignoredEvents.length, 0, 'Non-matching file should not emit events');

        const unwatched = await manager.unwatch(watchId);
        assert.strictEqual(unwatched, true, 'Expected unwatch to return true');

        const before = emitter.events.length;
        await fs.writeFile(path.join(workspace, 'after-unwatch.txt'), 'c');
        await sleep(500);
        assert.strictEqual(emitter.events.length, before, 'No events should arrive after unwatch');

        manager.dispose();
    });
});
