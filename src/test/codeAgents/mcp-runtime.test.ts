import * as assert from 'assert';
import sinon from 'sinon';
import { getAgent } from '../../core/codeAgents';

suite('MCP runtime selection', () => {
    const agents = ['claude', 'codex', 'antigravity', 'gemini', 'opencode', 'pi'];
    let sandbox: sinon.SinonSandbox;

    setup(() => { sandbox = sinon.createSandbox(); });
    teardown(() => { sandbox.restore(); });

    function assertCommands(expected: string): void {
        for (const name of agents) {
            const config = getAgent(name)!.getMcpConfig('/repo', '/workflow.yaml', '/repo');
            assert.strictEqual(config?.mcpServers['lanes-workflow'].command, expected, name);
        }
    }

    test('uses Node in the real extension host', () => {
        assertCommands('node');
    });

    for (const execPath of [
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
        '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
        'C:\\Program Files\\Microsoft VS Code\\Code.exe',
        '/usr/share/code/code',
    ]) {
        for (const electron of [undefined, '39.3.0']) {
            test(`uses Node for ${execPath} with Electron version ${electron}`, () => {
                sandbox.stub(process, 'execPath').value(execPath);
                sandbox.stub(process, 'versions').value({ ...process.versions, electron });
                assertCommands('node');
            });
        }
    }

    for (const execPath of ['/opt/node/bin/node', '/usr/bin/nodejs', 'C:\\Program Files\\nodejs\\node.exe']) {
        test(`preserves standalone Node runtime ${execPath}`, () => {
            sandbox.stub(process, 'execPath').value(execPath);
            sandbox.stub(process, 'versions').value({ ...process.versions, electron: undefined });
            assertCommands(execPath);
        });
    }
});
