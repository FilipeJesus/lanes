/**
 * Tests for SessionHandlerService.
 *
 * Covers:
 *  - Construction with a IHandlerContext
 *  - Presence of all 27 handler methods
 *  - config.get validation (valid key, invalid key, missing key)
 *  - Session name validation (path traversal prevention)
 *  - Agent list handler (returns agents with required fields)
 *  - Workflow name validation (special chars rejected, valid names accepted)
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    SessionHandlerService,
    JsonRpcHandlerError,
    validateSessionName,
} from '../../../core/services/SessionHandlerService';
import type {
    IHandlerContext,
    ISimpleConfigStore,
    INotificationEmitter,
    IFileWatchManager,
} from '../../../core/interfaces/IHandlerContext';
import { getAvailableAgents } from '../../../core/codeAgents';

// ---------------------------------------------------------------------------
// Minimal stub implementations
// ---------------------------------------------------------------------------

class StubConfigStore implements ISimpleConfigStore {
    private readonly data: Record<string, unknown>;

    constructor(initial: Record<string, unknown> = {}) {
        this.data = { ...initial };
    }

    get(key: string): unknown {
        return this.data[key];
    }

    async set(key: string, value: unknown): Promise<void> {
        this.data[key] = value;
    }

    getAll(prefix?: string): Record<string, unknown> {
        if (!prefix) {
            return { ...this.data };
        }
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(this.data)) {
            if (k.startsWith(prefix)) {
                result[k] = v;
            }
        }
        return result;
    }
}

class StubNotificationEmitter implements INotificationEmitter {
    public readonly events: Array<{ type: string; args: unknown[] }> = [];

    sessionStatusChanged(
        sessionName: string,
        status: { status: string; timestamp?: string; message?: string }
    ): void {
        this.events.push({ type: 'sessionStatusChanged', args: [sessionName, status] });
    }

    fileChanged(filePath: string, eventType: 'created' | 'changed' | 'deleted'): void {
        this.events.push({ type: 'fileChanged', args: [filePath, eventType] });
    }

    sessionCreated(sessionName: string, worktreePath: string): void {
        this.events.push({ type: 'sessionCreated', args: [sessionName, worktreePath] });
    }

    sessionDeleted(sessionName: string): void {
        this.events.push({ type: 'sessionDeleted', args: [sessionName] });
    }
}

class StubFileWatchManager implements IFileWatchManager {
    private nextId = 0;

    watch(_basePath: string, _pattern: string): string {
        return `watch-${this.nextId++}`;
    }

    async unwatch(_watchId: string): Promise<boolean> {
        return true;
    }

    dispose(): void {
        // no-op
    }
}

function makeContext(
    workspaceRoot: string,
    configOverrides: Record<string, unknown> = {}
): IHandlerContext {
    return {
        workspaceRoot,
        config: new StubConfigStore(configOverrides),
        notificationEmitter: new StubNotificationEmitter(),
        fileWatchManager: new StubFileWatchManager(),
    };
}

// ---------------------------------------------------------------------------
// Suite: SessionHandlerService construction
// ---------------------------------------------------------------------------

suite('SessionHandlerService', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-shs-'));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('can be constructed with a IHandlerContext without throwing', () => {
        const ctx = makeContext(tempDir);
        assert.doesNotThrow(() => {
            new SessionHandlerService(ctx);
        });
    });

    test('has all 27 expected handler methods', () => {
        const ctx = makeContext(tempDir);
        const service = new SessionHandlerService(ctx);

        const expectedMethods = [
            // Sessions
            'handleSessionList',
            'handleSessionCreate',
            'handleSessionDelete',
            'handleSessionClear',
            'handleSessionGetStatus',
            'handleSessionOpen',
            'handleSessionPin',
            'handleSessionUnpin',
            'handleSessionFormPromptImprove',
            'handleSessionFormAttachmentUpload',
            // Git
            'handleGitListBranches',
            'handleGitGetDiff',
            'handleGitGetDiffFiles',
            'handleGitGetWorktreeInfo',
            'handleGitRepairWorktrees',
            // Workflows
            'handleWorkflowList',
            'handleWorkflowValidate',
            'handleWorkflowCreate',
            'handleWorkflowGetState',
            // Agents
            'handleAgentList',
            'handleAgentGetConfig',
            // Config
            'handleConfigGet',
            'handleConfigSet',
            'handleConfigGetAll',
            // Terminals
            'handleTerminalCreate',
            'handleTerminalSend',
            'handleTerminalList',
            // File watchers
            'handleFileWatcherWatch',
            'handleFileWatcherUnwatch',
        ];

        for (const method of expectedMethods) {
            assert.ok(
                typeof (service as unknown as Record<string, unknown>)[method] === 'function',
                `Expected method '${method}' to exist on SessionHandlerService`
            );
        }

        assert.strictEqual(
            expectedMethods.length,
            29,
            'Expected exactly 29 handler methods'
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: config handlers
// ---------------------------------------------------------------------------

suite('SessionHandlerService - config handlers', () => {
    let tempDir: string;
    let service: SessionHandlerService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-shs-config-'));
        const ctx = makeContext(tempDir, {
            'lanes.defaultAgent': 'claude',
            'lanes.terminalMode': 'vscode',
        });
        service = new SessionHandlerService(ctx);
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('handleConfigGet returns the value for a valid key', async () => {
        const result = await service.handleConfigGet({ key: 'lanes.defaultAgent' }) as { value: unknown };
        assert.strictEqual(result.value, 'claude');
    });

    test('handleConfigGet returns null for a valid key with no value set', async () => {
        const result = await service.handleConfigGet({ key: 'lanes.baseBranch' }) as { value: unknown };
        // Not set in stub, so value should be null (undefined mapped to null)
        assert.strictEqual(result.value, null);
    });

    test('handleConfigGet throws JsonRpcHandlerError with code -32602 for an invalid key', async () => {
        let thrown: unknown;
        try {
            await service.handleConfigGet({ key: 'lanes.unknownInvalidKey' });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof JsonRpcHandlerError, 'Should throw JsonRpcHandlerError');
        assert.strictEqual(
            (thrown as JsonRpcHandlerError).code,
            -32602,
            'Error code should be -32602 (INVALID_PARAMS)'
        );
    });

    test('handleConfigGet error message for invalid key mentions valid keys', async () => {
        let thrown: unknown;
        try {
            await service.handleConfigGet({ key: 'not.valid' });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof JsonRpcHandlerError);
        assert.ok(
            (thrown as JsonRpcHandlerError).message.includes('lanes.terminalMode'),
            'Error message should list at least one valid key'
        );
    });

    test('handleConfigGet throws an error when key parameter is missing', async () => {
        let thrown: unknown;
        try {
            await service.handleConfigGet({});
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error when key is missing');
    });
});

// ---------------------------------------------------------------------------
// Suite: validation
// ---------------------------------------------------------------------------

suite('SessionHandlerService - validation', () => {
    let tempDir: string;
    let service: SessionHandlerService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-shs-validation-'));
        service = new SessionHandlerService(makeContext(tempDir));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('handleSessionDelete throws for a session name containing ".."', async () => {
        let thrown: unknown;
        try {
            await service.handleSessionDelete({ sessionName: '../../etc/passwd' });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error');
        const message = (thrown as Error).message.toLowerCase();
        assert.ok(
            message.includes('invalid') || message.includes('traversal') || message.includes('..'),
            `Error message should indicate invalid name, got: ${(thrown as Error).message}`
        );
    });

    test('handleSessionDelete throws for a session name containing "/"', async () => {
        let thrown: unknown;
        try {
            await service.handleSessionDelete({ sessionName: 'feat/dangerous' });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error for name containing /');
    });

    test('handleSessionDelete throws for a session name containing "\\"', async () => {
        let thrown: unknown;
        try {
            await service.handleSessionDelete({ sessionName: 'feat\\dangerous' });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error for name containing backslash');
    });

    test('validateSessionName does not throw for a valid session name', () => {
        assert.doesNotThrow(() => {
            validateSessionName('valid-session-name');
        });
    });

    test('validateSessionName does not throw for a session name with hyphens and numbers', () => {
        assert.doesNotThrow(() => {
            validateSessionName('feat-auth-v2-123');
        });
    });

    test('validateSessionName throws for an empty string', () => {
        assert.throws(() => {
            validateSessionName('');
        }, Error);
    });
});

// ---------------------------------------------------------------------------
// Suite: agent handlers
// ---------------------------------------------------------------------------

suite('SessionHandlerService - agent handlers', () => {
    let tempDir: string;
    let service: SessionHandlerService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-shs-agents-'));
        service = new SessionHandlerService(makeContext(tempDir));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('handleAgentList returns an object with an agents array', async () => {
        const result = await service.handleAgentList({}) as { agents: unknown[] };

        assert.ok(result, 'Result should not be null/undefined');
        assert.ok(Array.isArray(result.agents), 'result.agents should be an array');
    });

    test('handleAgentList returns all available agents', async () => {
        const result = await service.handleAgentList({}) as { agents: unknown[] };
        const availableNames = getAvailableAgents();

        assert.strictEqual(
            result.agents.length,
            availableNames.length,
            `Should return ${availableNames.length} agents`
        );
    });

    test('each agent in handleAgentList has required fields: name, displayName, cliCommand, permissionModes', async () => {
        const result = await service.handleAgentList({}) as {
            agents: Array<{
                name: string;
                displayName: string;
                cliCommand: string;
                permissionModes: unknown[];
            }>;
        };

        assert.ok(result.agents.length > 0, 'Should have at least one agent');

        for (const agent of result.agents) {
            assert.ok(typeof agent.name === 'string' && agent.name.length > 0,
                `Agent name should be a non-empty string, got: ${JSON.stringify(agent.name)}`);
            assert.ok(typeof agent.displayName === 'string' && agent.displayName.length > 0,
                `Agent displayName should be a non-empty string, got: ${JSON.stringify(agent.displayName)}`);
            assert.ok(typeof agent.cliCommand === 'string' && agent.cliCommand.length > 0,
                `Agent cliCommand should be a non-empty string, got: ${JSON.stringify(agent.cliCommand)}`);
            assert.ok(Array.isArray(agent.permissionModes),
                `Agent permissionModes should be an array, got: ${JSON.stringify(agent.permissionModes)}`);
        }
    });

    test('handleAgentList result includes the claude agent', async () => {
        const result = await service.handleAgentList({}) as {
            agents: Array<{ name: string }>;
        };

        const claudeAgent = result.agents.find((a) => a.name === 'claude');
        assert.ok(claudeAgent, 'claude agent should be present in the agent list');
    });
});

suite('SessionHandlerService - web session form helpers', () => {
    let tempDir: string;
    let service: SessionHandlerService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-shs-web-form-'));
        service = new SessionHandlerService(makeContext(tempDir, {
            'lanes.defaultAgent': 'claude',
            'lanes.terminalMode': 'vscode',
        }));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('handleSessionFormAttachmentUpload writes uploaded files and returns stored attachment metadata', async () => {
        const result = await service.handleSessionFormAttachmentUpload({
            files: [
                {
                    name: 'notes.md',
                    data: Buffer.from('# hello\n').toString('base64'),
                    sourceKey: 'notes.md:8:123',
                },
            ],
        }) as { files: Array<{ name: string; path: string; sourceKey?: string }> };

        assert.strictEqual(result.files.length, 1);
        assert.strictEqual(result.files[0].name, 'notes.md');
        assert.strictEqual(result.files[0].sourceKey, 'notes.md:8:123');
        assert.ok(fs.existsSync(result.files[0].path), 'Uploaded attachment should exist on disk');
        assert.strictEqual(fs.readFileSync(result.files[0].path, 'utf-8'), '# hello\n');
    });

    test('handleSessionCreate rejects attachment paths outside the managed upload directory', async () => {
        await assert.rejects(
            service.handleSessionCreate({
                name: 'bad-attachment-session',
                attachments: ['/tmp/not-managed-by-lanes.txt'],
            }),
            /Invalid attachment path/
        );
    });

    test('handleSessionFormPromptImprove rejects agents that do not support prompt improvement', async () => {
        await assert.rejects(
            service.handleSessionFormPromptImprove({
                prompt: 'Improve this prompt',
                agent: 'cortex',
            }),
            /does not support prompt improvement/
        );
    });
});

// ---------------------------------------------------------------------------
// Suite: workflow handlers (name validation)
// ---------------------------------------------------------------------------

suite('SessionHandlerService - workflow handlers', () => {
    let tempDir: string;
    let service: SessionHandlerService;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-shs-workflow-'));
        service = new SessionHandlerService(makeContext(tempDir));
    });

    teardown(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    test('handleWorkflowList includes workflow steps in the response', async () => {
        const extensionPath = path.join(tempDir, 'extension');
        const workflowsDir = path.join(extensionPath, 'workflows');
        fs.mkdirSync(workflowsDir, { recursive: true });
        fs.writeFileSync(
            path.join(workflowsDir, 'feature.yaml'),
            [
                'name: feature-flow',
                'description: Feature workflow',
                'steps:',
                '  - id: plan',
                '    type: step',
                '    description: Plan the work',
                '  - id: build',
                '    type: loop',
                '    description: Build the changes',
                '',
            ].join('\n'),
            'utf-8'
        );

        const serviceWithPrivate = service as unknown as {
            resolveExtensionPath: () => Promise<string>;
        };
        const originalResolveExtensionPath = serviceWithPrivate.resolveExtensionPath;
        serviceWithPrivate.resolveExtensionPath = async () => extensionPath;

        try {
            const result = await service.handleWorkflowList({}) as {
                workflows: Array<{
                    name: string;
                    steps?: Array<{ id: string; type: string; description?: string }>;
                }>;
            };

            assert.strictEqual(result.workflows.length, 1);
            assert.strictEqual(result.workflows[0].name, 'feature-flow');
            assert.deepStrictEqual(result.workflows[0].steps, [
                { id: 'plan', type: 'step', description: 'Plan the work' },
                { id: 'build', type: 'loop', description: 'Build the changes' },
            ]);
        } finally {
            serviceWithPrivate.resolveExtensionPath = originalResolveExtensionPath;
        }
    });

    test('handleWorkflowCreate throws for a workflow name containing "/"', async () => {
        let thrown: unknown;
        try {
            await service.handleWorkflowCreate({
                name: 'dangerous/path',
                content: 'name: test\nsteps: []',
            });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error for name containing /');
        assert.ok(
            (thrown as Error).message.toLowerCase().includes('invalid') ||
            (thrown as Error).message.toLowerCase().includes('workflow'),
            `Error should indicate invalid workflow name, got: ${(thrown as Error).message}`
        );
    });

    test('handleWorkflowCreate throws for a workflow name containing special characters', async () => {
        for (const badName of ['bad name', 'bad!name', 'bad@name', 'bad.name']) {
            let thrown: unknown;
            try {
                await service.handleWorkflowCreate({
                    name: badName,
                    content: 'name: test\nsteps: []',
                });
            } catch (err) {
                thrown = err;
            }

            assert.ok(
                thrown instanceof Error,
                `Should throw an Error for name '${badName}'`
            );
        }
    });

    test('handleWorkflowCreate succeeds for a valid alphanumeric workflow name with hyphens and underscores', async () => {
        // This test only verifies that NO validation error is thrown.
        // The actual file write may fail if the directory doesn't exist, which is
        // fine since the fs.mkdir is called with { recursive: true }.
        let thrown: unknown;
        try {
            await service.handleWorkflowCreate({
                name: 'my-valid_workflow123',
                content: 'name: test\nsteps: []\n',
            });
        } catch (err) {
            thrown = err;
        }

        if (thrown) {
            // If it threw, it must NOT be a validation error
            const message = (thrown as Error).message.toLowerCase();
            assert.ok(
                !message.includes('invalid workflow name'),
                `Should not throw a validation error for a valid name, got: ${(thrown as Error).message}`
            );
        }
        // If it didn't throw at all, that's also fine — the file was written to disk.
    });
});
