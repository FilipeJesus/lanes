/**
 * Backward Compatibility Tests
 *
 * Tests that verify the multi-agent system maintains backward compatibility with:
 * - Legacy command IDs (claudeWorktrees.*)
 * - Legacy session data format (sessions without agentName field)
 * - Agent coexistence (Claude and Codex have distinct identities)
 *
 * These tests ensure zero regressions in existing functionality.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { ClaudeCodeAgent } from '../../codeAgents/ClaudeCodeAgent';
import { CodexAgent } from '../../codeAgents/CodexAgent';

suite('Backward Compatibility', () => {
	suite('Legacy Command Aliases', () => {
		test('All old claudeWorktrees.* command IDs are registered', async () => {
			// Arrange: Get full command list
			const commands = await vscode.commands.getCommands(true);

			// Act & Assert: Verify each legacy command is registered
			const legacyCommands = [
				'claudeWorktrees.createSession',
				'claudeWorktrees.deleteSession',
				'claudeWorktrees.openSession',
				'claudeWorktrees.setupStatusHooks',
				'claudeWorktrees.showGitChanges',
				'claudeWorktrees.openInNewWindow',
				'claudeWorktrees.openPreviousSessionPrompt',
				'claudeWorktrees.enableChime',
				'claudeWorktrees.disableChime',
				'claudeWorktrees.testChime',
				'claudeWorktrees.clearSession',
				'claudeWorktrees.createTerminal',
				'claudeWorktrees.searchInWorktree',
				'claudeWorktrees.openWorkflowState',
				'claudeWorktrees.playChime',
			];

			for (const legacyCommand of legacyCommands) {
				assert.ok(
					commands.includes(legacyCommand),
					`Legacy command ${legacyCommand} should be registered`
				);
			}
		});

		test('All new lanes.* command IDs are registered', async () => {
			// Arrange: Get full command list
			const commands = await vscode.commands.getCommands(true);

			// Act & Assert: Verify each new command is registered
			const newCommands = [
				'lanes.createSession',
				'lanes.deleteSession',
				'lanes.openSession',
				'lanes.setupStatusHooks',
				'lanes.showGitChanges',
				'lanes.openInNewWindow',
				'lanes.openPreviousSessionPrompt',
				'lanes.enableChime',
				'lanes.disableChime',
				'lanes.testChime',
				'lanes.clearSession',
				'lanes.createTerminal',
				'lanes.searchInWorktree',
				'lanes.openWorkflowState',
				'lanes.playChime',
			];

			for (const newCommand of newCommands) {
				assert.ok(
					commands.includes(newCommand),
					`New command ${newCommand} should be registered`
				);
			}
		});
	});

	suite('Legacy Session Data', () => {
		test('ClaudeCodeAgent parseSessionData handles legacy data without agentName field', () => {
			// Arrange: Create legacy session JSON without agentName field
			// Use valid UUID for sessionId (ClaudeCodeAgent validates UUID format)
			const legacySessionJson = JSON.stringify({
				sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
				timestamp: '2026-01-01T00:00:00Z',
			});

			const agent = new ClaudeCodeAgent();

			// Act
			const result = agent.parseSessionData(legacySessionJson);

			// Assert
			assert.ok(result !== null, 'parseSessionData should return non-null for valid legacy data');
			assert.strictEqual(result!.sessionId, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', 'sessionId should match input');
			assert.strictEqual(result!.agentName, 'claude', 'agentName should default to claude for ClaudeCodeAgent');
		});

		test('CodexAgent parseSessionData handles data without agentName', () => {
			// Arrange: Create session JSON without agentName field
			const sessionJson = JSON.stringify({
				sessionId: '12345678-abcd-1234-ef00-123456789abc',
				timestamp: '2026-01-01T00:00:00Z',
			});

			const agent = new CodexAgent();

			// Act
			const result = agent.parseSessionData(sessionJson);

			// Assert
			assert.ok(result !== null, 'parseSessionData should return non-null for valid data');
			assert.strictEqual(result!.agentName, 'codex', 'agentName should default to codex for CodexAgent');
		});

		test('CodexAgent parseSessionData rejects non-UUID sessionId', () => {
			// Arrange: Create session JSON with invalid sessionId format
			const invalidSessionJson = JSON.stringify({
				sessionId: 'not-a-uuid',
				timestamp: '2026-01-01T00:00:00Z',
			});

			const agent = new CodexAgent();

			// Act
			const result = agent.parseSessionData(invalidSessionJson);

			// Assert
			assert.strictEqual(result, null, 'parseSessionData should return null for non-UUID sessionId');
		});

		test('ClaudeCodeAgent still produces correct hook configs', () => {
			// Arrange
			const agent = new ClaudeCodeAgent();
			const tempPath = os.tmpdir();
			const worktreePath = path.join(tempPath, 'test-worktree');
			const sessionFilePath = path.join(worktreePath, '.claude-session');
			const statusFilePath = path.join(worktreePath, '.claude-status');

			// Act
			const hooks = agent.generateHooksConfig(worktreePath, sessionFilePath, statusFilePath);

			// Assert: Hook configs are generated
			assert.ok(Array.isArray(hooks), 'generateHooksConfig should return array');
			assert.ok(hooks.length > 0, 'generateHooksConfig should return non-empty array');

			// Assert: SessionStart hook exists
			const sessionStartHook = hooks.find(h => h.event === 'SessionStart');
			assert.ok(sessionStartHook, 'SessionStart hook should be present');
			assert.ok(sessionStartHook!.commands.length > 0, 'SessionStart hook should have commands');
		});
	});

	suite('Agent Coexistence', () => {
		test('Claude and Codex agents have distinct terminal names', () => {
			// Arrange
			const claudeAgent = new ClaudeCodeAgent();
			const codexAgent = new CodexAgent();
			const sessionName = 'test-session';

			// Act
			const claudeName = claudeAgent.getTerminalName(sessionName);
			const codexName = codexAgent.getTerminalName(sessionName);

			// Assert
			assert.strictEqual(claudeName, 'Claude: test-session', 'Claude terminal name should include "Claude:"');
			assert.strictEqual(codexName, 'Codex: test-session', 'Codex terminal name should include "Codex:"');
			assert.notStrictEqual(claudeName, codexName, 'Terminal names should be distinct');
		});

		test('Claude and Codex agents have distinct terminal icons', () => {
			// Arrange
			const claudeAgent = new ClaudeCodeAgent();
			const codexAgent = new CodexAgent();

			// Act
			const claudeIcon = claudeAgent.getTerminalIcon();
			const codexIcon = codexAgent.getTerminalIcon();

			// Assert
			assert.ok(claudeIcon.color, 'Claude icon should have color');
			assert.ok(codexIcon.color, 'Codex icon should have color');
			assert.notStrictEqual(claudeIcon.color, codexIcon.color, 'Terminal icon colors should be distinct');

			// Assert: Specific colors
			assert.strictEqual(claudeIcon.color, 'terminal.ansiGreen', 'Claude icon should be green');
			assert.strictEqual(codexIcon.color, 'terminal.ansiBlue', 'Codex icon should be blue');
		});

		test('supportsHooks returns true for Claude and false for Codex', () => {
			// Arrange
			const claudeAgent = new ClaudeCodeAgent();
			const codexAgent = new CodexAgent();

			// Act
			const claudeSupportsHooks = claudeAgent.getHookEvents().length > 0;
			const codexSupportsHooks = codexAgent.getHookEvents().length > 0;

			// Assert
			assert.strictEqual(claudeSupportsHooks, true, 'Claude should support hooks (non-empty hook events)');
			assert.strictEqual(codexSupportsHooks, false, 'Codex should not support hooks (empty hook events)');
		});
	});
});
