import * as assert from 'assert';
import { analyzeInsights } from '../../services/InsightsAnalyzer';
import { SessionInsights } from '../../services/InsightsService';

suite('InsightsAnalyzer', () => {
    suite('Efficiency Metrics Computation', () => {
        test('should compute total cost by summing conversation costs', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 2000,
                        totalOutputTokens: 1000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 2000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.006, outputCost: 0.015, totalCost: 0.021 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 2,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 3000,
                totalOutputTokens: 1500,
                totalCacheReadTokens: 0,
                totalDurationMs: 3000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.ok(Math.abs(result.efficiency.totalCost - 0.0315) < 1e-10);
            assert.ok(Math.abs(result.efficiency.inputCost - 0.009) < 1e-10);
            assert.ok(Math.abs(result.efficiency.outputCost - 0.0225) < 1e-10);
        });

        test('should compute cache hit rate as percentage', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 8000,
                        totalOutputTokens: 1000,
                        totalCacheReadTokens: 2000,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.024, outputCost: 0.015, totalCost: 0.039 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 8000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 2000,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // Cache hit rate = cache_read / (cache_read + input) * 100 = 2000 / (2000 + 8000) * 100 = 20%
            assert.strictEqual(result.efficiency.cacheHitRate, 20);
        });

        test('should handle division by zero for cache hit rate', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 0,
                        totalOutputTokens: 0,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0, outputCost: 0, totalCost: 0 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.efficiency.cacheHitRate, 0);
        });

        test('should compute tokens per user message', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 5,
                        assistantTurnCount: 5,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 10000,
                        totalOutputTokens: 5000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 5000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.03, outputCost: 0.075, totalCost: 0.105 }
                    }
                ],
                totalUserMessages: 5,
                totalAssistantTurns: 5,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 10000,
                totalOutputTokens: 5000,
                totalCacheReadTokens: 0,
                totalDurationMs: 5000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // (10000 + 5000) / 5 = 3000
            assert.strictEqual(result.efficiency.tokensPerUserMessage, 3000);
        });

        test('should handle division by zero for tokens per user message', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 0,
                        assistantTurnCount: 0,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 10000,
                        totalOutputTokens: 5000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 0,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.03, outputCost: 0.075, totalCost: 0.105 }
                    }
                ],
                totalUserMessages: 0,
                totalAssistantTurns: 0,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 10000,
                totalOutputTokens: 5000,
                totalCacheReadTokens: 0,
                totalDurationMs: 0,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.efficiency.tokensPerUserMessage, 0);
        });

        test('should compute output/input ratio', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 10000,
                        totalOutputTokens: 15000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.03, outputCost: 0.225, totalCost: 0.255 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 10000,
                totalOutputTokens: 15000,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // 15000 / 10000 = 1.5
            assert.strictEqual(result.efficiency.outputInputRatio, 1.5);
        });

        test('should handle division by zero for output/input ratio', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 0,
                        totalOutputTokens: 5000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0, outputCost: 0.075, totalCost: 0.075 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 0,
                totalOutputTokens: 5000,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.efficiency.outputInputRatio, 0);
        });

        test('should compute average turn duration', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 5,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 10000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 5,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 10000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // 10000 / 5 = 2000
            assert.strictEqual(result.efficiency.averageTurnDurationMs, 2000);
        });

        test('should compute average turns per conversation', () => {
            const insights: SessionInsights = {
                sessionCount: 3,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 10,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 5000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 20,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 2000,
                        totalOutputTokens: 1000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 10000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.006, outputCost: 0.015, totalCost: 0.021 }
                    },
                    {
                        sessionId: 'conv3',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 30,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 3000,
                        totalOutputTokens: 1500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 15000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.009, outputCost: 0.0225, totalCost: 0.0315 }
                    }
                ],
                totalUserMessages: 3,
                totalAssistantTurns: 60,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 6000,
                totalOutputTokens: 3000,
                totalCacheReadTokens: 0,
                totalDurationMs: 30000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // 60 / 3 = 20
            assert.strictEqual(result.efficiency.averageTurnsPerConversation, 20);
        });

        test('should compute average user messages per conversation', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 3,
                        assistantTurnCount: 3,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 7,
                        assistantTurnCount: 7,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 2000,
                        totalOutputTokens: 1000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 2000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.006, outputCost: 0.015, totalCost: 0.021 }
                    }
                ],
                totalUserMessages: 10,
                totalAssistantTurns: 10,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 3000,
                totalOutputTokens: 1500,
                totalCacheReadTokens: 0,
                totalDurationMs: 3000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // 10 / 2 = 5
            assert.strictEqual(result.efficiency.averageUserMessagesPerConversation, 5);
        });
    });

    suite('Tool Chain Extraction', () => {
        test('should extract bigrams that occur at least twice', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: ['Read', 'Edit', 'Bash'],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: ['Read', 'Edit', 'Write'],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 2,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 2000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // ['Read', 'Edit'] appears twice
            const readEdit = result.patterns.topToolChains.find(
                chain => JSON.stringify(chain.sequence) === JSON.stringify(['Read', 'Edit'])
            );
            assert.ok(readEdit, 'Should find Read->Edit chain');
            assert.strictEqual(readEdit!.count, 2);
        });

        test('should extract trigrams that occur at least twice', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: ['Glob', 'Read', 'Edit', 'Bash'],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: ['Glob', 'Read', 'Edit', 'Write'],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 2,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 2000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // ['Glob', 'Read', 'Edit'] appears twice
            const globReadEdit = result.patterns.topToolChains.find(
                chain => JSON.stringify(chain.sequence) === JSON.stringify(['Glob', 'Read', 'Edit'])
            );
            assert.ok(globReadEdit, 'Should find Glob->Read->Edit chain');
            assert.strictEqual(globReadEdit!.count, 2);
        });

        test('should filter out sequences with less than 2 occurrences', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: ['Read', 'Edit'],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: ['Write', 'Bash'],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 2,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 2000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // No sequences occur twice
            assert.strictEqual(result.patterns.topToolChains.length, 0);
        });

        test('should limit to top 10 tool chains', () => {
            const conversations = [];
            // Create 15 different bigrams, each occurring 2+ times
            for (let i = 0; i < 15; i++) {
                conversations.push({
                    sessionId: `conv${i}a`,
                    firstTimestamp: null,
                    lastTimestamp: null,
                    userMessageCount: 1,
                    assistantTurnCount: 1,
                    toolUses: new Map(),
                    skillUses: new Map(),
                    mcpUses: new Map(),
                    totalInputTokens: 1000,
                    totalOutputTokens: 500,
                    totalCacheReadTokens: 0,
                    totalDurationMs: 1000,
                    userPromptPreviews: [],
                    model: 'claude-sonnet-4',
                    toolErrors: [],
                    toolSequence: [`Tool${i}`, `ToolNext${i}`],
                    fileOperations: [],
                    subAgentDelegations: [],
                    costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                });
                conversations.push({
                    sessionId: `conv${i}b`,
                    firstTimestamp: null,
                    lastTimestamp: null,
                    userMessageCount: 1,
                    assistantTurnCount: 1,
                    toolUses: new Map(),
                    skillUses: new Map(),
                    mcpUses: new Map(),
                    totalInputTokens: 1000,
                    totalOutputTokens: 500,
                    totalCacheReadTokens: 0,
                    totalDurationMs: 1000,
                    userPromptPreviews: [],
                    model: 'claude-sonnet-4',
                    toolErrors: [],
                    toolSequence: [`Tool${i}`, `ToolNext${i}`],
                    fileOperations: [],
                    subAgentDelegations: [],
                    costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                });
            }

            const insights: SessionInsights = {
                sessionCount: 30,
                conversations,
                totalUserMessages: 30,
                totalAssistantTurns: 30,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 30000,
                totalOutputTokens: 15000,
                totalCacheReadTokens: 0,
                totalDurationMs: 30000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.patterns.topToolChains.length, 10);
        });
    });

    suite('File Hotspot Detection', () => {
        test('should aggregate file operations and sort by total count', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map([
                    ['/file1.ts', { reads: 10, edits: 5, writes: 2 }],
                    ['/file2.ts', { reads: 2, edits: 1, writes: 0 }],
                    ['/file3.ts', { reads: 15, edits: 10, writes: 5 }]
                ]),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.patterns.fileHotspots.length, 3);
            // file3 has 30 total operations, file1 has 17, file2 has 3
            assert.strictEqual(result.patterns.fileHotspots[0].file, '/file3.ts');
            assert.strictEqual(result.patterns.fileHotspots[0].totalOperations, 30);
            assert.strictEqual(result.patterns.fileHotspots[0].reads, 15);
            assert.strictEqual(result.patterns.fileHotspots[0].edits, 10);
            assert.strictEqual(result.patterns.fileHotspots[0].writes, 5);

            assert.strictEqual(result.patterns.fileHotspots[1].file, '/file1.ts');
            assert.strictEqual(result.patterns.fileHotspots[1].totalOperations, 17);
        });

        test('should limit to top 10 file hotspots', () => {
            const fileOps = new Map();
            for (let i = 0; i < 15; i++) {
                fileOps.set(`/file${i}.ts`, { reads: i + 1, edits: 0, writes: 0 });
            }

            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: fileOps,
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.patterns.fileHotspots.length, 10);
            // Should be sorted descending, so file14 (15 reads) should be first
            assert.strictEqual(result.patterns.fileHotspots[0].file, '/file14.ts');
        });
    });

    suite('Conversation Complexity Classification', () => {
        test('should classify as simple when average turns < 10', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 5,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 7,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 12, // avg = 6
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 2000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.patterns.conversationComplexity, 'simple');
        });

        test('should classify as moderate when average turns between 10 and 30', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 15,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 25,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 40, // avg = 20
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 2000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.patterns.conversationComplexity, 'moderate');
        });

        test('should classify as complex when average turns > 30', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 40,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 50,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 90, // avg = 45
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 2000,
                totalOutputTokens: 1000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.patterns.conversationComplexity, 'complex');
        });
    });

    suite('Error Analysis', () => {
        test('should compute error rate as percentage of total tool calls', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([
                    ['Read', 80],
                    ['Edit', 15],
                    ['Write', 5]
                ]), // Total = 100
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [
                    { tool: 'Read', error: 'Error 1' },
                    { tool: 'Read', error: 'Error 2' },
                    { tool: 'Write', error: 'Error 3' }
                ], // 3 errors
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // 3 errors / 100 total calls = 3%
            assert.strictEqual(result.errorAnalysis.errorRate, 3);
            assert.strictEqual(result.errorAnalysis.totalErrors, 3);
        });

        test('should group errors by tool with percentages', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([
                    ['Read', 50],
                    ['Edit', 30],
                    ['Write', 20]
                ]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [
                    { tool: 'Read', error: 'Error 1' },
                    { tool: 'Read', error: 'Error 2' },
                    { tool: 'Read', error: 'Error 3' },
                    { tool: 'Edit', error: 'Error 4' },
                    { tool: 'Write', error: 'Error 5' }
                ],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.errorAnalysis.errorsByTool.length, 3);

            // Should be sorted by count descending
            assert.strictEqual(result.errorAnalysis.errorsByTool[0].tool, 'Read');
            assert.strictEqual(result.errorAnalysis.errorsByTool[0].count, 3);
            assert.strictEqual(result.errorAnalysis.errorsByTool[0].percentage, 60); // 3/5 * 100

            assert.strictEqual(result.errorAnalysis.errorsByTool[1].tool, 'Edit');
            assert.strictEqual(result.errorAnalysis.errorsByTool[1].count, 1);
            assert.strictEqual(result.errorAnalysis.errorsByTool[1].percentage, 20); // 1/5 * 100

            assert.strictEqual(result.errorAnalysis.errorsByTool[2].tool, 'Write');
            assert.strictEqual(result.errorAnalysis.errorsByTool[2].count, 1);
            assert.strictEqual(result.errorAnalysis.errorsByTool[2].percentage, 20);
        });

        test('should identify most failed tool', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([['Bash', 100]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [
                    { tool: 'Bash', error: 'Error 1' },
                    { tool: 'Bash', error: 'Error 2' },
                    { tool: 'Bash', error: 'Error 3' }
                ],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.errorAnalysis.mostFailedTool, 'Bash');
        });

        test('should return null for most failed tool when no errors', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([['Read', 10]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            assert.strictEqual(result.errorAnalysis.mostFailedTool, null);
            assert.strictEqual(result.errorAnalysis.errorRate, 0);
        });
    });

    suite('Recommendation Generation', () => {
        test('should warn about low cache utilization when rate < 20% and tokens > 100k', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 150000,
                        totalOutputTokens: 50000,
                        totalCacheReadTokens: 10000,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.45, outputCost: 0.75, totalCost: 1.2 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([['Read', 10]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 150000,
                totalOutputTokens: 50000,
                totalCacheReadTokens: 10000, // 10k / (10k + 150k) = 6.25%
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            const lowCacheWarning = result.recommendations.find(
                r => r.title === 'Low cache utilization'
            );
            assert.ok(lowCacheWarning, 'Should have low cache warning');
            assert.strictEqual(lowCacheWarning!.severity, 'warning');
            assert.strictEqual(lowCacheWarning!.category, 'efficiency');
        });

        test('should suggest about moderate cache utilization when rate between 20-50%', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 100000,
                        totalOutputTokens: 50000,
                        totalCacheReadTokens: 30000,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.3, outputCost: 0.75, totalCost: 1.05 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([['Read', 10]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 100000,
                totalOutputTokens: 50000,
                totalCacheReadTokens: 30000, // 30k / (30k + 100k) = 23.08%
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            const moderateCacheSuggestion = result.recommendations.find(
                r => r.title === 'Moderate cache utilization'
            );
            assert.ok(moderateCacheSuggestion, 'Should have moderate cache suggestion');
            assert.strictEqual(moderateCacheSuggestion!.severity, 'suggestion');
        });

        test('should warn about long conversations when avg turns > 30', () => {
            const insights: SessionInsights = {
                sessionCount: 2,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 35,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 10000,
                        totalOutputTokens: 5000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.03, outputCost: 0.075, totalCost: 0.105 }
                    },
                    {
                        sessionId: 'conv2',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 35,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 10000,
                        totalOutputTokens: 5000,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.03, outputCost: 0.075, totalCost: 0.105 }
                    }
                ],
                totalUserMessages: 2,
                totalAssistantTurns: 70, // avg = 35
                totalToolUses: new Map([['Read', 10]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 20000,
                totalOutputTokens: 10000,
                totalCacheReadTokens: 0,
                totalDurationMs: 2000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            const longConvWarning = result.recommendations.find(
                r => r.title === 'Long conversations detected'
            );
            assert.ok(longConvWarning, 'Should have long conversation warning');
            assert.strictEqual(longConvWarning!.severity, 'warning');
            assert.strictEqual(longConvWarning!.category, 'patterns');
        });

        test('should warn about high error rate when > 10%', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([['Read', 100]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: Array(12).fill({ tool: 'Read', error: 'Error' }), // 12 errors out of 100 = 12%
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            const highErrorWarning = result.recommendations.find(
                r => r.title === 'High tool error rate'
            );
            assert.ok(highErrorWarning, 'Should have high error rate warning');
            assert.strictEqual(highErrorWarning!.severity, 'warning');
            assert.strictEqual(highErrorWarning!.category, 'errors');
        });

        test('should recommend clean execution when no errors', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 1,
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 1000,
                        totalOutputTokens: 500,
                        totalCacheReadTokens: 0,
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.003, outputCost: 0.0075, totalCost: 0.0105 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 1,
                totalToolUses: new Map([['Read', 10]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCacheReadTokens: 0,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            const cleanExecution = result.recommendations.find(
                r => r.title === 'Clean execution'
            );
            assert.ok(cleanExecution, 'Should have clean execution info');
            assert.strictEqual(cleanExecution!.severity, 'info');
            assert.strictEqual(cleanExecution!.category, 'errors');
        });

        test('should sort recommendations by severity (warning > suggestion > info)', () => {
            const insights: SessionInsights = {
                sessionCount: 1,
                conversations: [
                    {
                        sessionId: 'conv1',
                        firstTimestamp: null,
                        lastTimestamp: null,
                        userMessageCount: 1,
                        assistantTurnCount: 35, // Long conversation (warning)
                        toolUses: new Map(),
                        skillUses: new Map(),
                        mcpUses: new Map(),
                        totalInputTokens: 150000, // Low cache (warning)
                        totalOutputTokens: 50000,
                        totalCacheReadTokens: 5000, // 3.1% cache rate
                        totalDurationMs: 1000,
                        userPromptPreviews: [],
                        model: 'claude-sonnet-4',
                        toolErrors: [],
                        toolSequence: [],
                        fileOperations: [],
                        subAgentDelegations: [],
                        costEstimate: { inputCost: 0.45, outputCost: 0.75, totalCost: 1.2 }
                    }
                ],
                totalUserMessages: 1,
                totalAssistantTurns: 35,
                totalToolUses: new Map([['Read', 10]]),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 150000,
                totalOutputTokens: 50000,
                totalCacheReadTokens: 5000,
                totalDurationMs: 1000,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // First recommendations should be warnings
            assert.strictEqual(result.recommendations[0].severity, 'warning');

            // Find the last warning
            let lastWarningIndex = -1;
            for (let i = 0; i < result.recommendations.length; i++) {
                if (result.recommendations[i].severity === 'warning') {
                    lastWarningIndex = i;
                }
            }

            // All suggestions should come after warnings
            for (let i = lastWarningIndex + 1; i < result.recommendations.length; i++) {
                if (result.recommendations[i].severity === 'suggestion') {
                    // Check that no warnings come after this suggestion
                    for (let j = i + 1; j < result.recommendations.length; j++) {
                        assert.notStrictEqual(result.recommendations[j].severity, 'warning');
                    }
                }
            }
        });
    });

    suite('Edge Cases', () => {
        test('should handle empty insights (no conversations)', () => {
            const insights: SessionInsights = {
                sessionCount: 0,
                conversations: [],
                totalUserMessages: 0,
                totalAssistantTurns: 0,
                totalToolUses: new Map(),
                totalSkillUses: new Map(),
                totalMcpUses: new Map(),
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCacheReadTokens: 0,
                totalDurationMs: 0,
                earliestTimestamp: null,
                latestTimestamp: null,
                totalToolErrors: [],
                totalFileOperations: new Map(),
                totalSubAgentDelegations: []
            };

            const result = analyzeInsights(insights);

            // Should not crash and return valid structure
            assert.ok(result.efficiency);
            assert.ok(result.patterns);
            assert.ok(result.errorAnalysis);
            assert.ok(Array.isArray(result.recommendations));

            // All metrics should be zero or empty
            assert.strictEqual(result.efficiency.totalCost, 0);
            assert.strictEqual(result.efficiency.cacheHitRate, 0);
            assert.strictEqual(result.efficiency.tokensPerUserMessage, 0);
            assert.strictEqual(result.efficiency.outputInputRatio, 0);
            assert.strictEqual(result.efficiency.averageTurnDurationMs, 0);
            assert.strictEqual(result.efficiency.averageTurnsPerConversation, 0);

            assert.strictEqual(result.patterns.topToolChains.length, 0);
            assert.strictEqual(result.patterns.fileHotspots.length, 0);
            assert.strictEqual(result.patterns.conversationComplexity, 'simple');

            assert.strictEqual(result.errorAnalysis.totalErrors, 0);
            assert.strictEqual(result.errorAnalysis.errorRate, 0);
            assert.strictEqual(result.errorAnalysis.mostFailedTool, null);
        });
    });
});
