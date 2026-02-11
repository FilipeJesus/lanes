import * as os from 'os';
import * as path from 'path';
import { readDir, readFile } from './FileService';

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
}

export function getClaudeProjectDir(worktreePath: string): string {
    const hash = worktreePath.replace(/[/.]/g, '-');
    return path.join(os.homedir(), '.claude', 'projects', hash);
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
                        turnToolNames.push(toolName);
                        // Extract skill name from Skill tool invocations
                        if (toolName === 'Skill') {
                            const input = block.input as Record<string, unknown> | undefined;
                            if (input && typeof input.skill === 'string') {
                                turnSkillNames.push(input.skill as string);
                            }
                        }
                        // Extract MCP server and tool from mcp__<server>__<tool> pattern
                        if (toolName.startsWith('mcp__')) {
                            const parts = toolName.split('__');
                            if (parts.length >= 3) {
                                const server = parts[1];
                                const mcpTool = parts.slice(2).join('__');
                                turnMcpNames.push(`${server}: ${mcpTool}`);
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

export function formatInsightsReport(sessionName: string, insights: SessionInsights): string {
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
    lines.push('');

    // Token usage
    lines.push('## Token Usage');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Input tokens | ${formatNumber(insights.totalInputTokens)} |`);
    lines.push(`| Output tokens | ${formatNumber(insights.totalOutputTokens)} |`);
    lines.push(`| Cache read tokens | ${formatNumber(insights.totalCacheReadTokens)} |`);
    lines.push('');

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
    if (insights.totalSkillUses.size > 0) {
        const sortedSkills = [...insights.totalSkillUses.entries()].sort((a, b) => b[1] - a[1]);
        lines.push('## Skills Used');
        lines.push('| Skill | Uses |');
        lines.push('|-------|------|');
        for (const [skill, count] of sortedSkills) {
            lines.push(`| ${skill} | ${count} |`);
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
