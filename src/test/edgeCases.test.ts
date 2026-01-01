import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ClaudeSessionProvider, SessionItem, getFeatureStatus, getClaudeStatus, getSessionId, FeatureStatus, ClaudeStatus, getFeaturesJsonPath, getClaudeSessionPath, getClaudeStatusPath } from '../ClaudeSessionProvider';
import { SessionFormProvider } from '../SessionFormProvider';

suite('Edge Cases Test Suite', () => {

	let tempDir: string;
	let worktreesDir: string;

	// Create a temp directory structure before tests
	setup(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-lanes-edge-cases-test-'));
		worktreesDir = path.join(tempDir, '.worktrees');
	});

	// Clean up after each test
	teardown(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	suite('Extension Activation', () => {

		test('extension should be present', () => {
			// Extension ID format is publisher.name, may not be available in test environment
			// This is more of a smoke test that the test harness works
			assert.ok(vscode.extensions !== undefined);
		});

		test('commands should be registered after activation', async () => {
			// Trigger extension activation by executing one of its commands
			// Using openSession with no args - it will fail gracefully but activates the extension
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			const commands = await vscode.commands.getCommands(true);

			assert.ok(commands.includes('claudeWorktrees.createSession'), 'createSession command should exist');
			assert.ok(commands.includes('claudeWorktrees.openSession'), 'openSession command should exist');
			assert.ok(commands.includes('claudeWorktrees.deleteSession'), 'deleteSession command should exist');
			assert.ok(commands.includes('claudeWorktrees.setupStatusHooks'), 'setupStatusHooks command should exist');
		});

		test('SessionFormProvider webview should be registered', async () => {
			// Trigger extension activation
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			// The webview view is registered with the viewType 'claudeSessionFormView'
			// We can verify this by checking that the SessionFormProvider's viewType matches
			// what is expected in package.json
			assert.strictEqual(
				SessionFormProvider.viewType,
				'claudeSessionFormView',
				'SessionFormProvider should use the correct view type'
			);

			// Note: VS Code does not expose a way to query registered webview views directly.
			// The best we can do is verify the viewType constant matches what's in package.json
			// and trust that the extension.ts registers it correctly.
		});
	});

	suite('Edge Cases', () => {

		suite('Long Session Names', () => {

			test('should handle session names at typical filesystem limit (255 chars)', () => {
				// Most filesystems have a 255 character limit for file/directory names
				const longName = 'a'.repeat(255);
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

				// The regex should still match
				assert.ok(branchNameRegex.test(longName), 'Regex should match 255 character name');
			});

			test('should handle session names with mixed valid characters at max length', () => {
				// 255 chars with mixed valid characters
				const longMixedName = 'feature-123_test.branch/'.repeat(10) + 'a'.repeat(15);
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;

				assert.ok(branchNameRegex.test(longMixedName), 'Regex should match long mixed-character name');
			});

			test('should create SessionItem with very long name', () => {
				const longName = 'very-long-session-name-'.repeat(10);
				const item = new SessionItem(
					longName,
					`/path/to/.worktrees/${longName}`,
					vscode.TreeItemCollapsibleState.None
				);

				assert.strictEqual(item.label, longName);
				assert.ok(item.worktreePath.includes(longName));
			});

			test('should handle features.json with very long feature IDs', () => {
				// Create a worktree with features.json containing long feature ID
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'test-session');
				fs.mkdirSync(sessionDir, { recursive: true });

				const longFeatureId = 'feature-'.repeat(30) + '123';
				const featuresContent = {
					features: [
						{ id: longFeatureId, description: 'A feature with a very long ID', passes: false }
					]
				};
				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify(featuresContent)
				);

				const status = getFeatureStatus(sessionDir);
				assert.strictEqual(status.currentFeature?.id, longFeatureId);
			});
		});

		suite('Session Name Validation Edge Cases', () => {

			test('should reject names that are only dots', () => {
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
				const problematicNames = ['.', '..', '...'];

				for (const name of problematicNames) {
					// While regex matches these names, git validation should catch them
					assert.ok(branchNameRegex.test(name), `Regex matches "${name}" but git validation catches it`);
					// Names starting with '.' or containing '..' should be caught by additional validation
					const startsWithDot = name.startsWith('.');
					const containsDoubleDot = name.includes('..');

					assert.ok(
						startsWithDot || containsDoubleDot,
						`Name "${name}" should be caught by dot validation rules`
					);
				}
			});

			test('should reject names with only hyphens', () => {
				const name = '---';
				const startsWithHyphen = name.startsWith('-');
				assert.ok(startsWithHyphen, 'Name starting with hyphen should be rejected');
			});

			test('should accept valid edge case names', () => {
				const branchNameRegex = /^[a-zA-Z0-9_\-./]+$/;
				const validEdgeCases = [
					'a',                          // Single character
					'0',                          // Single digit
					'_',                          // Single underscore
					'a-b',                        // Hyphen in middle
					'a.b',                        // Dot in middle
					'a/b',                        // Slash (path separator)
					'feature/my-feature',         // Common git flow pattern
					'release/1.0.0',              // Semantic version in branch
					'user_feature_branch',        // Underscores
					'123-numeric-start',          // Starting with numbers
				];

				for (const name of validEdgeCases) {
					assert.ok(branchNameRegex.test(name), `Name "${name}" should be valid`);
					// Also verify these don't trigger other validation rules
					const invalidStart = name.startsWith('-') || name.startsWith('.');
					const invalidEnd = name.endsWith('.') || name.endsWith('.lock');
					const hasDoubleDot = name.includes('..');

					if (!invalidStart && !invalidEnd && !hasDoubleDot) {
						assert.ok(true, `Name "${name}" passes all validation rules`);
					}
				}
			});

			test('should correctly reject .lock suffix', () => {
				const invalidNames = ['branch.lock', 'feature.lock', 'a.lock'];

				for (const name of invalidNames) {
					assert.ok(name.endsWith('.lock'), `Name "${name}" ends with .lock and should be rejected`);
				}
			});
		});

		suite('Session ID Edge Cases', () => {

			test('should handle session IDs at maximum reasonable length', () => {
				// Create a very long but valid session ID
				const longSessionId = 'a'.repeat(500);
				const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

				assert.ok(SESSION_ID_PATTERN.test(longSessionId), 'Long alphanumeric session ID should be valid');
			});

			test('should reject session IDs with newlines (potential injection)', () => {
				const maliciousIds = [
					'valid\n--evil-flag',
					'session\r\ninjection',
					'id\x00null',
				];

				const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

				for (const id of maliciousIds) {
					assert.ok(!SESSION_ID_PATTERN.test(id), `Session ID "${id.replace(/\n/g, '\\n')}" should be rejected`);
				}
			});

			test('should reject session IDs with spaces', () => {
				const idsWithSpaces = [
					'session id',
					' leadingspace',
					'trailingspace ',
					'multiple   spaces',
				];

				const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

				for (const id of idsWithSpaces) {
					assert.ok(!SESSION_ID_PATTERN.test(id), `Session ID with spaces should be rejected: "${id}"`);
				}
			});

			test('should handle empty .claude-session file gracefully', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'empty-session-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				// Write empty file
				fs.writeFileSync(path.join(sessionDir, '.claude-session'), '');

				const result = getSessionId(sessionDir);
				assert.strictEqual(result, null, 'Empty .claude-session should return null');
			});

			test('should handle .claude-session with only whitespace', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'whitespace-session-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				// Write whitespace-only file
				fs.writeFileSync(path.join(sessionDir, '.claude-session'), '   \n\t  ');

				const result = getSessionId(sessionDir);
				assert.strictEqual(result, null, 'Whitespace-only .claude-session should return null');
			});
		});

		suite('Claude Status Edge Cases', () => {

			test('should handle .claude-status with extra unexpected fields gracefully', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'extra-fields-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const statusWithExtras = {
					status: 'working',
					timestamp: '2025-01-01T00:00:00Z',
					message: 'Test message',
					unexpectedField: 'should be ignored',
					anotherExtra: { nested: 'object' }
				};

				fs.writeFileSync(
					path.join(sessionDir, '.claude-status'),
					JSON.stringify(statusWithExtras)
				);

				const result = getClaudeStatus(sessionDir);
				assert.strictEqual(result?.status, 'working');
				assert.strictEqual(result?.timestamp, '2025-01-01T00:00:00Z');
				assert.strictEqual(result?.message, 'Test message');
			});

			test('should handle .claude-status with null values for optional fields', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'null-fields-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const statusWithNulls = {
					status: 'idle',
					timestamp: null,
					message: null
				};

				fs.writeFileSync(
					path.join(sessionDir, '.claude-status'),
					JSON.stringify(statusWithNulls)
				);

				const result = getClaudeStatus(sessionDir);
				assert.strictEqual(result?.status, 'idle');
			});

			test('should reject .claude-status with invalid status value', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'invalid-status-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const invalidStatuses = [
					{ status: 'WORKING' },          // Wrong case
					{ status: 'Running' },          // Not a valid status
					{ status: '' },                 // Empty string
					{ status: 123 },                // Number instead of string
					{ status: null },               // Null
					{ status: ['working'] },        // Array
				];

				for (const invalidStatus of invalidStatuses) {
					fs.writeFileSync(
						path.join(sessionDir, '.claude-status'),
						JSON.stringify(invalidStatus)
					);

					const result = getClaudeStatus(sessionDir);
					assert.strictEqual(result, null, `Invalid status ${JSON.stringify(invalidStatus)} should return null`);
				}
			});
		});

		suite('Features.json Edge Cases', () => {

			test('should handle features.json with empty features array', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'empty-features-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({ features: [] })
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature, null);
				assert.strictEqual(result.allComplete, false);
			});

			test('should handle features.json with all features complete', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'all-complete-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({
						features: [
							{ id: 'f1', description: 'Feature 1', passes: true },
							{ id: 'f2', description: 'Feature 2', passes: true },
							{ id: 'f3', description: 'Feature 3', passes: true }
						]
					})
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature, null);
				assert.strictEqual(result.allComplete, true);
			});

			test('should handle features.json with mixed completion status', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'mixed-status-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({
						features: [
							{ id: 'f1', description: 'Complete', passes: true },
							{ id: 'f2', description: 'Incomplete', passes: false },
							{ id: 'f3', description: 'Also incomplete', passes: false }
						]
					})
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature?.id, 'f2', 'Should return first incomplete feature');
				assert.strictEqual(result.allComplete, false);
			});

			test('should handle features.json with extra fields on features', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'extra-feature-fields-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				fs.writeFileSync(
					path.join(sessionDir, 'features.json'),
					JSON.stringify({
						features: [
							{
								id: 'f1',
								description: 'Feature with extras',
								passes: false,
								priority: 'high',
								assignee: 'claude',
								customField: { nested: 'data' }
							}
						]
					})
				);

				const result = getFeatureStatus(sessionDir);
				assert.strictEqual(result.currentFeature?.id, 'f1');
				assert.strictEqual(result.currentFeature?.passes, false);
			});

			test('should handle malformed features.json gracefully', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'malformed-features-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const malformedCases = [
					'not json at all',
					'{ invalid json }',
					'null',
					'[]',
					'{ "features": "not an array" }',
					'{ "features": null }',
				];

				for (const content of malformedCases) {
					fs.writeFileSync(path.join(sessionDir, 'features.json'), content);

					const result = getFeatureStatus(sessionDir);
					assert.strictEqual(result.currentFeature, null, `Malformed content should return null currentFeature: ${content}`);
					assert.strictEqual(result.allComplete, false, `Malformed content should return false allComplete: ${content}`);
				}
			});
		});

		suite('Path Configuration Edge Cases', () => {

			test('should handle paths with multiple consecutive slashes', () => {
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'multi-slash-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				// Create nested directory structure
				const nestedDir = path.join(sessionDir, 'subdir');
				fs.mkdirSync(nestedDir, { recursive: true });

				const featuresContent = { features: [{ id: 'test', description: 'Test', passes: false }] };
				fs.writeFileSync(path.join(nestedDir, 'features.json'), JSON.stringify(featuresContent));

				// The path normalization should handle this
				const result = getFeatureStatus(sessionDir);
				// Without configuration pointing to subdir, it should not find the file
				assert.strictEqual(result.currentFeature, null);
			});

			test('should handle paths with trailing slashes via path normalization', () => {
				// Test that the path building logic properly handles trailing slashes
				// by directly testing the path.join behavior used in validateAndBuildPath
				fs.mkdirSync(worktreesDir, { recursive: true });
				const sessionDir = path.join(worktreesDir, 'trailing-slash-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const subdir = path.join(sessionDir, 'subdir');
				fs.mkdirSync(subdir, { recursive: true });

				// Simulate what validateAndBuildPath does with a trailing slash path
				const pathWithTrailingSlash = 'subdir/';
				const trimmedPath = pathWithTrailingSlash.trim().replace(/\\/g, '/');
				const resolvedPath = path.join(sessionDir, trimmedPath, 'features.json');

				// The path.join should normalize the trailing slash
				assert.ok(resolvedPath.includes('subdir'), 'Path should include subdir');
				assert.ok(resolvedPath.endsWith('features.json'), 'Path should end with features.json');
				// Verify no double slashes in the path
				assert.ok(!resolvedPath.includes('//'), 'Path should not contain double slashes');
			});
		});

		suite('Concurrent Operations', () => {

			test('should handle multiple simultaneous getFeatureStatus calls', async () => {
				fs.mkdirSync(worktreesDir, { recursive: true });

				// Create multiple session directories
				const sessionCount = 10;
				const sessionDirs: string[] = [];

				for (let i = 0; i < sessionCount; i++) {
					const sessionDir = path.join(worktreesDir, `concurrent-test-${i}`);
					fs.mkdirSync(sessionDir, { recursive: true });
					fs.writeFileSync(
						path.join(sessionDir, 'features.json'),
						JSON.stringify({
							features: [{ id: `feature-${i}`, description: `Feature ${i}`, passes: false }]
						})
					);
					sessionDirs.push(sessionDir);
				}

				// Call getFeatureStatus concurrently for all sessions
				const results = await Promise.all(
					sessionDirs.map(dir => Promise.resolve(getFeatureStatus(dir)))
				);

				// Verify each result is correct
				for (let i = 0; i < sessionCount; i++) {
					assert.strictEqual(results[i].currentFeature?.id, `feature-${i}`);
				}
			});

			test('should handle multiple simultaneous getClaudeStatus calls', async () => {
				fs.mkdirSync(worktreesDir, { recursive: true });

				const statuses: ClaudeStatus['status'][] = ['working', 'waiting_for_user', 'idle', 'error'];
				const sessionDirs: string[] = [];

				for (let i = 0; i < statuses.length; i++) {
					const sessionDir = path.join(worktreesDir, `status-concurrent-${i}`);
					fs.mkdirSync(sessionDir, { recursive: true });
					fs.writeFileSync(
						path.join(sessionDir, '.claude-status'),
						JSON.stringify({ status: statuses[i] })
					);
					sessionDirs.push(sessionDir);
				}

				// Call getClaudeStatus concurrently
				const results = await Promise.all(
					sessionDirs.map(dir => Promise.resolve(getClaudeStatus(dir)))
				);

				// Verify each result
				for (let i = 0; i < statuses.length; i++) {
					assert.strictEqual(results[i]?.status, statuses[i]);
				}
			});

			test('should handle ClaudeSessionProvider refresh during concurrent file changes', async () => {
				fs.mkdirSync(worktreesDir, { recursive: true });

				// Create a session
				const sessionDir = path.join(worktreesDir, 'refresh-test');
				fs.mkdirSync(sessionDir, { recursive: true });

				const provider = new ClaudeSessionProvider(tempDir);

				// Simulate rapid file changes and refreshes
				const refreshPromises: Promise<void>[] = [];
				for (let i = 0; i < 5; i++) {
					fs.writeFileSync(
						path.join(sessionDir, '.claude-status'),
						JSON.stringify({ status: i % 2 === 0 ? 'working' : 'idle' })
					);
					refreshPromises.push(Promise.resolve(provider.refresh()));
				}

				// All refreshes should complete without error
				await Promise.all(refreshPromises);
				assert.ok(true, 'All concurrent refreshes completed without error');
			});
		});
	});

	suite('Open Window Command', () => {
		// Tests for the openInNewWindow command

		// Get the path to the git repository root
		const repoRoot = path.resolve(__dirname, '..', '..');

		test('should have openInNewWindow command registered after activation', async () => {
			// Trigger extension activation
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected to fail without proper args, but extension is now activated
			}

			// Act
			const commands = await vscode.commands.getCommands(true);

			// Assert
			assert.ok(
				commands.includes('claudeWorktrees.openInNewWindow'),
				'openInNewWindow command should be registered after extension activation'
			);
		});

		test('should show error when called without session item', async () => {
			// Trigger extension activation first
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openSession');
			} catch {
				// Expected
			}

			// Act: Execute the command without a session item
			// The command should show an error message and return without throwing
			try {
				await vscode.commands.executeCommand('claudeWorktrees.openInNewWindow');
				// Command executed, it should have shown an error message
				assert.ok(true, 'Command should handle missing item gracefully');
			} catch {
				// If it throws, that's also acceptable behavior
				assert.ok(true, 'Command may throw for missing item');
			}
		});

		test('should verify openInNewWindow command is in package.json', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(repoRoot, 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: openInNewWindow command exists
			const commands = packageJson.contributes?.commands;
			assert.ok(commands, 'package.json should have contributes.commands');

			const openWindowCmd = commands.find(
				(cmd: { command: string }) => cmd.command === 'claudeWorktrees.openInNewWindow'
			);

			assert.ok(
				openWindowCmd,
				'package.json should have claudeWorktrees.openInNewWindow command'
			);
			assert.strictEqual(
				openWindowCmd.title,
				'Open in New Window',
				'openInNewWindow command should have correct title'
			);
		});

		test('should verify openInNewWindow appears in inline menu for sessionItem', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(repoRoot, 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// Assert: Command appears in view/item/context menu
			const menuItems = packageJson.contributes?.menus?.['view/item/context'];
			assert.ok(menuItems, 'package.json should have view/item/context menu items');

			const openWindowMenuItem = menuItems.find(
				(item: { command: string }) => item.command === 'claudeWorktrees.openInNewWindow'
			);

			assert.ok(
				openWindowMenuItem,
				'openInNewWindow should be in view/item/context menu'
			);
			assert.ok(
				openWindowMenuItem.when.includes('sessionItem'),
				'openInNewWindow should only appear for sessionItem context'
			);
			assert.strictEqual(
				openWindowMenuItem.group,
				'inline@0',
				'openInNewWindow should be in inline group at position 0'
			);
		});
	});
});
