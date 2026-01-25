# Simplify Lanes Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify Lanes configuration to use a fixed `.lanes/session_management/` path when global storage is disabled, removing the complex `claudeSessionPath` and `claudeStatusPath` settings.

**Architecture:** Replace configurable path settings with a simple `useGlobalStorage` toggle. When disabled, session files (.claude-status, .claude-session) are stored in `.lanes/session_management/<sessionName>/` at the repository root. When enabled, current global storage behavior is preserved.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js fs/path modules, Mocha test framework

---

## Overview

This implementation removes the `claudeSessionPath` and `claudeStatusPath` configuration settings and replaces them with a fixed `.lanes/session_management/` path structure when global storage is disabled.

### Changes Summary

1. **Remove configuration settings**: `claudeSessionPath`, `claudeStatusPath`
2. **Update path resolution**: When `useGlobalStorage` is false, use `.lanes/session_management/<sessionName>/`
3. **Update package.json**: Remove deprecated settings from configuration
4. **Update tests**: Remove tests for custom paths, add tests for new path structure

### File Structure

**Global storage enabled (default, unchanged):**
```
globalStorageUri/<repoIdentifier>/<sessionName>/.claude-status
globalStorageUri/<repoIdentifier>/<sessionName>/.claude-session
```

**Global storage disabled (new simplified approach):**
```
.lanes/session_management/<sessionName>/.claude-status
.lanes/session_management/<sessionName>/.claude-session
```

---

## Task 1: Update ClaudeSessionProvider.ts - Path Resolution Functions

**Files:**
- Modify: `src/ClaudeSessionProvider.ts:287-329`

**Step 1: Add new constant for non-global storage path**

```typescript
// After line 23 (after other constants), add:
/**
 * Fixed path for non-global session storage (relative to repo root)
 */
const NON_GLOBAL_SESSION_PATH = '.lanes/session_management';
```

**Step 2: Update getClaudeSessionPath for non-global mode**

Replace the function body (lines 287-303) with:

```typescript
export function getClaudeSessionPath(worktreePath: string): string {
    // Determine the session file name
    const sessionFileName = globalCodeAgent?.getSessionFileName() || '.claude-session';

    // Check if global storage is enabled
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, sessionFileName);
        if (globalPath) {
            return globalPath;
        }
        // Fall back to non-global path if global storage not initialized
    }

    // Non-global mode: use fixed .lanes/session_management path
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, sessionFileName);
}
```

**Step 3: Update getClaudeStatusPath for non-global mode**

Replace the function body (lines 313-329) with:

```typescript
export function getClaudeStatusPath(worktreePath: string): string {
    // Determine the status file name
    const statusFileName = globalCodeAgent?.getStatusFileName() || '.claude-status';

    // Check if global storage is enabled
    if (isGlobalStorageEnabled()) {
        const globalPath = getGlobalStoragePath(worktreePath, statusFileName);
        if (globalPath) {
            return globalPath;
        }
        // Fall back to non-global path if global storage not initialized
    }

    // Non-global mode: use fixed .lanes/session_management path
    const sessionName = getSessionNameFromWorktree(worktreePath);
    const baseRepoPath = getBaseRepoPathForStorage() || worktreePath;
    return path.join(baseRepoPath, NON_GLOBAL_SESSION_PATH, sessionName, statusFileName);
}
```

**Step 4: Remove validateAndBuildPath function**

The `validateAndBuildPath` function (lines 244-277) is no longer needed since paths are now fixed. Delete the entire function.

**Step 5: Run compile to verify TypeScript**

```bash
npm run compile
```

Expected: No TypeScript errors

**Step 6: Commit**

```bash
git add src/ClaudeSessionProvider.ts
git commit -m "refactor: simplify session path resolution to use fixed .lanes/session_management path when global storage is disabled"
```

---

## Task 2: Update package.json - Remove Deprecated Configuration

**Files:**
- Modify: `package.json:233-244`

**Step 1: Remove claudeSessionPath configuration**

Delete lines 233-237 (claudeSessionPath property):
```json
          "lanes.claudeSessionPath": {
            "type": "string",
            "default": "",
            "description": "Relative path for .claude-session file within each worktree. Only used when Use Global Storage is disabled. Leave empty for worktree root",
            "order": 2
          },
```

**Step 2: Remove claudeStatusPath configuration**

Delete lines 239-243 (claudeStatusPath property):
```json
          "lanes.claudeStatusPath": {
            "type": "string",
            "default": "",
            "description": "Relative path for .claude-status file within each worktree. Only used when Use Global Storage is disabled. Leave empty for worktree root",
            "order": 3
          },
```

**Step 3: Update useGlobalStorage description**

Replace line 230 with updated description:

```json
            "description": "Store session tracking files in VS Code's global storage. When enabled, files are stored in VS Code storage. When disabled, files are stored in .lanes/session_management/ at the repository root. Default: enabled",
```

**Step 4: Update localSettingsPropagation order**

Change line 255 from `"order": 4` to `"order": 2` (since we removed 2 properties):

```json
            "order": 2
```

**Step 5: Verify package.json is valid**

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('package.json', 'utf8')))"
```

Expected: No errors, valid JSON output

**Step 6: Commit**

```bash
git add package.json
git commit -m "refactor: remove claudeSessionPath and claudeStatusPath configuration settings"
```

---

## Task 3: Update extension.ts - Remove Configuration Update References

**Files:**
- Modify: `src/extension.ts` (find and remove references to removed config)

**Step 1: Search for references to removed configs**

```bash
grep -n "claudeSessionPath\|claudeStatusPath" src/extension.ts
```

Expected: Find any remaining references

**Step 2: Remove any config update calls for deprecated settings**

If found in extension.ts (likely in session creation code around line 2279-2300), remove lines that update these configs.

**Step 3: Run compile**

```bash
npm run compile
```

Expected: No errors

**Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "refactor: remove references to deprecated claudeSessionPath and claudeStatusPath settings"
```

---

## Task 4: Update Tests - Remove Custom Path Tests

**Files:**
- Modify: `src/test/configuration.test.ts:54-301`

**Step 1: Remove the 'Configurable Claude Session and Status Paths' test suite**

Delete lines 54-301 (the entire suite for configurable paths).

**Step 2: Run tests to verify removal**

```bash
npm test -- src/test/configuration.test.ts
```

Expected: Tests pass (the removed suite is no longer run)

**Step 3: Commit**

```bash
git add src/test/configuration.test.ts
git commit -m "refactor(tests): remove tests for deprecated configurable path settings"
```

---

## Task 5: Add Tests - Non-Global Path Structure

**Files:**
- Create: `src/test/configuration.test.ts` (add new test suite after line 53)

**Step 1: Add new test suite for non-global session management path**

After line 53 (after the setup/teardown functions), add:

```typescript
	suite('Non-Global Session Management Path', () => {

		let tempDir: string;

		setup(async () => {
			tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-global-test-'));
			// Disable global storage for these tests
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', false, vscode.ConfigurationTarget.Global);
			// Initialize global storage context with tempDir as base repo
			const mockUri = vscode.Uri.file(path.join(os.tmpdir(), 'vscode-mock-global-storage'));
			fs.mkdirSync(mockUri.fsPath, { recursive: true });
			initializeGlobalStorageContext(mockUri, tempDir);
		});

		teardown(async () => {
			// Reset configuration after each test
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', undefined, vscode.ConfigurationTarget.Global);
			fs.rmSync(tempDir, { recursive: true, force: true });
		});

		test('should return .lanes/session_management path when useGlobalStorage is false for getClaudeStatusPath', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			// Act
			const result = getClaudeStatusPath(worktreePath);

			// Assert: Should return .lanes/session_management path
			const expectedPath = path.join(tempDir, '.lanes', 'session_management', 'test-session', '.claude-status');
			assert.strictEqual(result, expectedPath, 'Should use fixed .lanes/session_management path');
		});

		test('should return .lanes/session_management path when useGlobalStorage is false for getClaudeSessionPath', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, '.worktrees', 'my-feature');

			// Act
			const result = getClaudeSessionPath(worktreePath);

			// Assert: Should return .lanes/session_management path
			const expectedPath = path.join(tempDir, '.lanes', 'session_management', 'my-feature', '.claude-session');
			assert.strictEqual(result, expectedPath, 'Should use fixed .lanes/session_management path');
		});

		test('should create session-specific subdirectories within .lanes/session_management', async () => {
			// Arrange
			const session1Path = path.join(tempDir, '.worktrees', 'session-a');
			const session2Path = path.join(tempDir, '.worktrees', 'session-b');

			// Act
			const status1 = getClaudeStatusPath(session1Path);
			const status2 = getClaudeStatusPath(session2Path);

			// Assert: Each session should have its own subdirectory
			assert.ok(status1.includes('session-a'), 'Session A path should include session-a subdirectory');
			assert.ok(status2.includes('session-b'), 'Session B path should include session-b subdirectory');
			assert.ok(status1.includes('.lanes/session_management'), 'Should include .lanes/session_management path');
			assert.ok(status2.includes('.lanes/session_management'), 'Should include .lanes/session_management path');
		});

		test('should read and write session files from .lanes/session_management when useGlobalStorage is false', async () => {
			// Arrange
			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');
			const statusPath = getClaudeStatusPath(worktreePath);

			// Act: Write a status file
			const sessionDir = path.dirname(statusPath);
			fs.mkdirSync(sessionDir, { recursive: true });
			const statusData = {
				status: 'waiting_for_user',
				timestamp: '2026-01-21T10:00:00Z',
				message: 'Test status'
			};
			fs.writeFileSync(statusPath, JSON.stringify(statusData));

			// Assert: Read it back using getClaudeStatus
			const result = getClaudeStatus(worktreePath);
			assert.ok(result, 'Should read status from .lanes/session_management');
			assert.strictEqual(result.status, 'waiting_for_user');
			assert.strictEqual(result.message, 'Test status');
		});

		test('should fall back to global storage when useGlobalStorage is true', async () => {
			// Arrange: Enable global storage
			const config = vscode.workspace.getConfiguration('lanes');
			await config.update('useGlobalStorage', true, vscode.ConfigurationTarget.Global);

			const globalStorageDir = path.join(os.tmpdir(), 'test-global-storage');
			const mockUri = vscode.Uri.file(globalStorageDir);
			initializeGlobalStorageContext(mockUri, tempDir);

			const worktreePath = path.join(tempDir, '.worktrees', 'test-session');

			// Act
			const result = getClaudeStatusPath(worktreePath);

			// Assert: Should return global storage path
			assert.ok(result.startsWith(globalStorageDir), 'Should use global storage when enabled');
		});
	});
```

**Step 2: Run the new tests**

```bash
npm test -- src/test/configuration.test.ts --grep "Non-Global Session Management Path"
```

Expected: All new tests pass

**Step 3: Commit**

```bash
git add src/test/configuration.test.ts
git commit -m "test: add tests for non-global .lanes/session_management path structure"
```

---

## Task 6: Update Package.json Configuration Tests

**Files:**
- Modify: `src/test/configuration.test.ts:796-836`

**Step 1: Update 'should verify Advanced section contains correct settings' test**

Replace lines 796-836 with:

```typescript
		test('should verify Advanced section contains correct settings', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const advancedSection = getConfigSection(packageJson.contributes.configuration, 'Lanes: Advanced');

			// Assert: Advanced section should exist
			assert.ok(advancedSection, 'Advanced section should exist');

			// Assert: Advanced section should contain expected settings (claudeSessionPath and claudeStatusPath removed)
			const expectedSettings = [
				'lanes.useGlobalStorage',
				'lanes.localSettingsPropagation'
			];

			for (const setting of expectedSettings) {
				assert.ok(
					advancedSection.properties?.[setting],
					`Advanced section should contain ${setting}`
				);
			}

			// Assert: Settings should have correct order (1-2, updated after removing 2 settings)
			assert.strictEqual(
				advancedSection.properties['lanes.useGlobalStorage'].order,
				1,
				'useGlobalStorage should have order 1'
			);
			assert.strictEqual(
				advancedSection.properties['lanes.localSettingsPropagation'].order,
				2,
				'localSettingsPropagation should have order 2 (was 4, now 2 after removing 2 settings)'
			);
		});
```

**Step 2: Update 'should verify Advanced section does not contain deprecated settings' test**

Add a new test after the above test:

```typescript
		test('should verify Advanced section does not contain deprecated settings', () => {
			// Read and parse package.json from the project root
			const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			const advancedSection = getConfigSection(packageJson.contributes.configuration, 'Lanes: Advanced');

			// Assert: Deprecated settings should NOT exist
			assert.ok(
				!advancedSection.properties?.['lanes.claudeSessionPath'],
				'Advanced section should NOT contain deprecated claudeSessionPath'
			);
			assert.ok(
				!advancedSection.properties?.['lanes.claudeStatusPath'],
				'Advanced section should NOT contain deprecated claudeStatusPath'
			);
		});
```

**Step 3: Update 'should verify all setting default values are preserved' test**

Remove lines 1000-1012 (claudeSessionPath and claudeStatusPath default checks).

**Step 4: Update 'should verify settings have user-friendly descriptions' test**

Remove lines 1031-1032 (claudeSessionPath and claudeStatusPath description checks) and update the expectedDescriptions object.

**Step 5: Run tests**

```bash
npm test -- src/test/configuration.test.ts
```

Expected: All tests pass

**Step 6: Commit**

```bash
git add src/test/configuration.test.ts
git commit -m "test: update configuration tests after removing deprecated settings"
```

---

## Task 7: Update Security Validation Tests

**Files:**
- Modify: `src/test/configuration.test.ts` (remove path security tests for custom paths)

**Step 1: Remove security validation tests for custom paths**

Delete tests that verify rejection of path traversal and absolute paths for `claudeSessionPath` and `claudeStatusPath` (lines 186-248 in original file).

These tests are no longer needed since paths are now fixed to `.lanes/session_management/`.

**Step 2: Run tests**

```bash
npm test -- src/test/configuration.test.ts
```

Expected: All tests pass

**Step 3: Commit**

```bash
git add src/test/configuration.test.ts
git commit -m "test: remove security validation tests for deprecated configurable paths"
```

---

## Task 8: Run Full Test Suite

**Files:**
- Test: All test files

**Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

**Step 2: Run lint**

```bash
npm run lint
```

Expected: No lint errors

**Step 3: Fix any issues**

If any tests or lint fail, fix them and commit.

**Step 4: Final commit if fixes were needed**

```bash
git add .
git commit -m "test: fix issues found during full test suite run"
```

---

## Task 9: Documentation Update

**Files:**
- Create: `docs/plans/2026-01-21-simplify-config-migration-guide.md`

**Step 1: Create migration guide for users**

Create a new document explaining the changes:

```markdown
# Lanes Configuration Simplification - Migration Guide

## What Changed?

The `lanes.claudeSessionPath` and `lanes.claudeStatusPath` configuration settings have been removed.

## New Behavior

### When `lanes.useGlobalStorage` is enabled (default):
Session files are stored in VS Code's global storage (unchanged).

### When `lanes.useGlobalStorage` is disabled:
Session files are now stored in a fixed location:
```
.lanes/session_management/<sessionName>/.claude-status
.lanes/session_management/<sessionName>/.claude-session
```

## Migration Steps

If you previously set custom `claudeSessionPath` or `claudeStatusPath`:

1. Open VS Code Settings (search for "lanes")
2. Note your current settings if needed for reference
3. Your settings will be automatically removed
4. Session files will be stored in the new location

### Manual Migration (if needed)

If you need to preserve existing session files:

1. Navigate to your repository root
2. Move session files from your custom location to `.lanes/session_management/<sessionName>/`

Example:
```bash
mkdir -p .lanes/session_management/my-session
mv .worktrees/my-session/.claude-status .lanes/session_management/my-session/
mv .worktrees/my-session/.claude-session .lanes/session_management/my-session/
```

## Benefits

- **Simpler configuration**: No need to configure individual paths
- **Consistent structure**: All session files in one known location
- **Easier debugging**: Predictable file locations
```

**Step 2: Commit documentation**

```bash
git add docs/plans/2026-01-21-simplify-config-migration-guide.md
git commit -m "docs: add migration guide for configuration simplification"
```

---

## Task 10: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (create or update)

**Step 1: Add changelog entry**

```markdown
# Changelog

## [Unreleased]

### Changed
- Simplified session storage configuration when global storage is disabled
- Session files now use fixed `.lanes/session_management/<sessionName>/` path structure
- Updated `lanes.useGlobalStorage` description to clarify non-global behavior

### Removed
- `lanes.claudeSessionPath` configuration setting
- `lanes.claudeStatusPath` configuration setting

### Migration
- Users with custom `claudeSessionPath` or `claudeStatusPath` settings will need to move session files to the new location
- See migration guide in docs/plans/2026-01-21-simplify-config-migration-guide.md
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add changelog entry for configuration simplification"
```

---

## Verification Steps

After completing all tasks:

1. **Test global storage mode:**
   - Set `lanes.useGlobalStorage` to `true`
   - Create a new session
   - Verify files are in VS Code global storage

2. **Test non-global mode:**
   - Set `lanes.useGlobalStorage` to `false`
   - Create a new session
   - Verify files are in `.lanes/session_management/<sessionName>/`

3. **Test session switching:**
   - Create multiple sessions in both modes
   - Verify status tracking works correctly

4. **Test existing sessions:**
   - Open existing sessions
   - Verify they still work with new path resolution

---

## Notes

- The `validateAndBuildPath` function is removed as it's no longer needed
- Security is maintained by using a fixed path structure that doesn't allow user input
- The `.lanes/session_management/` directory structure keeps session files organized and separate from worktree content
- Global storage behavior remains unchanged for backward compatibility
