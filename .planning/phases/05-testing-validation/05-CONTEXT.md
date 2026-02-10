# Phase 5: Testing & Validation - Context

**Gathered:** 2026-02-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify the multi-agent system with comprehensive tests and confirm backward compatibility. Fix 4 carried-over security/correctness issues from Phases 2-4 code reviews. No new features — only tests, bug fixes, and validation.

</domain>

<decisions>
## Implementation Decisions

### Carried-over issue fixes
- Fix all 4 carried-over issues IN this phase (before writing tests, so tests cover fixed behavior)
- Command injection in `isCliAvailable()`: Replace `exec()` with `execFile()` to eliminate shell injection entirely (no regex needed)
- Hardcoded `/bin/sh` shell path: Use `shell: true` option to let Node.js resolve the shell automatically
- `AgentStatusState` type missing `'active'`: Add `'active'` to the type union
- Path traversal in `captureSessionId`: Claude's discretion on approach (validate resolved paths or filter filenames)

### Test scope & priorities
- CodexCodeAgent: Test critical paths only — command building, permission mapping, session ID capture, shell escaping, UUID validation. Skip trivial getters (getAgentName, getTerminalIcon, etc.)
- Factory: Test thoroughly including CLI availability check with injection protection — valid commands, malicious inputs, missing CLIs, timeout behavior
- TOML settings format service: Skip testing — unused by Codex currently, test when a feature exercises it
- Session form: Test individual components separately (dropdown rendering, permission toggle, callback) — not full flow

### Test execution strategy
- CodexAgent command building: String construction verification only — assert buildStartCommand()/buildResumeCommand() return correct strings with proper flags and escaping. No real CLI invocation.
- Session ID capture (filesystem polling): Mock fs module with sinon stubs on fs.readdir/fs.readFile to simulate session files appearing. Fast and deterministic.
- Hookless terminal tracking: Mock VS Code terminal events — create mock Terminal objects and fire onDidOpenTerminal/onDidCloseTerminal to test tracking flow

### Backward compatibility
- Test old command aliases: Verify each old `claudeWorktrees.*` command ID maps to the new `lanes.*` command
- Test legacy session data: Verify session files without `agentName` field default to 'claude' and load without errors
- Regression gate: Trust CI (pre-commit hook runs full test suite). No explicit regression step needed.

### Claude's Discretion
- Whether to extract duplicated utility functions (escapeForSingleQuotes, validateSessionId) to base class/shared module before testing, or test in place
- Path traversal fix implementation approach
- Exact mock patterns for terminal event testing
- Test file organization (new test files vs extending existing extension.test.ts)

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Follow existing test patterns in the codebase.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 05-testing-validation*
*Context gathered: 2026-02-10*
