import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodexAgent } from '../../core/codeAgents/CodexAgent';
import { getSettingsFormat } from '../../core/services/SettingsFormatService';

suite('SettingsFormatService', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-format-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('defaults to two-space JSON', async () => {
        const filePath = path.join(tempDir, 'settings.json');
        const format = getSettingsFormat();

        await format.write(filePath, { nested: { enabled: true } });

        assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), '{\n  "nested": {\n    "enabled": true\n  }\n}');
        assert.deepStrictEqual(await format.read(filePath), { nested: { enabled: true } });
    });

    test('round-trips TOML settings', async () => {
        const filePath = path.join(tempDir, 'config.toml');
        const format = getSettingsFormat(new CodexAgent());

        await format.write(filePath, { model: 'gpt-5', sandbox: { enabled: true } });
        const settings = await format.read(filePath);

        assert.strictEqual(settings.model, 'gpt-5');
        assert.deepStrictEqual(settings.sandbox, { enabled: true });
    });
});
