/**
 * MCP Workflow Artefacts Registration Tests
 *
 * Tests for the workflowRegisterArtefacts tool and MCP session creation.
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
	workflowStart,
	workflowRegisterArtefacts,
	createSession,
	getPendingSessionsDir,
	PendingSessionConfig,
	loadState,
} from '../../mcp/tools';
import {
	WorkflowStateMachine,
	loadWorkflowTemplateFromString,
} from '../../workflow';

const SIMPLE_WORKFLOW_YAML = `
name: simple-workflow
description: A simple workflow without loops

agents:
  default:
    description: Default agent
    tools: [read]
    cannot: []

loops: {}

steps:
  - id: step1
    type: action
    instructions: First step
  - id: step2
    type: action
    instructions: Second step
`;

suite('MCP Workflow Artefacts', () => {
	let tempDir: string;
	let templatesDir: string;

	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-artefacts-test-'));
		templatesDir = path.join(tempDir, 'workflows');
		fs.mkdirSync(templatesDir, { recursive: true });

		fs.writeFileSync(
			path.join(templatesDir, 'simple-workflow.yaml'),
			SIMPLE_WORKFLOW_YAML
		);
	});

	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('workflowRegisterArtefacts', () => {
		test('workflowRegisterArtefacts registers valid file paths', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const testFile1 = path.join(tempDir, 'test-file-1.txt');
			const testFile2 = path.join(tempDir, 'test-file-2.txt');
			fs.writeFileSync(testFile1, 'content 1');
			fs.writeFileSync(testFile2, 'content 2');

			const result = await workflowRegisterArtefacts(machine, [testFile1, testFile2], tempDir);

			assert.strictEqual(result.registered.length, 2);
			assert.ok(result.registered.includes(testFile1));
			assert.ok(result.registered.includes(testFile2));
			assert.strictEqual(result.duplicates.length, 0);
			assert.strictEqual(result.invalid.length, 0);
		});

		test('workflowRegisterArtefacts identifies duplicate paths', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const testFile = path.join(tempDir, 'test-file.txt');
			fs.writeFileSync(testFile, 'content');

			await workflowRegisterArtefacts(machine, [testFile], tempDir);

			const result = await workflowRegisterArtefacts(machine, [testFile], tempDir);

			assert.strictEqual(result.registered.length, 0);
			assert.strictEqual(result.duplicates.length, 1);
			assert.ok(result.duplicates.includes(testFile));
		});

		test('workflowRegisterArtefacts identifies invalid paths', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');
			const emptyPath = '   ';

			const result = await workflowRegisterArtefacts(machine, [nonExistentFile, emptyPath], tempDir);

			assert.strictEqual(result.registered.length, 0);
			assert.strictEqual(result.invalid.length, 2);
		});

		test('workflowRegisterArtefacts saves state after registration', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const testFile = path.join(tempDir, 'test-file.txt');
			fs.writeFileSync(testFile, 'content');

			await workflowRegisterArtefacts(machine, [testFile], tempDir);

			const statePath = path.join(tempDir, 'workflow-state.json');
			const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
			assert.ok(savedState.artefacts);
			assert.ok(savedState.artefacts.includes(testFile));
		});

		test('workflowRegisterArtefacts persists artefacts across server restarts', async () => {
			const { machine: machine1 } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const testFile = path.join(tempDir, 'test-file.txt');
			fs.writeFileSync(testFile, 'content');

			await workflowRegisterArtefacts(machine1, [testFile], tempDir);

			const loadedState = await loadState(tempDir);
			assert.ok(loadedState);

			const template = await loadWorkflowTemplateFromString(SIMPLE_WORKFLOW_YAML);
			const machine2 = WorkflowStateMachine.fromState(template, loadedState);
			const status = machine2.getStatus();

			assert.ok(status.artefacts);
			assert.ok(status.artefacts.includes(testFile));
		});

		test('workflowRegisterArtefacts handles mixed valid, duplicate, and invalid paths', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const testFile1 = path.join(tempDir, 'test-file-1.txt');
			const testFile2 = path.join(tempDir, 'test-file-2.txt');
			fs.writeFileSync(testFile1, 'content 1');
			fs.writeFileSync(testFile2, 'content 2');

			await workflowRegisterArtefacts(machine, [testFile1], tempDir);

			const nonExistentFile = path.join(tempDir, 'does-not-exist.txt');

			const result = await workflowRegisterArtefacts(machine, [testFile1, testFile2, nonExistentFile], tempDir);

			assert.strictEqual(result.registered.length, 1);
			assert.ok(result.registered.includes(testFile2));
			assert.strictEqual(result.duplicates.length, 1);
			assert.ok(result.duplicates.includes(testFile1));
			assert.strictEqual(result.invalid.length, 1);
		});

		test('workflowRegisterArtefacts works with relative paths', async () => {
			const { machine } = await workflowStart(tempDir, 'simple-workflow', templatesDir);

			const testFileName = 'test-file.txt';
			const testFile = path.join(tempDir, testFileName);
			fs.writeFileSync(testFile, 'content');

			const originalCwd = process.cwd();

			try {
				process.chdir(tempDir);

				const result = await workflowRegisterArtefacts(machine, [testFileName], tempDir);

				assert.strictEqual(result.registered.length, 1);
				assert.ok(path.isAbsolute(result.registered[0]));
			} finally {
				process.chdir(originalCwd);
			}
		});
	});
});

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
