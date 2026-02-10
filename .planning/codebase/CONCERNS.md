# Codebase Concerns

**Analysis Date:** 2026-02-10

## Tech Debt

**Memory Leaks in Icon State Tracking:**
- Issue: `previousIconState` Map in `ClaudeSessionProvider.ts` grows unbounded and never clears deleted sessions
- Files: `src/ClaudeSessionProvider.ts` (line 33)
- Impact: Extension memory grows over session lifetime; worktrees with the same paths will accumulate stale entries when deleted/recreated
- Fix approach: Implement session cleanup that removes entries from `previousIconState` when worktrees are deleted via `sessionProvider.dispose()` or add a cleanup during `ClaudeSessionProvider` destruction

**Unbounded Warning Suppression Sets:**
- Issue: `warnedMergeBaseBranches` Set in both `src/services/SessionService.ts` (line 67) and `src/commands/sessionCommands.ts` never clears warnings across session creations
- Files: `src/services/SessionService.ts`, `src/commands/sessionCommands.ts`
- Impact: After many session creations, these Sets grow unbounded, consuming memory without bound
- Fix approach: Implement Set size limits (e.g., LRU eviction after 1000 entries) or clear Sets on extension reload; alternatively reset on session cleanup

**Global State Management Fragility:**
- Issue: Multiple global variables (`globalStorageUri`, `baseRepoPathForStorage`, `globalCodeAgent`, `globalExtensionContext`) in `ClaudeSessionProvider.ts` (lines 26-30) lack thread-safety guarantees
- Files: `src/ClaudeSessionProvider.ts`
- Impact: Race conditions possible if initialization functions called concurrently during activation; stale references if extension reloads
- Fix approach: Use lazy initialization with locking, or refactor to dependency injection pattern to avoid global mutation

**Inconsistent Error Handling Patterns:**
- Issue: Some async operations suppress errors silently with empty `.catch(() => {})` blocks; others log warnings; some throw
- Files: `src/services/FileService.ts`, `src/services/SettingsService.ts`, `src/watchers.ts` (line 78-80, 186-188)
- Impact: Silent failures make debugging difficult; inconsistent error visibility across codebase
- Fix approach: Establish error handling conventions (log + notify user vs. silent vs. throw) and apply consistently; create error categorization (recoverable vs. fatal)

## Known Bugs

**Session Creation Loop Infinite on Invalid Input:**
- Issue: `SessionService.createSession()` has an infinite `while(true)` loop that continues on branch existence with user choice; if dialog is cancelled after name input, loop exits but with early throw outside queue context
- Files: `src/services/SessionService.ts` (lines 244-361)
- Impact: User can get stuck if repeatedly cancelling; unclear how cancellation is handled from queue context vs. direct throw
- Workaround: Users should explicitly cancel from initial dialog to prevent re-prompting
- Fix approach: Refactor loop to explicit retry counter with max attempts; ensure all exit paths (cancel, error, success) are handled uniformly within queue

**Race Condition in Session Deletion:**
- Issue: `sessionCommands.ts` deletes worktree directory asynchronously via `checkAndRepairBrokenWorktrees` but session provider refresh happens immediately, potentially listing deleted sessions if file I/O is slow
- Files: `src/commands/sessionCommands.ts`
- Impact: Brief UI flicker showing deleted sessions; if concurrent creates happen, stale directory references possible
- Fix approach: Wait for deletion completion before refreshing provider; use promise sequencing rather than fire-and-forget

**Missing Error Context in Async Operations:**
- Issue: Many async operations in watchers (e.g., `checkPendingSessions` at line 196 in `watchers.ts`) lack error handling or context propagation
- Files: `src/watchers.ts` (line 194-196)
- Impact: If pending session processing fails, no user notification occurs; error only logged to console
- Fix approach: Add try-catch wrapper with vscode.window error notification for user-facing operations

## Security Considerations

**Session Name Validation Bypass Risk:**
- Risk: Session names are sanitized then validated, but sanitization might produce valid names from invalid inputs; path traversal through carefully crafted input possible if validation regex has gaps
- Files: `src/services/SessionService.ts` (lines 252-278), `src/validation.ts`
- Current mitigation: Validation uses `validateSessionName()` which checks for `..` and `/`; git branch name rules applied
- Recommendations: Add explicit deny list for dangerous patterns (e.g., `.git`, `.git/`, `HEAD`, `MERGE_HEAD`); test with adversarial inputs like `../../../etc/passwd`

**Unvalidated File Paths in Attachments:**
- Risk: File attachment paths in session prompt are listed but never validated for existence or accessibility; paths could reference sensitive files
- Files: `src/services/SessionService.ts` (lines 169-189)
- Current mitigation: Paths are included as plain text in prompt (no file contents), so only disclosure of path names, not secrets
- Recommendations: Validate attachments point within workspace root; warn user if paths outside workspace; sanitize paths in prompt to prevent prompt injection

**Git Command Injection Potential:**
- Risk: Branch names and worktree paths passed to `execGit()` via `spawn()` without shell; input validated but complex patterns (e.g., paths with spaces or special chars) might be mishandled
- Files: `src/gitService.ts` (execGit function uses spawn with array args - safe)
- Current mitigation: Using `spawn()` with array arguments prevents shell injection; branch names validated with regex
- Recommendations: Continue using spawn; add unit tests for branch names with spaces, unicode, and special characters

**Atomic File Write Race Condition:**
- Risk: Temporary file approach (`writeJson` writes to `.tmp`, then renames) in `ProjectManagerService.ts` (lines 189-191) has TOCTOU (time-of-check-time-of-use) gap if multiple processes write simultaneously
- Files: `src/ProjectManagerService.ts` (lines 189-191), `src/services/SettingsService.ts` (atomic write pattern)
- Current mitigation: Temp filename includes timestamp; rename is atomic on most filesystems
- Recommendations: Use more robust locking mechanism (flock) for Project Manager writes; add collision retry logic; document that concurrent writes may corrupt projects.json

## Performance Bottlenecks

**Directory Tree Traversal on Every Status Change:**
- Problem: `getSessionsInDir()` in `ClaudeSessionProvider.ts` reads entire `.worktrees` directory and stat-checks each entry on every status file change (via watchers)
- Files: `src/ClaudeSessionProvider.ts` (lines 426-440), `src/watchers.ts` (status watcher fires on every change)
- Cause: Watcher pattern triggers full tree refresh; no caching or incremental updates
- Improvement path: Implement incremental updates (only refresh changed sessions); cache session list with invalidation on worktree folder changes only (not status changes)

**Global Storage Status File Watching Overhead:**
- Problem: When global storage enabled, extension watches both worktree locations AND global storage locations for same files, triggering double refreshes
- Files: `src/watchers.ts` (lines 73-103)
- Cause: Two separate watchers registered for `.claude-status` and `.claude-session` in different paths
- Improvement path: De-duplicate watched locations; single watcher should refresh provider once; merge results from both paths

**File I/O in Hot Path:**
- Problem: `getClaudeStatus()` reads `.claude-status` file on every tree item render; no caching between renders
- Files: `src/ClaudeSessionProvider.ts` (lines 221-238)
- Cause: Tree provider calls this for every session on every refresh without caching
- Improvement path: Cache status by worktree path with TTL (5-10 seconds); invalidate cache on watcher events only

**Workflow State Machine Persistence Serialization:**
- Problem: Full workflow state (including all task definitions) written to disk on every state change (advance, set_tasks)
- Files: `src/mcp/tools.ts` (lines 41, 89, 146)
- Cause: `saveState()` called after every operation without throttling
- Improvement path: Batch writes with debounce; only persist on step completion, not intermediate mutations

## Fragile Areas

**Broken Worktree Repair Complex State Machine:**
- Files: `src/services/BrokenWorktreeService.ts`
- Why fragile: Multi-step repair process (rename → create → copy → cleanup) with partial failure modes; if process crashes mid-repair, backup directory left orphaned; rollback logic incomplete
- Safe modification: Add pre-repair validation that all prerequisites exist (branch, space for temp directory); add cleanup recovery function to remove orphaned backup directories; test with power-failure simulations
- Test coverage: No test for mid-repair failure scenarios; no test for `copyDirectoryContents` with permission errors; `copyDirectory` function defined but never used (dead code)

**AsyncQueue Timeout Handling:**
- Files: `src/AsyncQueue.ts` (lines 43-74)
- Why fragile: `Promise.race()` between task and timeout doesn't properly cancel the underlying task; if long-running operation times out, it continues running in background consuming resources; resolve/reject called twice possible in edge cases
- Safe modification: Use AbortSignal to propagate cancellation to task; ensure task cleans up on abort; add tests for timeout scenarios
- Test coverage: No existing tests for timeout behavior; no verification that timed-out tasks don't leak

**Session Form State Synchronization:**
- Files: `src/SessionFormProvider.ts` (843 lines)
- Why fragile: Complex state management between webview and extension with potential desync if messages are lost; workflow list updates asynchronously and may race with form submission
- Safe modification: Implement message sequencing/ordering; add timeout for async updates; validate form data completeness before submission
- Test coverage: Limited tests for form submission race conditions

## Scaling Limits

**Extension Activation with Many Worktrees:**
- Current capacity: No documented limits; tested behavior unknown for 100+ worktrees
- Limit: As worktree count grows, `getSessionsInDir()` becomes O(n) slower; UI tree rendering slows; status file watching multiplies overhead
- Scaling path: Implement pagination/lazy-loading in session list; watch only active session status files; implement background scanning with result caching

**Global Storage Directory Growth:**
- Current capacity: No cleanup of old session files; prompts, status, session files accumulate indefinitely
- Limit: After months of use, global storage directory can grow to 100MB+; VS Code startup may slow
- Scaling path: Implement session file TTL/garbage collection (archive files older than 30 days); add "cleanup old sessions" command; monitor storage size

**MCP Server Message Queue:**
- Current capacity: Single MCP server process per workflow; no backpressure mechanism
- Limit: If Claude sends many rapid tool calls, they're queued in memory; no documented max queue size
- Scaling path: Document MCP server memory limits; implement request timeout/dropping if queue grows too large

## Dependencies at Risk

**MCP SDK Version Lock:**
- Risk: `@modelcontextprotocol/sdk` pinned to `^1.25.2`; new versions may introduce breaking changes in server protocol
- Impact: Extension may break silently if SDK changes type signatures or tool signatures
- Migration plan: Monitor MCP SDK changelog; test new versions against workflows in CI before updating

**YAML Parser (yaml@2.8.2):**
- Risk: If workflow YAML files are user-editable, malformed YAML can cause parser to hang or consume unbounded memory
- Impact: User creates workflow with deeply nested structures → MCP server crashes
- Migration plan: Add YAML validation before parsing (depth limit, size limit); consider using schema validation library

**Missing Dependency on VS Code Git Extension:**
- Risk: Extension declares hard dependency on `vscode.git` but gracefully degrades if unavailable
- Impact: If Git extension disabled/missing, git operations fail with unclear error messages; no fallback documented
- Migration plan: Test behavior with Git extension disabled; improve error messages to suggest enabling extension

## Missing Critical Features

**No Session Rollback/Undo:**
- Problem: If session creation fails midway (git error, Project Manager error), partial state left behind (e.g., orphaned branch); no automatic rollback
- Blocks: Users cannot cleanly recover from failed session creation
- Fix: Implement transactional session creation with rollback on any step failure

**No Session State Exports:**
- Problem: Session data (prompts, status, workflow state) scattered across global storage and worktrees; no way to export/archive session
- Blocks: Users cannot backup or share session progress
- Fix: Add export command that bundles session files; consider session archiving for cleanup

**No Concurrent Session Creation Limits:**
- Problem: AsyncQueue allows unlimited concurrent git operations in theory; git may fail if repo locks are held
- Blocks: Rapid session creation can exhaust system resources
- Fix: Add explicit concurrency limit (e.g., max 3 sessions creating simultaneously); add backpressure notification

## Test Coverage Gaps

**Worktree Deletion Edge Cases:**
- What's not tested: Deletion with uncommitted changes, deletion with active git operations, deletion of read-only worktrees
- Files: `src/commands/sessionCommands.ts` (deleteSession command)
- Risk: Silent failures or data loss if edge cases not handled
- Priority: High

**AsyncQueue Failure Scenarios:**
- What's not tested: Task timeout recovery, multiple concurrent timeouts, error propagation up the queue
- Files: `src/AsyncQueue.ts`
- Risk: Queue becomes unresponsive if errors aren't properly handled; subsequent tasks stuck
- Priority: High

**MCP Server Crash Recovery:**
- What's not tested: MCP server process crash during workflow; workflow state corruption; recovery from partial state
- Files: `src/mcp/server.ts`
- Risk: Workflow left in inconsistent state after server crash
- Priority: High

**File Permission Errors:**
- What's not tested: Creating sessions on read-only filesystems, global storage directory without write permissions, worktree on network drive with latency
- Files: `src/services/SessionService.ts`, `src/services/BrokenWorktreeService.ts`
- Risk: Unclear error messages; partial session creation without cleanup
- Priority: Medium

**Concurrent Configuration Changes:**
- What's not tested: User changes `lanes.useGlobalStorage` setting while sessions are being created; race between config change and worktree initialization
- Files: `src/extension.ts` (configuration change handler at line 198)
- Risk: Sessions created in inconsistent storage locations
- Priority: Medium

**Workflow State File Corruption:**
- What's not tested: Corrupted `workflow-state.json`, truncated JSON, invalid state transitions recovered from disk
- Files: `src/mcp/tools.ts`, `src/workflow/state.ts`
- Risk: Workflow cannot resume; user loses progress
- Priority: High

---

*Concerns audit: 2026-02-10*
