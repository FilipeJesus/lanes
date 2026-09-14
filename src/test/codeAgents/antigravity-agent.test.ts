import * as assert from "assert";
import { AntigravityAgent } from "../../core/codeAgents/AntigravityAgent";

suite("AntigravityAgent", () => {
    const sessionId = "a1b2c3d4-e5f6-7890-1234-567890abcdef";
    let agent: AntigravityAgent;

    setup(() => {
        agent = new AntigravityAgent();
    });

    test("builds current start and resume commands", () => {
        assert.strictEqual(
            agent.buildStartCommand({
                permissionMode: "acceptEdits",
                prompt: "Fix it",
            }),
            "agy --mode accept-edits --prompt-interactive 'Fix it'",
        );
        assert.strictEqual(
            agent.buildResumeCommand(sessionId, {
                permissionMode: "bypassPermissions",
            }),
            `agy --dangerously-skip-permissions --conversation ${sessionId}`,
        );
    });

    test("rejects unsafe session IDs", () => {
        assert.throws(
            () => agent.buildResumeCommand("bad; rm -rf /", {}),
            /Invalid session ID/,
        );
        assert.strictEqual(agent.parseSessionData('{"sessionId":"bad"}'), null);
    });

    test("uses workspace Antigravity MCP configuration", () => {
        assert.strictEqual(
            agent.getProjectSettingsPath("/worktree"),
            "/worktree/.agents/mcp_config.json",
        );
        assert.strictEqual(agent.getMcpConfigDelivery(), "settings");
        assert.ok(
            agent.getMcpConfig("/worktree", "/workflow.yaml", "/repo")
                .mcpServers["lanes-workflow"],
        );
    });

    test("uses agy print mode for prompt improvement", () => {
        const command = agent.buildPromptImproveCommand("Improve me");
        assert.strictEqual(command.command, "agy");
        assert.strictEqual(command.args[0], "--print");
        assert.match(command.args[1], /Improve me/);
    });
});
