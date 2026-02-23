import * as os from 'os';
import * as path from 'path';
import { readDir, readFile } from './FileService';
import { AnalysisResult } from './InsightsAnalyzer';

export interface ConversationData {
    sessionId: string;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
    userMessageCount: number;
    assistantTurnCount: number;
    toolUses: Map<string, number>;
    skillUses: Map<string, number>;
    mcpUses: Map<string, number>;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalDurationMs: number;
    userPromptPreviews: string[];
    model: string;
    toolErrors: { tool: string; error: string }[];
    toolSequence: string[];
    fileOperations: { file: string; operation: 'Read' | 'Edit' | 'Write' | 'Glob' | 'Grep'; count: number }[];
    subAgentDelegations: { type: string; description: string }[];
    costEstimate: { inputCost: number; outputCost: number; totalCost: number };
}

export interface SessionInsights {
    sessionCount: number;
    conversations: ConversationData[];
    totalUserMessages: number;
    totalAssistantTurns: number;
    totalToolUses: Map<string, number>;
    totalSkillUses: Map<string, number>;
    totalMcpUses: Map<string, number>;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalDurationMs: number;
    earliestTimestamp: string | null;
    latestTimestamp: string | null;
    totalToolErrors: { tool: string; error: string }[];
    totalFileOperations: Map<string, { reads: number; edits: number; writes: number }>;
    totalSubAgentDelegations: { type: string; count: number }[];
}

export function getClaudeProjectDir(worktreePath: string): string {
    const hash = worktreePath.replace(/[/.]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', hash);
}

function calculateCostEstimate(model: string, inputTokens: number, outputTokens: number): { inputCost: number; outputCost: number; totalCost: number } {
    let inputPricePerMillion = 3;
    let outputPricePerMillion = 15;

    if (model.includes('claude-opus-4')) {
        inputPricePerMillion = 15;
        outputPricePerMillion = 75;
    } else if (model.includes('claude-haiku-3-5')) {
        inputPricePerMillion = 0.80;
        outputPricePerMillion = 4;
    } else if (model.includes('claude-sonnet-4')) {
        inputPricePerMillion = 3;
        outputPricePerMillion = 15;
    }

    const inputCost = (inputTokens / 1_000_000) * inputPricePerMillion;
    const outputCost = (outputTokens / 1_000_000) * outputPricePerMillion;
    const totalCost = inputCost + outputCost;

    return { inputCost, outputCost, totalCost };
}

export async function parseConversationFile(filePath: string): Promise<ConversationData> {
    const content = await readFile(filePath);
    const lines = content.split('\n').filter(l => l.trim());

    const sessionId = path.basename(filePath, '.jsonl');
    let firstTimestamp: string | null = null;
    let lastTimestamp: string | null = null;
    let userMessageCount = 0;
    let assistantTurnCount = 0;
    const toolUses = new Map<string, number>();
    const skillUses = new Map<string, number>();
    const mcpUses = new Map<string, number>();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalDurationMs = 0;
    const userPromptPreviews: string[] = [];
    let model = '';
    const toolErrors: { tool: string; error: string }[] = [];
    const toolSequence: string[] = [];
    const fileOperationsMap = new Map<string, Map<string, number>>();
    const subAgentDelegations: { type: string; description: string }[] = [];

    // Track current assistant turn state for grouping streaming entries.
    // Consecutive assistant entries form a single turn; each entry is one
    // streamed content block. We collect tool_use blocks from all entries
    // and take token usage from the last entry in the group.
    let inAssistantTurn = false;
    let turnUsage: Record<string, number> | undefined;
    let turnModel = '';
    const turnToolNames: string[] = [];
    const turnSkillNames: string[] = [];
    const turnMcpNames: string[] = [];
    // Map tool_id to tool name for tracking errors
    const toolIdToName = new Map<string, string>();

    function finalizeAssistantTurn(): void {
        if (!inAssistantTurn) { return; }
        assistantTurnCount++;
        if (!model && turnModel) { model = turnModel; }
        if (turnUsage) {
            totalInputTokens += (turnUsage.input_tokens || 0)
                + (turnUsage.cache_creation_input_tokens || 0);
            totalOutputTokens += turnUsage.output_tokens || 0;
            totalCacheReadTokens += turnUsage.cache_read_input_tokens || 0;
        }
        for (const name of turnToolNames) {
            toolUses.set(name, (toolUses.get(name) || 0) + 1);
        }
        for (const name of turnSkillNames) {
            skillUses.set(name, (skillUses.get(name) || 0) + 1);
        }
        for (const name of turnMcpNames) {
            mcpUses.set(name, (mcpUses.get(name) || 0) + 1);
        }
        inAssistantTurn = false;
        turnUsage = undefined;
        turnModel = '';
        turnToolNames.length = 0;
        turnSkillNames.length = 0;
        turnMcpNames.length = 0;
    }

    for (const line of lines) {
        let entry: Record<string, unknown>;
        try {
            entry = JSON.parse(line);
        } catch {
            continue;
        }

        const timestamp = entry.timestamp as string | undefined;
        if (timestamp) {
            if (!firstTimestamp || timestamp < firstTimestamp) {
                firstTimestamp = timestamp;
            }
            if (!lastTimestamp || timestamp > lastTimestamp) {
                lastTimestamp = timestamp;
            }
        }

        const type = entry.type as string | undefined;

        // Progress entries can appear mid-turn; don't finalize on them.
        if (type === 'progress' || type === 'file-history-snapshot') {
            continue;
        }

        if (type === 'user') {
            finalizeAssistantTurn();

            const msg = entry.message as Record<string, unknown> | undefined;
            if (!msg) { continue; }
            const msgContent = msg.content;
            // Only count human-typed messages (string content), not tool results (array content)
            if (typeof msgContent === 'string') {
                userMessageCount++;
                userPromptPreviews.push(msgContent.slice(0, 200));
            } else if (Array.isArray(msgContent)) {
                // Check if this is a human message with text content (not tool_result)
                const hasToolResult = msgContent.some(
                    (c: Record<string, unknown>) => c.type === 'tool_result'
                );
                if (!hasToolResult) {
                    const textParts = msgContent
                        .filter((c: Record<string, unknown>) => c.type === 'text')
                        .map((c: Record<string, unknown>) => c.text as string);
                    if (textParts.length > 0) {
                        userMessageCount++;
                        userPromptPreviews.push(textParts.join(' ').slice(0, 200));
                    }
                } else {
                    // Extract tool errors from tool_result entries
                    for (const block of msgContent) {
                        if (block.type === 'tool_result') {
                            const toolId = block.tool_use_id as string | undefined;
                            const isError = block.is_error as boolean | undefined;
                            const content = block.content;

                            if (isError && toolId) {
                                const toolName = toolIdToName.get(toolId) || 'unknown';
                                let errorText = '';

                                if (typeof content === 'string') {
                                    errorText = content;
                                } else if (Array.isArray(content)) {
                                    // Extract text from content blocks
                                    errorText = content
                                        .filter((c: Record<string, unknown>) => c.type === 'text')
                                        .map((c: Record<string, unknown>) => c.text as string)
                                        .join(' ');
                                }

                                if (errorText) {
                                    toolErrors.push({ tool: toolName, error: errorText });
                                }
                            }
                        }
                    }
                }
            }
        } else if (type === 'assistant') {
            const msg = entry.message as Record<string, unknown> | undefined;
            if (!msg) { continue; }

            inAssistantTurn = true;

            if (msg.model) { turnModel = msg.model as string; }

            // Always update usage — the last entry in the group has the
            // final accumulated values for the turn.
            const usage = msg.usage as Record<string, number> | undefined;
            if (usage) { turnUsage = usage; }

            const contentArr = msg.content as Array<Record<string, unknown>> | undefined;
            if (contentArr) {
                for (const block of contentArr) {
                    if (block.type === 'tool_use' && typeof block.name === 'string') {
                        const toolName = block.name as string;
                        const toolId = block.id as string | undefined;
                        const input = block.input as Record<string, unknown> | undefined;

                        turnToolNames.push(toolName);

                        // Track tool ID for error mapping
                        if (toolId) {
                            toolIdToName.set(toolId, toolName);
                        }

                        // Add to tool sequence
                        toolSequence.push(toolName);

                        // Extract skill name from Skill tool invocations
                        if (toolName === 'Skill') {
                            if (input && typeof input.skill === 'string') {
                                turnSkillNames.push(input.skill as string);
                            }
                        }
                        // Extract MCP server and tool from mcp__<server>__<tool> pattern
                        else if (toolName.startsWith('mcp__')) {
                            const parts = toolName.split('__');
                            if (parts.length >= 3) {
                                const server = parts[1];
                                const mcpTool = parts.slice(2).join('__');
                                turnMcpNames.push(`${server}: ${mcpTool}`);
                            }
                        }
                        // Extract file operations
                        else if (input && (toolName === 'Read' || toolName === 'Edit' || toolName === 'Write' || toolName === 'Glob' || toolName === 'Grep')) {
                            const filePath = (input.file_path as string | undefined)
                                ?? (input.path as string | undefined)
                                ?? (input.pattern as string | undefined);
                            if (filePath) {
                                if (!fileOperationsMap.has(filePath)) {
                                    fileOperationsMap.set(filePath, new Map());
                                }
                                const opMap = fileOperationsMap.get(filePath)!;
                                opMap.set(toolName, (opMap.get(toolName) || 0) + 1);
                            }
                        }
                        // Extract subagent delegations from Task tool
                        else if (toolName === 'Task' && input) {
                            const subagentType = input.subagent_type as string | undefined;
                            const description = input.description as string | undefined;
                            if (subagentType && description) {
                                subAgentDelegations.push({ type: subagentType, description });
                            }
                        }
                    }
                }
            }
        } else if (type === 'system') {
            finalizeAssistantTurn();

            const subtype = entry.subtype as string | undefined;
            if (subtype === 'turn_duration') {
                totalDurationMs += (entry.durationMs as number) || 0;
            }
        } else {
            finalizeAssistantTurn();
        }
    }

    // Finalize any trailing assistant turn at end of file
    finalizeAssistantTurn();

    // Convert fileOperationsMap to array format
    const fileOperations: ConversationData['fileOperations'] = [];
    for (const [file, opMap] of fileOperationsMap) {
        for (const [op, count] of opMap) {
            fileOperations.push({
                file,
                operation: op as 'Read' | 'Edit' | 'Write' | 'Glob' | 'Grep',
                count
            });
        }
    }

    // Calculate cost estimate
    const costEstimate = calculateCostEstimate(model, totalInputTokens, totalOutputTokens);

    return {
        sessionId,
        firstTimestamp,
        lastTimestamp,
        userMessageCount,
        assistantTurnCount,
        toolUses,
        skillUses,
        mcpUses,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalDurationMs,
        userPromptPreviews,
        model,
        toolErrors,
        toolSequence,
        fileOperations,
        subAgentDelegations,
        costEstimate,
    };
}

export async function generateInsights(worktreePath: string): Promise<SessionInsights> {
    const projectDir = getClaudeProjectDir(worktreePath);
    const entries = await readDir(projectDir);
    const jsonlFiles = entries.filter(e => e.endsWith('.jsonl'));

    const conversations: ConversationData[] = [];
    for (const file of jsonlFiles) {
        const data = await parseConversationFile(path.join(projectDir, file));
        // Skip empty conversations (no user messages and no assistant turns)
        if (data.userMessageCount === 0 && data.assistantTurnCount === 0) {
            continue;
        }
        conversations.push(data);
    }

    // Sort by first timestamp
    conversations.sort((a, b) => {
        if (!a.firstTimestamp) { return 1; }
        if (!b.firstTimestamp) { return -1; }
        return a.firstTimestamp.localeCompare(b.firstTimestamp);
    });

    const totalToolUses = new Map<string, number>();
    const totalSkillUses = new Map<string, number>();
    const totalMcpUses = new Map<string, number>();
    let totalUserMessages = 0;
    let totalAssistantTurns = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let totalDurationMs = 0;
    let earliestTimestamp: string | null = null;
    let latestTimestamp: string | null = null;
    const totalToolErrors: { tool: string; error: string }[] = [];
    const totalFileOperations = new Map<string, { reads: number; edits: number; writes: number }>();
    const subAgentDelegationCounts = new Map<string, number>();

    for (const conv of conversations) {
        totalUserMessages += conv.userMessageCount;
        totalAssistantTurns += conv.assistantTurnCount;
        totalInputTokens += conv.totalInputTokens;
        totalOutputTokens += conv.totalOutputTokens;
        totalCacheReadTokens += conv.totalCacheReadTokens;
        totalDurationMs += conv.totalDurationMs;

        for (const [tool, count] of conv.toolUses) {
            totalToolUses.set(tool, (totalToolUses.get(tool) || 0) + count);
        }
        for (const [skill, count] of conv.skillUses) {
            totalSkillUses.set(skill, (totalSkillUses.get(skill) || 0) + count);
        }
        for (const [mcp, count] of conv.mcpUses) {
            totalMcpUses.set(mcp, (totalMcpUses.get(mcp) || 0) + count);
        }

        // Aggregate tool errors
        for (const error of conv.toolErrors) {
            totalToolErrors.push(error);
        }

        // Aggregate file operations
        for (const fileOp of conv.fileOperations) {
            const existing = totalFileOperations.get(fileOp.file);
            if (!existing) {
                totalFileOperations.set(fileOp.file, { reads: 0, edits: 0, writes: 0 });
            }
            const stats = totalFileOperations.get(fileOp.file)!;
            if (fileOp.operation === 'Read') {
                stats.reads += fileOp.count;
            } else if (fileOp.operation === 'Edit') {
                stats.edits += fileOp.count;
            } else if (fileOp.operation === 'Write') {
                stats.writes += fileOp.count;
            } else if (fileOp.operation === 'Glob' || fileOp.operation === 'Grep') {
                // Count Glob/Grep as reads for aggregation purposes
                stats.reads += fileOp.count;
            }
        }

        // Aggregate subagent delegations
        for (const delegation of conv.subAgentDelegations) {
            subAgentDelegationCounts.set(delegation.type, (subAgentDelegationCounts.get(delegation.type) || 0) + 1);
        }

        if (conv.firstTimestamp) {
            if (!earliestTimestamp || conv.firstTimestamp < earliestTimestamp) {
                earliestTimestamp = conv.firstTimestamp;
            }
        }
        if (conv.lastTimestamp) {
            if (!latestTimestamp || conv.lastTimestamp > latestTimestamp) {
                latestTimestamp = conv.lastTimestamp;
            }
        }
    }

    // Convert subagent delegation counts to array
    const totalSubAgentDelegations: { type: string; count: number }[] = [];
    for (const [type, count] of subAgentDelegationCounts) {
        totalSubAgentDelegations.push({ type, count });
    }

    return {
        sessionCount: conversations.length,
        conversations,
        totalUserMessages,
        totalAssistantTurns,
        totalToolUses,
        totalSkillUses,
        totalMcpUses,
        totalInputTokens,
        totalOutputTokens,
        totalCacheReadTokens,
        totalDurationMs,
        earliestTimestamp,
        latestTimestamp,
        totalToolErrors,
        totalFileOperations,
        totalSubAgentDelegations,
    };
}

function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${month} ${day}, ${year} ${hours}:${minutes}`;
}

function formatShortTimestamp(iso: string): string {
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    return `${month} ${day} ${hours}:${minutes}`;
}

function formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
}

function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

function percentageBar(value: number, max: number = 100, width: number = 20): string {
    const filled = Math.min(width, Math.max(0, Math.round((value / max) * width)));
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${value.toFixed(1)}%`;
}

function truncateFilePath(filePath: string, segments: number = 2): string {
    const parts = filePath.split('/').filter(p => p.length > 0);
    if (parts.length <= segments) {
        return filePath;
    }
    return parts.slice(-segments).join('/');
}

export function formatInsightsReport(sessionName: string, insights: SessionInsights, analysis?: AnalysisResult): string {
    const lines: string[] = [];

    lines.push(`# Session Insights: ${sessionName}`);
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push(`- **Conversations**: ${insights.sessionCount}`);
    if (insights.earliestTimestamp && insights.latestTimestamp) {
        lines.push(`- **Period**: ${formatTimestamp(insights.earliestTimestamp)} - ${formatTimestamp(insights.latestTimestamp)}`);
    }
    if (insights.totalDurationMs > 0) {
        lines.push(`- **Total active time**: ${formatDuration(insights.totalDurationMs)} (across all turns)`);
    }
    const model = insights.conversations.find(c => c.model)?.model;
    if (model) {
        lines.push(`- **Model**: ${model}`);
    }
    if (analysis) {
        lines.push(`- **Estimated cost**: $${analysis.efficiency.totalCost.toFixed(2)}`);
        lines.push(`- **Complexity**: ${analysis.patterns.conversationComplexity}`);
    }
    lines.push('');

    // Recommendations (only if analysis provided and has recommendations)
    if (analysis && analysis.recommendations.length > 0) {
        lines.push('## Recommendations');
        lines.push('');
        for (const rec of analysis.recommendations) {
            let icon = 'ℹ️';
            if (rec.severity === 'warning') {
                icon = '⚠️';
            } else if (rec.severity === 'suggestion') {
                icon = '💡';
            }
            lines.push(`> ${icon} **${rec.title}** — ${rec.detail}`);
            lines.push('');
        }
    }

    // Efficiency (only if analysis provided)
    if (analysis) {
        lines.push('## Efficiency');
        lines.push('');
        lines.push('| Metric | Value |');
        lines.push('|--------|-------|');
        lines.push(`| Cache hit rate | ${percentageBar(analysis.efficiency.cacheHitRate)} |`);
        lines.push(`| Tokens per message | ${formatNumber(Math.round(analysis.efficiency.tokensPerUserMessage))} |`);
        lines.push(`| Output/Input ratio | ${analysis.efficiency.outputInputRatio.toFixed(2)} |`);

        const avgTurnSeconds = Math.floor(analysis.efficiency.averageTurnDurationMs / 1000);
        const avgTurnMinutes = Math.floor(avgTurnSeconds / 60);
        const avgTurnRemainingSeconds = avgTurnSeconds % 60;
        lines.push(`| Avg turn duration | ${avgTurnMinutes}m ${avgTurnRemainingSeconds}s |`);

        lines.push(`| Avg turns/conversation | ${analysis.efficiency.averageTurnsPerConversation.toFixed(1)} |`);
        lines.push(`| Avg messages/conversation | ${analysis.efficiency.averageUserMessagesPerConversation.toFixed(1)} |`);
        lines.push('');

        lines.push('### Cost Breakdown');
        lines.push('| | Amount |');
        lines.push('|--|--------|');
        lines.push(`| Input | $${analysis.efficiency.inputCost.toFixed(2)} |`);
        lines.push(`| Output | $${analysis.efficiency.outputCost.toFixed(2)} |`);
        lines.push(`| **Total** | **$${analysis.efficiency.totalCost.toFixed(2)}** |`);
        lines.push('');
    }

    // Token usage
    lines.push('## Token Usage');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Input tokens | ${formatNumber(insights.totalInputTokens)} |`);
    lines.push(`| Output tokens | ${formatNumber(insights.totalOutputTokens)} |`);
    lines.push(`| Cache read tokens | ${formatNumber(insights.totalCacheReadTokens)} |`);
    lines.push('');

    // Workflow Patterns (only if analysis provided)
    if (analysis) {
        const hasToolChains = analysis.patterns.topToolChains.length > 0;
        const hasFileHotspots = analysis.patterns.fileHotspots.length > 0;
        const hasDelegations = analysis.patterns.delegationSummary.length > 0;

        if (hasToolChains || hasFileHotspots || hasDelegations) {
            lines.push('## Workflow Patterns');
            lines.push('');

            // Tool Chains
            if (hasToolChains) {
                lines.push('### Tool Chains');
                lines.push('');
                for (const chain of analysis.patterns.topToolChains) {
                    const chainStr = chain.sequence.join(' → ');
                    lines.push(`${chainStr} (×${chain.count})`);
                    lines.push('');
                }
            }

            // File Hotspots
            if (hasFileHotspots) {
                lines.push('### File Hotspots');
                lines.push('');
                lines.push('| File | Total | Reads | Edits | Writes |');
                lines.push('|------|-------|-------|-------|--------|');
                for (const hotspot of analysis.patterns.fileHotspots) {
                    const truncatedFile = truncateFilePath(hotspot.file);
                    lines.push(`| ${truncatedFile} | ${hotspot.totalOperations} | ${hotspot.reads} | ${hotspot.edits} | ${hotspot.writes} |`);
                }
                lines.push('');
            }

            // Sub-Agent Delegations
            if (hasDelegations) {
                lines.push('### Sub-Agent Delegations');
                lines.push('');
                lines.push('| Agent Type | Count | % |');
                lines.push('|------------|-------|---|');
                for (const delegation of analysis.patterns.delegationSummary) {
                    lines.push(`| ${delegation.type} | ${delegation.count} | ${delegation.percentage.toFixed(1)}% |`);
                }
                lines.push('');
            }
        }
    }

    // Tool usage
    if (insights.totalToolUses.size > 0) {
        const sortedTools = [...insights.totalToolUses.entries()].sort((a, b) => b[1] - a[1]);
        lines.push('## Tool Usage');
        lines.push('| Tool | Uses |');
        lines.push('|------|------|');
        for (const [tool, count] of sortedTools) {
            lines.push(`| ${tool} | ${count} |`);
        }
        lines.push('');
    }

    // Skills used
    lines.push('## Skills Used');
    if (insights.totalSkillUses.size > 0) {
        const sortedSkills = [...insights.totalSkillUses.entries()].sort((a, b) => b[1] - a[1]);
        lines.push('| Skill | Uses |');
        lines.push('|-------|------|');
        for (const [skill, count] of sortedSkills) {
            lines.push(`| ${skill} | ${count} |`);
        }
    } else {
        lines.push('No skills used.');
    }
    lines.push('');

    // Error Analysis (only if analysis provided and has errors)
    if (analysis && analysis.errorAnalysis.totalErrors > 0) {
        lines.push('## Error Analysis');
        lines.push('');
        lines.push(`- **Total errors**: ${analysis.errorAnalysis.totalErrors} (${analysis.errorAnalysis.errorRate.toFixed(1)}% of tool calls)`);
        if (analysis.errorAnalysis.mostFailedTool) {
            lines.push(`- **Most failed tool**: ${analysis.errorAnalysis.mostFailedTool}`);
        }
        lines.push('');
        lines.push('| Tool | Errors | % of Errors |');
        lines.push('|------|--------|-------------|');
        for (const errorStat of analysis.errorAnalysis.errorsByTool) {
            lines.push(`| ${errorStat.tool} | ${errorStat.count} | ${errorStat.percentage.toFixed(1)}% |`);
        }
        lines.push('');
    }

    // MCP server usage
    if (insights.totalMcpUses.size > 0) {
        // Group by server name
        const serverMap = new Map<string, Map<string, number>>();
        for (const [entry, count] of insights.totalMcpUses) {
            const colonIdx = entry.indexOf(': ');
            const server = entry.slice(0, colonIdx);
            const tool = entry.slice(colonIdx + 2);
            if (!serverMap.has(server)) { serverMap.set(server, new Map()); }
            serverMap.get(server)!.set(tool, count);
        }

        lines.push('## MCP Servers');
        for (const [server, tools] of serverMap) {
            const sortedTools = [...tools.entries()].sort((a, b) => b[1] - a[1]);
            const totalCalls = sortedTools.reduce((sum, [, c]) => sum + c, 0);
            lines.push(`### ${server} (${totalCalls} calls)`);
            lines.push('| Tool | Uses |');
            lines.push('|------|------|');
            for (const [tool, count] of sortedTools) {
                lines.push(`| ${tool} | ${count} |`);
            }
            lines.push('');
        }
    }

    // Individual conversations
    if (insights.conversations.length > 0) {
        lines.push('## Conversations');
        lines.push('');
        for (let i = 0; i < insights.conversations.length; i++) {
            const conv = insights.conversations[i];
            let header = `### ${i + 1}. ${conv.sessionId}`;
            if (conv.firstTimestamp && conv.lastTimestamp) {
                header += ` (${formatShortTimestamp(conv.firstTimestamp)} - ${formatShortTimestamp(conv.lastTimestamp)})`;
            }
            lines.push(header);
            lines.push(`- **Turns**: ${conv.userMessageCount} user / ${conv.assistantTurnCount} assistant`);
            if (conv.totalDurationMs > 0) {
                lines.push(`- **Duration**: ${formatDuration(conv.totalDurationMs)}`);
            }
            lines.push(`- **Cost**: $${conv.costEstimate.totalCost.toFixed(2)}`);
            if (conv.userPromptPreviews.length > 0) {
                lines.push('- **Prompts**:');
                for (const preview of conv.userPromptPreviews) {
                    const cleaned = preview.replace(/\n/g, ' ').trim();
                    if (cleaned) {
                        const truncated = cleaned.length > 100 ? cleaned.slice(0, 100) + '...' : cleaned;
                        lines.push(`  - "${truncated}"`);
                    }
                }
            }
            lines.push('');
        }
    }

    return lines.join('\n');
}
