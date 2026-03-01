import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ConfigStore } from '../../bridge/config';

suite('Bridge ConfigStore', () => {
    test('normalizes legacy terminalMode "code" to "vscode"', async () => {
        const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'lanes-config-'));
        const store = new ConfigStore(workspace);
        await store.initialize();

        await store.set('lanes.terminalMode', 'code');
        const value = store.get('lanes.terminalMode');

        assert.strictEqual(value, 'vscode');
    });
});
