/**
 * MCP Session Creation Tests
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	createSession,
	getPendingSessionsDir,
	PendingSessionConfig,
} from '../../mcp/tools';

suite('MCP Session Creation with Workflow', () => {
	let testRepoRoot: string;

	setup(() => {
		testRepoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-session-test-'));
	});

	teardown(() => {
		fs.rmSync(testRepoRoot, { recursive: true, force: true });
	});

	test('createSession accepts workflow parameter and includes it in config', async () => {
		const result = await createSession('test-session-workflow', 'main', 'Test prompt', 'feature', testRepoRoot);

		assert.ok(result.success);
		assert.ok(result.configPath);

		const expectedDir = getPendingSessionsDir(testRepoRoot);
		assert.ok(result.configPath!.startsWith(expectedDir));

		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, 'feature');
		assert.strictEqual(config.name, 'test-session-workflow');
		assert.strictEqual(config.sourceBranch, 'main');
		assert.strictEqual(config.prompt, 'Test prompt');
	});

	test('createSession works without workflow (undefined)', async () => {
		const result = await createSession('test-session-no-workflow', 'main', 'Test prompt', undefined, testRepoRoot);

		assert.ok(result.success);
		assert.ok(result.configPath);

		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, undefined);
		assert.strictEqual(config.name, 'test-session-no-workflow');
	});

	test('createSession trims workflow parameter', async () => {
		const result = await createSession('test-session-trim', 'main', undefined, '  feature  ', testRepoRoot);

		assert.ok(result.success);
		assert.ok(result.configPath);

		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, 'feature');
	});

	test('createSession handles empty workflow string as undefined', async () => {
		const result = await createSession('test-session-empty', 'main', undefined, '   ', testRepoRoot);

		assert.ok(result.success);
		assert.ok(result.configPath);

		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.strictEqual(config.workflow, undefined);
	});

	test('createSession includes requestedAt timestamp', async () => {
		const beforeTime = new Date().toISOString();
		const result = await createSession('test-session-timestamp', 'main', undefined, undefined, testRepoRoot);
		const afterTime = new Date().toISOString();

		assert.ok(result.success);
		assert.ok(result.configPath);

		const configContent = fs.readFileSync(result.configPath!, 'utf-8');
		const config: PendingSessionConfig = JSON.parse(configContent);

		assert.ok(config.requestedAt);
		assert.ok(config.requestedAt >= beforeTime);
		assert.ok(config.requestedAt <= afterTime);
	});

	test('createSession fails when repoRoot is not provided', async () => {
		const result = await createSession('test-session-no-root', 'main');

		assert.strictEqual(result.success, false);
		assert.ok(result.error);
		assert.ok(result.error!.includes('Repository root path is required'));
	});
});
