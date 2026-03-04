/**
 * Tests for SessionHandlerService - handleSessionInsights.
 *
 * Covers:
 *  - Valid session: calls generateInsights with the correct worktree path
 *  - includeAnalysis=true (default): result contains both insights and analysis
 *  - includeAnalysis=false: result contains insights but analysis is undefined
 *  - Missing sessionName: throws with a validation error
 *  - sessionName with path separators: throws with an invalid session name error
 *  - serializeInsights: converts all Map fields to plain objects
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import sinon from 'sinon';
import {
    SessionHandlerService,
} from '../../../core/services/SessionHandlerService';
import type {
    IHandlerContext,
    ISimpleConfigStore,
    INotificationEmitter,
    IFileWatchManager,
} from '../../../core/interfaces/IHandlerContext';
import * as InsightsService from '../../../core/services/InsightsService';
import * as InsightsAnalyzer from '../../../core/services/InsightsAnalyzer';
import type { SessionInsights } from '../../../core/services/InsightsService';
import type { AnalysisResult } from '../../../core/services/InsightsAnalyzer';

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
    sessionStatusChanged(
        _sessionName: string,
        _status: { status: string; timestamp?: string; message?: string }
    ): void {}

    fileChanged(_filePath: string, _eventType: 'created' | 'changed' | 'deleted'): void {}

    sessionCreated(_sessionName: string, _worktreePath: string): void {}

    sessionDeleted(_sessionName: string): void {}
}

class StubFileWatchManager implements IFileWatchManager {
    private nextId = 0;

    watch(_basePath: string, _pattern: string): string {
        return `watch-${this.nextId++}`;
    }

    async unwatch(_watchId: string): Promise<boolean> {
        return true;
    }

    dispose(): void {}
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

/** Build a minimal SessionInsights with Map fields populated. */
function makeInsights(overrides: Partial<SessionInsights> = {}): SessionInsights {
    const toolUses = new Map<string, number>([['Read', 5], ['Edit', 2]]);
    const skillUses = new Map<string, number>([['search', 3]]);
    const mcpUses = new Map<string, number>([['workflow_advance', 1]]);
    const fileOperations = new Map<string, { reads: number; edits: number; writes: number }>([
        ['src/foo.ts', { reads: 2, edits: 1, writes: 0 }],
    ]);

    return {
        sessionCount: 1,
        conversations: [
            {
                sessionId: 'test-session-id',
                firstTimestamp: '2024-01-01T00:00:00.000Z',
                lastTimestamp: '2024-01-01T01:00:00.000Z',
                userMessageCount: 3,
                assistantTurnCount: 4,
                toolUses: new Map<string, number>([['Read', 5]]),
                skillUses: new Map<string, number>([['search', 3]]),
                mcpUses: new Map<string, number>([['workflow_advance', 1]]),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 200,
                totalDurationMs: 30000,
                userPromptPreviews: ['Please implement X'],
                model: 'claude-sonnet-4',
                toolErrors: [],
                toolSequence: ['Read', 'Edit'],
                fileOperations: [{ file: 'src/foo.ts', operation: 'Read', count: 2 }],
                subAgentDelegations: [],
                costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 },
            },
        ],
        totalUserMessages: 3,
        totalAssistantTurns: 4,
        totalToolUses: toolUses,
        totalSkillUses: skillUses,
        totalMcpUses: mcpUses,
        totalInputTokens: 1000,
        totalOutputTokens: 500,
        totalCacheReadTokens: 200,
        totalDurationMs: 30000,
        earliestTimestamp: '2024-01-01T00:00:00.000Z',
        latestTimestamp: '2024-01-01T01:00:00.000Z',
        totalToolErrors: [],
        totalFileOperations: fileOperations,
        totalSubAgentDelegations: [],
        ...overrides,
    };
}

/** Build a minimal AnalysisResult for stubbing. */
function makeAnalysis(): AnalysisResult {
    return {
        efficiency: {
            totalCost: 0.0105,
            inputCost: 0.003,
            outputCost: 0.0075,
            cacheHitRate: 16.67,
            tokensPerUserMessage: 500,
            outputInputRatio: 0.5,
            averageTurnDurationMs: 7500,
            averageTurnsPerConversation: 4,
            averageUserMessagesPerConversation: 3,
        },
        patterns: {
            topToolChains: [],
            fileHotspots: [],
            delegationSummary: [],
            conversationComplexity: 'simple',
            readEditRatio: 2.5,
        },
        errorAnalysis: {
            totalErrors: 0,
            errorRate: 0,
            errorsByTool: [],
            mostFailedTool: null,
        },
        recommendations: [],
    };
}

// ---------------------------------------------------------------------------
// Suite: SessionHandlerService - handleSessionInsights
// ---------------------------------------------------------------------------

suite('SessionHandlerService - handleSessionInsights', () => {
    let tempDir: string;
    let service: SessionHandlerService;
    let generateInsightsStub: sinon.SinonStub;
    let analyzeInsightsStub: sinon.SinonStub;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-insights-test-'));
        const worktreesDir = path.join(tempDir, '.worktrees');
        fs.mkdirSync(worktreesDir, { recursive: true });
        const sessionDir = path.join(worktreesDir, 'test-session');
        fs.mkdirSync(sessionDir, { recursive: true });

        service = new SessionHandlerService(makeContext(tempDir));

        generateInsightsStub = sinon.stub(InsightsService, 'generateInsights');
        analyzeInsightsStub = sinon.stub(InsightsAnalyzer, 'analyzeInsights');
    });

    teardown(() => {
        sinon.restore();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // -------------------------------------------------------------------------
    // Critical: valid session name - calls generateInsights with correct path
    // -------------------------------------------------------------------------

    test('Given a valid sessionName param, when handleSessionInsights is called, then it calls generateInsights with the correct worktree path', async () => {
        const insights = makeInsights();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        await service.handleSessionInsights({ sessionName: 'test-session' });

        assert.ok(generateInsightsStub.calledOnce, 'generateInsights should be called exactly once');

        const calledPath: string = generateInsightsStub.firstCall.args[0] as string;
        assert.ok(
            calledPath.endsWith(path.join('.worktrees', 'test-session')),
            `Expected worktree path to end with '.worktrees/test-session', got: ${calledPath}`
        );
    });

    // -------------------------------------------------------------------------
    // Critical: includeAnalysis=true (default) - result has both insights and analysis
    // -------------------------------------------------------------------------

    test('Given includeAnalysis=true (default), when handleSessionInsights resolves, then the result contains both insights and analysis fields', async () => {
        const insights = makeInsights();
        const analysis = makeAnalysis();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(analysis);

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
            // includeAnalysis defaults to true
        }) as { insights: Record<string, unknown>; analysis: AnalysisResult | undefined };

        assert.ok(result.insights !== undefined, 'result.insights should be present');
        assert.ok(result.analysis !== undefined, 'result.analysis should be present when includeAnalysis=true');
        assert.strictEqual(
            result.analysis?.efficiency?.totalCost,
            analysis.efficiency.totalCost,
            'analysis should contain the analyzeInsights return value'
        );
    });

    // -------------------------------------------------------------------------
    // Critical: includeAnalysis=false - result has insights but no analysis
    // -------------------------------------------------------------------------

    test('Given includeAnalysis=false, when handleSessionInsights resolves, then the result contains insights but analysis is undefined', async () => {
        const insights = makeInsights();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
            includeAnalysis: false,
        }) as { insights: Record<string, unknown>; analysis: AnalysisResult | undefined };

        assert.ok(result.insights !== undefined, 'result.insights should be present');
        assert.strictEqual(result.analysis, null, 'result.analysis should be null when includeAnalysis=false');

        assert.ok(
            analyzeInsightsStub.notCalled,
            'analyzeInsights should NOT be called when includeAnalysis=false'
        );
    });

    // -------------------------------------------------------------------------
    // Critical: missing sessionName throws validation error
    // -------------------------------------------------------------------------

    test('Given no sessionName param, when handleSessionInsights is called, then it throws with a validation error', async () => {
        let thrown: unknown;
        try {
            await service.handleSessionInsights({});
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should throw an Error when sessionName is missing');
        const message = (thrown as Error).message.toLowerCase();
        assert.ok(
            message.includes('required') || message.includes('session') || message.includes('name'),
            `Error message should indicate validation failure, got: ${(thrown as Error).message}`
        );
    });

    // -------------------------------------------------------------------------
    // Critical: sessionName with path separators throws invalid session name error
    // -------------------------------------------------------------------------

    test('Given a sessionName with path separators, when handleSessionInsights is called, then it throws with an invalid session name error', async () => {
        const invalidNames = ['../../etc/passwd', 'feat/branch', 'feat\\branch'];

        for (const name of invalidNames) {
            let thrown: unknown;
            try {
                await service.handleSessionInsights({ sessionName: name });
            } catch (err) {
                thrown = err;
            }

            assert.ok(
                thrown instanceof Error,
                `Should throw an Error for session name '${name}'`
            );
            const message = (thrown as Error).message.toLowerCase();
            assert.ok(
                message.includes('invalid') || message.includes('traversal') || message.includes('separator') || message.includes('..'),
                `Error message should indicate invalid session name for '${name}', got: ${(thrown as Error).message}`
            );
        }
    });

    // -------------------------------------------------------------------------
    // High: serializeInsights converts all Map fields to plain objects
    // -------------------------------------------------------------------------

    test('Given insights with Map fields (totalToolUses, totalSkillUses, totalMcpUses, totalFileOperations), when handleSessionInsights is called, then returned insights object has plain object keys instead of Map instances', async () => {
        const insights = makeInsights({
            totalToolUses: new Map<string, number>([['Read', 10], ['Edit', 3]]),
            totalSkillUses: new Map<string, number>([['grep', 2]]),
            totalMcpUses: new Map<string, number>([['workflow_status', 4]]),
            totalFileOperations: new Map<string, { reads: number; edits: number; writes: number }>([
                ['src/index.ts', { reads: 3, edits: 2, writes: 1 }],
            ]),
        });

        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
        }) as { insights: Record<string, unknown>; analysis: unknown };

        const serialized = result.insights;

        // totalToolUses must be a plain object, not a Map
        assert.ok(
            !(serialized.totalToolUses instanceof Map),
            'totalToolUses should not be a Map instance'
        );
        assert.strictEqual(
            typeof serialized.totalToolUses,
            'object',
            'totalToolUses should be a plain object'
        );
        assert.strictEqual(
            (serialized.totalToolUses as Record<string, number>)['Read'],
            10,
            'totalToolUses.Read should equal 10'
        );
        assert.strictEqual(
            (serialized.totalToolUses as Record<string, number>)['Edit'],
            3,
            'totalToolUses.Edit should equal 3'
        );

        // totalSkillUses must be a plain object
        assert.ok(
            !(serialized.totalSkillUses instanceof Map),
            'totalSkillUses should not be a Map instance'
        );
        assert.strictEqual(
            (serialized.totalSkillUses as Record<string, number>)['grep'],
            2,
            'totalSkillUses.grep should equal 2'
        );

        // totalMcpUses must be a plain object
        assert.ok(
            !(serialized.totalMcpUses instanceof Map),
            'totalMcpUses should not be a Map instance'
        );
        assert.strictEqual(
            (serialized.totalMcpUses as Record<string, number>)['workflow_status'],
            4,
            'totalMcpUses.workflow_status should equal 4'
        );

        // totalFileOperations must be a plain object
        assert.ok(
            !(serialized.totalFileOperations instanceof Map),
            'totalFileOperations should not be a Map instance'
        );
        const fileOps = serialized.totalFileOperations as Record<string, { reads: number; edits: number; writes: number }>;
        assert.ok(fileOps['src/index.ts'], 'totalFileOperations should have src/index.ts key');
        assert.strictEqual(fileOps['src/index.ts'].reads, 3);
        assert.strictEqual(fileOps['src/index.ts'].edits, 2);
        assert.strictEqual(fileOps['src/index.ts'].writes, 1);
    });

    test('Given generateInsights rejects with ENOENT, when handleSessionInsights is called, then it returns null insights and null analysis', async () => {
        const enoent = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        enoent.code = 'ENOENT';
        generateInsightsStub.rejects(enoent);

        const result = await service.handleSessionInsights({ sessionName: 'test-session' }) as {
            insights: unknown;
            analysis: unknown;
        };

        assert.strictEqual(result.insights, null, 'insights should be null when project dir does not exist');
        assert.strictEqual(result.analysis, null, 'analysis should be null when project dir does not exist');
    });

    test('Given generateInsights rejects with a non-ENOENT error, when handleSessionInsights is called, then it propagates the error', async () => {
        generateInsightsStub.rejects(new Error('Unexpected failure'));

        let thrown: unknown;
        try {
            await service.handleSessionInsights({ sessionName: 'test-session' });
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown instanceof Error, 'Should propagate the error');
        assert.ok(
            (thrown as Error).message.includes('Unexpected failure'),
            'Should preserve the original error message'
        );
    });

    test('Given insights with conversations containing toolUses/skillUses/mcpUses Maps, when handleSessionInsights is called, then each conversation in the result has plain object keys', async () => {
        const insights = makeInsights({
            conversations: [
                {
                    sessionId: 'conv-1',
                    firstTimestamp: '2024-01-01T00:00:00.000Z',
                    lastTimestamp: '2024-01-01T01:00:00.000Z',
                    userMessageCount: 2,
                    assistantTurnCount: 3,
                    toolUses: new Map<string, number>([['Read', 7], ['Bash', 2]]),
                    skillUses: new Map<string, number>([['code-search', 1]]),
                    mcpUses: new Map<string, number>([['workflow_advance', 2]]),
                    totalInputTokens: 2000,
                    totalOutputTokens: 800,
                    totalCacheReadTokens: 400,
                    totalDurationMs: 60000,
                    userPromptPreviews: ['Do X'],
                    model: 'claude-sonnet-4',
                    toolErrors: [],
                    toolSequence: ['Read', 'Bash'],
                    fileOperations: [],
                    subAgentDelegations: [],
                    costEstimate: { inputCost: 0.006, outputCost: 0.012, totalCost: 0.018 },
                },
            ],
        });

        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
        }) as { insights: Record<string, unknown>; analysis: unknown };

        const serialized = result.insights;
        const conversations = serialized.conversations as Array<Record<string, unknown>>;

        assert.ok(Array.isArray(conversations), 'conversations should be an array');
        assert.strictEqual(conversations.length, 1, 'Should have 1 conversation');

        const conv = conversations[0];

        // toolUses in conversation must be a plain object, not a Map
        assert.ok(
            !(conv.toolUses instanceof Map),
            'conversation.toolUses should not be a Map instance'
        );
        assert.strictEqual(
            typeof conv.toolUses,
            'object',
            'conversation.toolUses should be a plain object'
        );
        assert.strictEqual(
            (conv.toolUses as Record<string, number>)['Read'],
            7,
            'conversation.toolUses.Read should equal 7'
        );
        assert.strictEqual(
            (conv.toolUses as Record<string, number>)['Bash'],
            2,
            'conversation.toolUses.Bash should equal 2'
        );

        // skillUses in conversation must be a plain object
        assert.ok(
            !(conv.skillUses instanceof Map),
            'conversation.skillUses should not be a Map instance'
        );
        assert.strictEqual(
            (conv.skillUses as Record<string, number>)['code-search'],
            1,
            'conversation.skillUses.code-search should equal 1'
        );

        // mcpUses in conversation must be a plain object
        assert.ok(
            !(conv.mcpUses instanceof Map),
            'conversation.mcpUses should not be a Map instance'
        );
        assert.strictEqual(
            (conv.mcpUses as Record<string, number>)['workflow_advance'],
            2,
            'conversation.mcpUses.workflow_advance should equal 2'
        );
    });
});
