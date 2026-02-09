# Codebase Concerns

**Analysis Date:** 2025-02-09

## Tech Debt

**Large Files - Complexity & Maintainability:**
- Issue: Several files exceed 1000 lines, making them difficult to navigate and test
- Files: `src/GitChangesPanel.ts` (1348 lines), `src/test/integration/mcp-workflow.test.ts` (744 lines), `src/SessionFormProvider.ts` (629 lines), `src/workflow/state.ts` (600 lines), `src/mcp/server.ts` (537 lines)
- Impact: Reduces readability, increases cognitive load, makes refactoring risky, harder to isolate bugs
- Fix approach: Split large files into focused modules (e.g., GitChangesPanel rendering separate from comment logic), extract test utilities to shared helpers

**Multiple File Watchers - Potential Performance Impact:**
- Issue: `src/watchers.ts` creates 9+ file system watchers that all call `sessionProvider.refresh()` on any change
- Files: `src/watchers.ts` (lines 45-162)
- Impact: Watching `.claude-status` and `.claude-session` separately means duplicate refresh calls; multiple watchers on overlapping patterns could cause unnecessary tree rebuilds; scales poorly with many sessions
- Fix approach: Consolidate related watchers (e.g., combine status/session watchers), implement debouncing before refresh(), lazy-load watchers only for monitored sessions

**Event Listener Accumulation in GitChangesPanel:**
- Issue: Event listeners added to DOM elements in IIFE without cleanup mechanism
- Files: `src/GitChangesPanel.ts` (lines 1300-1343: addEventListener calls inside getHtml())
- Impact: If the webview is recreated multiple times, listeners accumulate; clicking buttons multiple times could trigger duplicate actions
- Fix approach: Implement cleanup before attaching new listeners, or use event delegation on a single parent element

**Unvalidated Command-Line Arguments in MCP Server:**
- Issue: While paths are validated for absolute/yaml extension, no symlink traversal or permission checks
- Files: `src/mcp/server.ts` (lines 30-80)
- Impact: Malicious workflow files could potentially reference files outside intended directories if not carefully constructed
- Fix approach: Use `safeResolve()` from `src/validation/pathSanitizer.ts` to validate workflow paths are within allowed directories

## Known Bugs

**Empty Catch Blocks Masking Errors:**
- Symptoms: Operations fail silently without logging useful information
- Files: `src/services/SettingsService.ts` (line 337: `.catch(() => {})`), `src/services/FileService.ts` (line 27: `.catch(() => {})`)
- Trigger: When `fsPromises.unlink()` fails in cleanup operations
- Workaround: Check logs for context, but the specific error is lost
- Fix approach: Log the error before silently continuing: `.catch((err) => console.warn('Cleanup failed:', err))`

**Session Creation Race Condition - Partial Mitigation:**
- Symptoms: Multiple rapid session creations may create duplicate branches or fail inconsistently
- Files: `src/services/SessionService.ts` (sessionCreationQueue), `src/AsyncQueue.ts`
- Trigger: User creates sessions faster than git can process them
- Current mitigation: `AsyncQueue` serializes operations with 30s timeout (lines 40-100 in AsyncQueue.ts)
- Issue: Timeout is fixed; network/disk latency could exceed it, causing orphaned sessions
- Fix approach: Make timeout configurable per operation, increase default to 60s, add better error recovery

**Broken Worktree Detection Only on Extension Startup:**
- Symptoms: After container rebuilds, broken worktrees exist but aren't detected until extension reload
- Files: `src/extension.ts` (lines 95-97: only called in activate())
- Trigger: Container rebuild, git metadata directory removal
- Workaround: Reload VS Code window
- Fix approach: Add periodic check (e.g., on-demand via command) or watch for missing .git metadata directories

## Security Considerations

**Path Sanitization for Display Only:**
- Risk: `sanitizeForDisplay()` is used for display but similar logic not applied to file operations
- Files: `src/validation/pathSanitizer.ts` (lines 71-103, explicit comment on line 71: "WARNING: for display ONLY")
- Current mitigation: File operations use `safeResolve()` which validates paths properly
- Recommendations: Audit all file system operations to ensure they use `safeResolve()` before accepting user input, add type safety to prevent misuse of `sanitizeForDisplay()` in path contexts

**Webview Content Security Policy:**
- Risk: GitChangesPanel uses nonce-based CSP but could be vulnerable to script injection if template strings not properly escaped
- Files: `src/GitChangesPanel.ts` (uses html template literals starting line 700+)
- Current mitigation: `_escapeHtml()` used in `SessionFormProvider.ts` but no evidence it's used in GitChangesPanel HTML generation
- Recommendations: Ensure ALL user-provided content in webviews is properly escaped, consider HTML sanitization library

**Git Command Injection Prevention:**
- Risk: Low - commands use `spawn()` not shell, arguments passed as array
- Files: `src/gitService.ts` (line 79: `spawn(gitPath, args, spawnOptions)`)
- Current mitigation: Arguments are array-based, not shell-injected
- Recommendations: Continue this pattern, document that args MUST be array, never allow shell: true

**Environment Variable Propagation:**
- Risk: Custom env vars passed to git process could leak sensitive values
- Files: `src/gitService.ts` (lines 75-76: merges process.env)
- Current mitigation: Only custom settings propagated, not full environment
- Recommendations: Whitelist safe variables, never propagate SSH_AUTH_SOCK or similar sensitive env vars

## Performance Bottlenecks

**Diff Parsing in GitChangesPanel:**
- Problem: Full diff parsing happens on every branch change; parsing complex diffs with thousands of lines could block UI
- Files: `src/GitChangesPanel.ts` (rendering 1348-line component)
- Cause: No caching of parsed diffs, no pagination/lazy-loading of hunks
- Improvement path: Cache parsed diffs by (worktreePath, baseBranch), implement virtual scrolling for large diffs, show only first N hunks with "show more" button

**File System Watcher Refresh Storms:**
- Problem: When git operations create multiple status changes, each triggers sessionProvider.refresh() separately
- Files: `src/watchers.ts` (multiple handlers each call refresh())
- Cause: No debouncing between watcher events
- Improvement path: Implement debounced refresh (e.g., batch updates for 100ms), track which sessions changed to refresh only affected items

**Global Storage Path Generation:**
- Problem: Repo identifier computed via sha256 hash; global storage lookups happen on every session access
- Files: `src/ClaudeSessionProvider.ts` (lines 54-56: getRepoIdentifier)
- Cause: Hash computed fresh each time, could be cached
- Improvement path: Cache repo identifier in memory after first computation, consider pre-computing during initialization

**Workflow State Machine Serialization:**
- Problem: Entire workflow definition snapshot stored in state on every advance (lines 48-49 in `src/workflow/state.ts`)
- Cause: Deep copy via JSON.parse(JSON.stringify()) is expensive for large workflows
- Impact: For multi-step workflows with many artefacts, state file size grows linearly
- Improvement path: Store only changed fields in state diff, load full definition from YAML on resume, implement state compression

## Fragile Areas

**Workflow State Resumption Logic:**
- Files: `src/mcp/server.ts` (lines 93-132), `src/workflow/state.ts` (lines 29-58)
- Why fragile: Complex fallback logic (saved snapshot → YAML file → null) is error-prone; if workflow_definition is corrupted in state file, fallback to YAML may succeed but produce inconsistent behavior
- Safe modification: Always validate workflow_definition structure matches template schema before using; add explicit versioning to detect schema changes
- Test coverage: `src/test/workflow/workflow-resume.test.ts` covers basic resume, but gaps exist for corrupted state recovery

**Session Form Webview Message Passing:**
- Files: `src/SessionFormProvider.ts` (lines 140-250+: resolveWebviewView, postMessage handlers)
- Why fragile: Message protocol is string-based (`command: 'updateWorkflows'`) without schema validation; adding new messages requires changes in both extension and webview code
- Safe modification: Define explicit message types/interfaces for all webview↔extension messages, validate message shape before processing
- Test coverage: Limited integration tests between form and extension

**Worktree Path Resolution in Settings Service:**
- Files: `src/services/SettingsService.ts` (lines 40-80: getBaseRepoPath)
- Why fragile: Complex git dir parsing with string operations; edge cases around symlinks or relative paths in .git/config could break detection
- Safe modification: Add comprehensive path normalization, test against symlinked worktrees and circular git directories
- Test coverage: `src/test/core/extension-settings-location.test.ts` exists but needs more edge cases

## Scaling Limits

**Session Creation Queue Timeout:**
- Current capacity: 30 second timeout per session creation
- Limit: Network latency + git operation time; on slow drives/networks, timeout fires and orphans session
- Scaling path: Make timeout configurable (extension setting), implement exponential backoff, queue overflow handling for >100 pending sessions

**File System Watchers:**
- Current capacity: ~9 watchers created regardless of session count
- Limit: No issue at 1-5 sessions, but each session may add watcher patterns; 50+ concurrent sessions could overwhelm watcher infrastructure
- Scaling path: Lazy-load watchers only for active sessions, consolidate watcher patterns, use single watcher for all .claude-* files

**Global Storage Path Lookup:**
- Current capacity: Computed on every session access via getGlobalStoragePath()
- Limit: No caching; 100+ sessions means 100+ hash computations per refresh
- Scaling path: Cache baseRepoPath→repoIdentifier mapping in memory, load once during extension activation

**Diff Content Generation:**
- Current capacity: Entire diff parsed for display on every branch change
- Limit: Diffs >100KB become sluggish; no pagination
- Scaling path: Lazy-load hunks, cache recent diffs, implement server-side diff caching with branch history

## Dependencies at Risk

**@modelcontextprotocol/sdk (^1.25.2):**
- Risk: Major version range allows updates; 2.x could have breaking changes
- Impact: Workflow execution would break if MCP server API changes
- Migration plan: Pin to exact version (1.25.2), monitor npm changelog, create integration tests that fail fast on API changes

**YAML Parser (yaml ^2.8.2):**
- Risk: Used to load user-provided workflow files; YAML deserialization can execute code in some contexts
- Impact: Malicious .yaml files could potentially execute code
- Current mitigation: safe mode not explicitly enabled
- Recommendations: Verify yaml library is used in safe mode, sanitize workflow files before parsing, consider stricter validation schema

**TypeScript (^5.9.3) & ESLint (^9.39.1):**
- Risk: Major version ranges; breaking changes in linting rules could cause build failures
- Impact: Pre-commit hooks enforce linting; new rules could block all commits
- Recommendations: Document which linting rules are disabled/enabled, periodically review new rule additions, consider moving to exact versions

## Missing Critical Features

**No Workflow Rollback:**
- Problem: If workflow fails midway, no easy way to restart from specific step or undo state changes
- Blocks: Teams can't safely experiment with long workflows
- Priority: Medium - affects user experience for complex workflows

**No Session Snapshot/Restore:**
- Problem: Deleting a session permanently loses all work; no backup mechanism
- Blocks: Users risk losing work if delete is accidental or system fails during session
- Priority: High - affects data safety

**No Concurrent Session Limits:**
- Problem: Can create unlimited sessions, could exhaust disk/memory
- Blocks: Shared systems can degrade for all users
- Priority: Medium - affects multi-user scenarios

**No Workflow Dry-Run Mode:**
- Problem: No way to test workflow structure without executing actual steps
- Blocks: Developers can't validate workflows before deploying
- Priority: Medium - affects workflow development workflow

## Test Coverage Gaps

**Session Deletion Edge Cases:**
- What's not tested: Deleting session while workflow is running, deleting session with uncommitted changes in worktree
- Files: `src/commands/sessionCommands.ts` (lines 149-200), missing test for concurrent delete + workflow execution
- Risk: Could leave orphaned git objects, corrupted state files, or lost work
- Priority: High - data integrity

**Broken Worktree Repair Concurrency:**
- What's not tested: Repairing worktrees while extension is active and session is running
- Files: `src/services/BrokenWorktreeService.ts`, `src/extension.ts` (async repair call)
- Risk: Repair process could conflict with active session operations
- Priority: High - could corrupt sessions

**Webview Message Deserialization:**
- What's not tested: Invalid or malformed messages from webview, messages arriving out of order
- Files: `src/SessionFormProvider.ts` (message handlers)
- Risk: Crashes or unexpected behavior if webview sends malformed data
- Priority: Medium - stability

**Git Error Recovery:**
- What's not tested: Partial git failures (e.g., success creating branch but fail linking worktree), network interruptions during clone
- Files: `src/gitService.ts`, error handling in session creation
- Risk: Orphaned git objects, inconsistent state
- Priority: Medium - recovery scenarios

**Path Sanitization Edge Cases:**
- What's not tested: Symlinks in paths, UNC paths on Windows, relative paths with many `..` segments
- Files: `src/validation/pathSanitizer.ts`, file operations
- Risk: Path traversal or security bypass on edge platforms
- Priority: Medium - security

**Workflow State Machine with Loops:**
- What's not tested: Complex loop scenarios (nested loops, loop with conditional steps), resuming from within loop
- Files: `src/workflow/state.ts` (loop handling), `src/test/workflow/` (limited loop coverage)
- Risk: State corruption when resuming after interrupt in loop
- Priority: Medium - functionality

**Global Storage Migration:**
- What's not tested: Migrating from useGlobalStorage=false to true with existing sessions
- Files: `src/ClaudeSessionProvider.ts`, settings migration logic
- Risk: Sessions become orphaned or duplicated during migration
- Priority: Low - edge case but should be handled

---

*Concerns audit: 2025-02-09*
