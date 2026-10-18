import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

suite('MCP tool scope', () => {
    let repoRoot: string;
    let client: Client;

    setup(() => {
        repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-mcp-scope-'));
        client = new Client({ name: 'lanes-test', version: '1.0.0' });
    });

    teardown(async () => {
        await client.close();
        fs.rmSync(repoRoot, { recursive: true, force: true });
    });

    async function connect(worktreePath: string, workflowPath?: string) {
        const args = [path.resolve(__dirname, '../../mcp/server.js'), '--worktree', worktreePath, '--repo-root', repoRoot];
        if (workflowPath) { args.push('--workflow-path', workflowPath); }
        await client.connect(new StdioClientTransport({
            command: process.execPath, args,
            env: { ELECTRON_RUN_AS_NODE: '1' }, stderr: 'pipe',
        }));
    }

    test('advertises only session_create without a workflow and rejects workflow calls', async () => {
        await connect(repoRoot);
        assert.deepStrictEqual((await client.listTools()).tools.map(tool => tool.name), ['session_create']);
        for (const name of ['workflow_start', 'workflow_status', 'workflow_set_tasks', 'workflow_advance', 'workflow_context', 'session_clear']) {
            const result = await client.callTool({ name, arguments: {} });
            assert.strictEqual(result.isError, true, name);
        }
        assert.ok(!fs.existsSync(path.join(repoRoot, 'workflow-state.json')));
    });

    test('creates child-session requests with the quick session parent identity', async () => {
        const parent = 'quick-start-claude-test';
        const sessionPath = path.join(repoRoot, '.lanes', 'current-sessions', parent);
        fs.mkdirSync(sessionPath, { recursive: true });
        await connect(sessionPath);
        const result = await client.callTool({ name: 'session_create', arguments: { name: 'child', sourceBranch: 'main' } });
        assert.ok(!result.isError, JSON.stringify(result));
        const pendingDir = path.join(repoRoot, '.lanes', 'pending-sessions');
        const files = fs.readdirSync(pendingDir);
        assert.strictEqual(files.length, 1);
        const request = JSON.parse(fs.readFileSync(path.join(pendingDir, files[0]), 'utf8'));
        assert.strictEqual(request.parentSession, parent);
        assert.strictEqual(request.name, 'child');
    });

    test('retains the full tool set and starts an assigned workflow', async () => {
        const workflowPath = path.join(repoRoot, 'workflow.yaml');
        fs.writeFileSync(workflowPath, 'name: test\ndescription: Test workflow\nsteps:\n  - id: plan\n    type: action\n    instructions: Plan the change\n');
        await connect(repoRoot, workflowPath);
        const names = (await client.listTools()).tools.map(tool => tool.name);
        assert.deepStrictEqual(names.sort(), ['workflow_start', 'workflow_status', 'workflow_set_tasks', 'workflow_advance', 'workflow_context', 'session_create', 'session_clear'].sort());
        const result = await client.callTool({ name: 'workflow_start', arguments: {} });
        assert.ok(!result.isError, JSON.stringify(result));
        assert.ok(fs.existsSync(path.join(repoRoot, 'workflow-state.json')));
    });
});
