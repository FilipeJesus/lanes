import { SessionInsights } from './InsightsService';

export interface AnalysisResult {
    efficiency: EfficiencyMetrics;
    patterns: WorkflowPatterns;
    errorAnalysis: ErrorAnalysis;
    recommendations: Recommendation[];
}

export interface EfficiencyMetrics {
    totalCost: number;           // Sum of all conversation cost estimates
    inputCost: number;
    outputCost: number;
    cacheHitRate: number;        // cache_read / (cache_read + input) as percentage (0-100)
    tokensPerUserMessage: number; // total tokens / user messages
    outputInputRatio: number;    // output / input tokens
    averageTurnDurationMs: number; // totalDuration / assistantTurns
    averageTurnsPerConversation: number;
    averageUserMessagesPerConversation: number;
}

export interface ToolChain {
    sequence: string[];          // e.g. ['Read', 'Edit', 'Bash']
    count: number;               // how many times this sequence appeared
}

export interface FileHotspot {
    file: string;
    totalOperations: number;     // reads + edits + writes
    reads: number;
    edits: number;
    writes: number;
}

export interface WorkflowPatterns {
    topToolChains: ToolChain[];     // Most common 2-3 tool sequences (top 10)
    fileHotspots: FileHotspot[];    // Files with most operations (top 10)
    delegationSummary: { type: string; count: number; percentage: number }[];
    conversationComplexity: 'simple' | 'moderate' | 'complex'; // based on avg turns
    readEditRatio: number;          // Read count / Edit count — high means lots of exploration
}

export interface ErrorAnalysis {
    totalErrors: number;
    errorRate: number;              // errors / total tool calls as percentage
    errorsByTool: { tool: string; count: number; percentage: number }[];  // sorted by count desc
    mostFailedTool: string | null;
}

export type RecommendationSeverity = 'info' | 'suggestion' | 'warning';

export interface Recommendation {
    severity: RecommendationSeverity;
    category: string;              // e.g. 'efficiency', 'patterns', 'errors'
    title: string;                 // Short summary
    detail: string;                // Full explanation with data
}

export function analyzeInsights(insights: SessionInsights): AnalysisResult {
    const efficiency = computeEfficiency(insights);
    const patterns = detectPatterns(insights);
    const errorAnalysis = analyzeErrors(insights);
    const recommendations = generateRecommendations(efficiency, patterns, errorAnalysis, insights);

    return {
        efficiency,
        patterns,
        errorAnalysis,
        recommendations
    };
}

function computeEfficiency(insights: SessionInsights): EfficiencyMetrics {
    // Sum cost estimates from all conversations
    let totalCost = 0;
    let inputCost = 0;
    let outputCost = 0;

    for (const conv of insights.conversations) {
        totalCost += conv.costEstimate.totalCost;
        inputCost += conv.costEstimate.inputCost;
        outputCost += conv.costEstimate.outputCost;
    }

    // Cache hit rate
    const totalTokensForCache = insights.totalCacheReadTokens + insights.totalInputTokens;
    const cacheHitRate = totalTokensForCache > 0
        ? (insights.totalCacheReadTokens / totalTokensForCache) * 100
        : 0;

    // Tokens per user message
    const totalTokens = insights.totalInputTokens + insights.totalOutputTokens;
    const tokensPerUserMessage = insights.totalUserMessages > 0
        ? totalTokens / insights.totalUserMessages
        : 0;

    // Output/input ratio
    const outputInputRatio = insights.totalInputTokens > 0
        ? insights.totalOutputTokens / insights.totalInputTokens
        : 0;

    // Average turn duration
    const averageTurnDurationMs = insights.totalAssistantTurns > 0
        ? insights.totalDurationMs / insights.totalAssistantTurns
        : 0;

    // Average turns per conversation
    const averageTurnsPerConversation = insights.sessionCount > 0
        ? insights.totalAssistantTurns / insights.sessionCount
        : 0;

    // Average user messages per conversation
    const averageUserMessagesPerConversation = insights.sessionCount > 0
        ? insights.totalUserMessages / insights.sessionCount
        : 0;

    return {
        totalCost,
        inputCost,
        outputCost,
        cacheHitRate,
        tokensPerUserMessage,
        outputInputRatio,
        averageTurnDurationMs,
        averageTurnsPerConversation,
        averageUserMessagesPerConversation
    };
}

function detectPatterns(insights: SessionInsights): WorkflowPatterns {
    // Extract tool chains
    const topToolChains = extractToolChains(insights);

    // Extract file hotspots
    const fileHotspots = extractFileHotspots(insights);

    // Delegation summary
    const totalDelegations = insights.totalSubAgentDelegations.reduce((sum, d) => sum + d.count, 0);
    const delegationSummary = insights.totalSubAgentDelegations.map(d => ({
        type: d.type,
        count: d.count,
        percentage: totalDelegations > 0 ? (d.count / totalDelegations) * 100 : 0
    }));

    // Conversation complexity
    const avgTurns = insights.sessionCount > 0
        ? insights.totalAssistantTurns / insights.sessionCount
        : 0;
    let conversationComplexity: 'simple' | 'moderate' | 'complex';
    if (avgTurns < 10) {
        conversationComplexity = 'simple';
    } else if (avgTurns <= 30) {
        conversationComplexity = 'moderate';
    } else {
        conversationComplexity = 'complex';
    }

    // Read/Edit ratio
    const readCount = insights.totalToolUses.get('Read') || 0;
    const editCount = insights.totalToolUses.get('Edit') || 0;
    const readEditRatio = editCount > 0 ? readCount / editCount : (readCount > 0 ? Infinity : 0);

    return {
        topToolChains,
        fileHotspots,
        delegationSummary,
        conversationComplexity,
        readEditRatio
    };
}

function extractToolChains(insights: SessionInsights): ToolChain[] {
    const sequenceCounts = new Map<string, number>();

    // Extract bigrams and trigrams from each conversation's tool sequence
    for (const conv of insights.conversations) {
        const seq = conv.toolSequence;

        // Bigrams (2-tool sequences)
        for (let i = 0; i < seq.length - 1; i++) {
            const bigram = JSON.stringify([seq[i], seq[i + 1]]);
            sequenceCounts.set(bigram, (sequenceCounts.get(bigram) || 0) + 1);
        }

        // Trigrams (3-tool sequences)
        for (let i = 0; i < seq.length - 2; i++) {
            const trigram = JSON.stringify([seq[i], seq[i + 1], seq[i + 2]]);
            sequenceCounts.set(trigram, (sequenceCounts.get(trigram) || 0) + 1);
        }
    }

    // Filter sequences with at least 2 occurrences and convert to ToolChain
    const chains: ToolChain[] = [];
    for (const [seqJson, count] of sequenceCounts) {
        if (count >= 2) {
            chains.push({
                sequence: JSON.parse(seqJson),
                count
            });
        }
    }

    // Sort by count descending and take top 10
    chains.sort((a, b) => b.count - a.count);
    return chains.slice(0, 10);
}

function extractFileHotspots(insights: SessionInsights): FileHotspot[] {
    const hotspots: FileHotspot[] = [];

    for (const [file, stats] of insights.totalFileOperations) {
        const totalOperations = stats.reads + stats.edits + stats.writes;
        hotspots.push({
            file,
            totalOperations,
            reads: stats.reads,
            edits: stats.edits,
            writes: stats.writes
        });
    }

    // Sort by total operations descending and take top 10
    hotspots.sort((a, b) => b.totalOperations - a.totalOperations);
    return hotspots.slice(0, 10);
}

function analyzeErrors(insights: SessionInsights): ErrorAnalysis {
    const totalErrors = insights.totalToolErrors.length;

    // Compute total tool calls
    let totalToolCalls = 0;
    for (const count of insights.totalToolUses.values()) {
        totalToolCalls += count;
    }

    const errorRate = totalToolCalls > 0 ? (totalErrors / totalToolCalls) * 100 : 0;

    // Group errors by tool
    const errorCountByTool = new Map<string, number>();
    for (const error of insights.totalToolErrors) {
        errorCountByTool.set(error.tool, (errorCountByTool.get(error.tool) || 0) + 1);
    }

    // Convert to array with percentages
    const errorsByTool: { tool: string; count: number; percentage: number }[] = [];
    for (const [tool, count] of errorCountByTool) {
        const percentage = totalErrors > 0 ? (count / totalErrors) * 100 : 0;
        errorsByTool.push({ tool, count, percentage });
    }

    // Sort by count descending
    errorsByTool.sort((a, b) => b.count - a.count);

    // Most failed tool
    const mostFailedTool = errorsByTool.length > 0 ? errorsByTool[0].tool : null;

    return {
        totalErrors,
        errorRate,
        errorsByTool,
        mostFailedTool
    };
}

function generateRecommendations(
    efficiency: EfficiencyMetrics,
    patterns: WorkflowPatterns,
    errorAnalysis: ErrorAnalysis,
    insights: SessionInsights
): Recommendation[] {
    const recommendations: Recommendation[] = [];

    // Cache utilization
    if (efficiency.cacheHitRate < 20 && insights.totalInputTokens > 100000) {
        recommendations.push({
            severity: 'warning',
            category: 'efficiency',
            title: 'Low cache utilization',
            detail: `Cache hit rate is ${efficiency.cacheHitRate.toFixed(1)}%. Structuring prompts with stable system prefixes can improve caching.`
        });
    } else if (efficiency.cacheHitRate >= 20 && efficiency.cacheHitRate < 50) {
        recommendations.push({
            severity: 'suggestion',
            category: 'efficiency',
            title: 'Moderate cache utilization',
            detail: `Cache hit rate is ${efficiency.cacheHitRate.toFixed(1)}%. There may be room to improve prompt structure for better caching.`
        });
    }

    // Long conversations
    if (efficiency.averageTurnsPerConversation > 30) {
        recommendations.push({
            severity: 'warning',
            category: 'patterns',
            title: 'Long conversations detected',
            detail: `Average conversation length is ${efficiency.averageTurnsPerConversation.toFixed(1)} turns. Consider breaking complex tasks into smaller, focused sessions.`
        });
    } else if (efficiency.averageTurnsPerConversation > 15 && efficiency.averageTurnsPerConversation <= 30) {
        recommendations.push({
            severity: 'suggestion',
            category: 'patterns',
            title: 'Moderately long conversations',
            detail: `Average conversation length is ${efficiency.averageTurnsPerConversation.toFixed(1)} turns. Shorter sessions can improve focus and reduce context window pressure.`
        });
    }

    // Error rate
    if (errorAnalysis.errorRate > 10) {
        const topTool = errorAnalysis.errorsByTool[0];
        const topToolDetail = topTool
            ? `The most failing tool is ${topTool.tool} (${topTool.count} failures). `
            : '';
        recommendations.push({
            severity: 'warning',
            category: 'errors',
            title: 'High tool error rate',
            detail: `Tool error rate is ${errorAnalysis.errorRate.toFixed(1)}%. ${topToolDetail}Review error patterns to identify root causes.`
        });
    } else if (errorAnalysis.errorRate > 5 && errorAnalysis.errorRate <= 10) {
        recommendations.push({
            severity: 'suggestion',
            category: 'errors',
            title: 'Moderate tool error rate',
            detail: `Tool error rate is ${errorAnalysis.errorRate.toFixed(1)}%. Consider reviewing ${errorAnalysis.mostFailedTool} usage patterns.`
        });
    }

    // Read/Edit ratio
    if (patterns.readEditRatio > 5) {
        const ratioDisplay = isFinite(patterns.readEditRatio)
            ? `${patterns.readEditRatio.toFixed(1)}x more than edited`
            : 'but never edited';
        recommendations.push({
            severity: 'suggestion',
            category: 'patterns',
            title: 'High exploration-to-edit ratio',
            detail: `Files are read ${ratioDisplay}. This may indicate difficulty finding the right code or excessive exploration.`
        });
    }

    // Cost warnings
    if (efficiency.totalCost > 50) {
        recommendations.push({
            severity: 'warning',
            category: 'efficiency',
            title: 'High session cost',
            detail: `Estimated session cost is $${efficiency.totalCost.toFixed(2)}. Consider optimizing prompt efficiency or using smaller models for simpler tasks.`
        });
    } else if (efficiency.totalCost > 10) {
        recommendations.push({
            severity: 'info',
            category: 'efficiency',
            title: 'Cost summary',
            detail: `Estimated total cost: $${efficiency.totalCost.toFixed(2)}. Input: $${efficiency.inputCost.toFixed(2)}, Output: $${efficiency.outputCost.toFixed(2)}.`
        });
    }

    // File hotspots
    if (patterns.fileHotspots.length > 0 && patterns.fileHotspots[0].totalOperations > 20) {
        recommendations.push({
            severity: 'info',
            category: 'patterns',
            title: 'File hotspot detected',
            detail: `The file ${patterns.fileHotspots[0].file} was accessed ${patterns.fileHotspots[0].totalOperations} times. If you frequently work with this file, consider creating a focused skill.`
        });
    }

    // Sub-agent usage
    if (patterns.delegationSummary.length > 0) {
        const totalDelegations = patterns.delegationSummary.reduce((sum, d) => sum + d.count, 0);
        const sorted = [...patterns.delegationSummary].sort((a, b) => b.count - a.count);
        const topDelegation = sorted[0];
        recommendations.push({
            severity: 'info',
            category: 'patterns',
            title: 'Sub-agent usage',
            detail: `Sub-agents were used ${totalDelegations} times. Most common: ${topDelegation.type} (${topDelegation.count} delegations).`
        });
    }

    // Clean execution
    if (errorAnalysis.totalErrors === 0) {
        recommendations.push({
            severity: 'info',
            category: 'errors',
            title: 'Clean execution',
            detail: 'No tool errors detected across all conversations.'
        });
    }

    // Sort: warnings first, then suggestions, then info
    const severityOrder = { warning: 0, suggestion: 1, info: 2 };
    recommendations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return recommendations;
}
