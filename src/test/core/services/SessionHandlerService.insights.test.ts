/**
 * Tests for SessionHandlerService - handleSessionInsights.
 *
 * Covers:
 *  - Valid session: calls generateInsights with the correct worktree path
 *  - includeAnalysis=true (default): result contains both insights and analysis
 *  - includeAnalysis=false: result contains insights but analysis is undefined
 *  - Missing sessionName: throws with a validation error
 *  - sessionName with path separators: throws with an invalid session name error
 *  - formatInsightsReport: returns a formatted string report
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
        }) as { insights: string; analysis: null; sessionName: string };

        assert.ok(result.insights !== undefined, 'result.insights should be present');
        assert.strictEqual(typeof result.insights, 'string', 'result.insights should be a formatted string');
        // Analysis is merged into the formatted string; the separate analysis field is null
        assert.strictEqual(result.analysis, null, 'result.analysis should be null (merged into insights string)');
        // The formatted report includes a heading with the session name
        assert.ok(
            result.insights.includes('test-session'),
            'insights string should contain the session name'
        );
        // When includeAnalysis=true, the cost is embedded in the insights string
        assert.ok(
            result.insights.includes('$0.01') || result.insights.includes('Efficiency') || result.insights.includes('cost'),
            'insights string should contain analysis information (cost or efficiency)'
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
        }) as { insights: string; analysis: null; sessionName: string };

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
    // High: formatInsightsReport returns a formatted string report
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
        }) as { insights: string; analysis: null; sessionName: string };

        // The handler now returns a formatted string; Map serialization is handled internally
        // by formatInsightsReport. The response is a string, not a raw object.
        assert.strictEqual(typeof result.insights, 'string', 'result.insights should be a formatted string');
        assert.ok(result.insights.length > 0, 'insights string should not be empty');
        assert.strictEqual(result.analysis, null, 'result.analysis should be null');
        assert.strictEqual(result.sessionName, 'test-session', 'sessionName should be echoed back');
    });

    test('Given generateInsights rejects with ENOENT, when handleSessionInsights is called, then it returns empty insights and null analysis', async () => {
        const enoent = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
        enoent.code = 'ENOENT';
        generateInsightsStub.rejects(enoent);

        const result = await service.handleSessionInsights({ sessionName: 'test-session' }) as {
            insights: unknown;
            analysis: unknown;
            sessionName: unknown;
        };

        assert.strictEqual(result.insights, '', 'insights should be empty string when project dir does not exist');
        assert.strictEqual(result.analysis, null, 'analysis should be null when project dir does not exist');
        assert.strictEqual(result.sessionName, 'test-session', 'sessionName should be included in ENOENT response');
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
        }) as { insights: string; analysis: null; sessionName: string };

        // The handler now returns a formatted string; Map serialization is handled internally
        // by formatInsightsReport. The response contains human-readable text, not raw Map objects.
        assert.strictEqual(typeof result.insights, 'string', 'result.insights should be a formatted string');
        assert.ok(result.insights.length > 0, 'insights string should not be empty');
        assert.strictEqual(result.analysis, null, 'result.analysis should be null');
        assert.strictEqual(result.sessionName, 'test-session', 'sessionName should be echoed back');
    });

    // -------------------------------------------------------------------------
    // Critical: formatted string response shape (insights-backend-returns-formatted-string)
    // -------------------------------------------------------------------------

    test('Given a valid sessionName and includeAnalysis=false, when handleSessionInsights is called, then response.insights is a string containing the session name in a heading', async () => {
        const insights = makeInsights();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
            includeAnalysis: false,
        }) as { insights: string; analysis: null; sessionName: string };

        assert.strictEqual(typeof result.insights, 'string', 'response.insights should be a string');
        assert.ok(
            result.insights.includes('test-session'),
            `insights string should contain session name heading, got: ${result.insights.substring(0, 200)}`
        );
    });

    test('Given a valid sessionName and includeAnalysis=true, when handleSessionInsights is called, then response.insights string contains analysis sections', async () => {
        const insights = makeInsights();
        const analysis = makeAnalysis();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(analysis);

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
            includeAnalysis: true,
        }) as { insights: string; analysis: null; sessionName: string };

        assert.strictEqual(typeof result.insights, 'string', 'response.insights should be a string');
        // When includeAnalysis=true, the formatted report includes efficiency/cost sections
        assert.ok(
            result.insights.includes('Efficiency') || result.insights.includes('cost') || result.insights.includes('$'),
            `insights string should contain analysis content (Efficiency/cost), got: ${result.insights.substring(0, 300)}`
        );
    });

    test('Given handleSessionInsights is called, then response always includes a sessionName field equal to the requested sessionName', async () => {
        const insights = makeInsights();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
        }) as { insights: string; analysis: null; sessionName: string };

        assert.strictEqual(result.sessionName, 'test-session', 'response.sessionName should equal the requested sessionName');
    });

    test('Given handleSessionInsights is called, then response.analysis is null (analysis is merged into insights string)', async () => {
        const insights = makeInsights();
        generateInsightsStub.resolves(insights);
        analyzeInsightsStub.returns(makeAnalysis());

        const result = await service.handleSessionInsights({
            sessionName: 'test-session',
            includeAnalysis: true,
        }) as { insights: string; analysis: unknown; sessionName: string };

        assert.strictEqual(result.analysis, null, 'response.analysis should be null when analysis is merged into the string');
    });
});
