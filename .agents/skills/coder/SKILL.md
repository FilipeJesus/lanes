---
name: coder
description: Implement features, fix bugs, and make code changes in Lanes. Use for coding tasks that need test planning, implementation, and specialist verification.
---

# Implement Changes

Implement features and fixes across the Lanes core library, VS Code extension, and CLI.

## Your Workflow

### 1. Understand the Task
- Read relevant files to understand the current implementation
- Identify which files need to be modified

### 2. Plan Tests First (MANDATORY)

Before writing ANY code, plan what tests are needed and document them in `tests.json`:

```json
{
  "planned": [
    {
      "id": "test-id",
      "description": "What the test verifies",
      "file": "src/test/session/session-provider.test.ts",
      "suite": "Suite name",
      "priority": "critical|high|medium|low",
      "acceptance_criteria": ["Given X, when Y, then Z"],
      "implemented": false
    }
  ]
}
```

**Rules for tests.json:**
- Create it before writing any implementation code
- Include acceptance criteria for each test
- Set priority (critical tests first)
- All tests start with `implemented: false`
- Delete the file when the task is complete

### 3. Implement Changes

After planning tests:
- Make the necessary code changes using the client's file editing tools
- Follow existing code patterns and style

### 4. Verify with Specialists

**For VS Code API logic** (`src/vscode/`, package.json, TreeDataProvider, commands):
- Apply the [vscode-expert skill](../vscode-expert/SKILL.md)
- Review API correctness, manifest integrity, and proper disposable registration

**For Git/Shell operations** (child_process, path handling, git commands):
- Apply the [shell-ops skill](../shell-ops/SKILL.md)
- Verify path safety, proper quoting, and error handling

If the client supports sub-agents, these reviews can be delegated with the
relevant skill instructions. Otherwise, perform the same checks directly.

### 5. Hand Off to Test Engineer

After implementation:
- Apply the [test-engineer skill](../test-engineer/SKILL.md), directly or through delegation
- Read `tests.json` and implement the planned tests

## Key Files in This Project

- `src/core/` - Platform-independent business logic and code agent implementations
- `src/vscode/extension.ts` - Main extension entry point
- `src/vscode/commands/` and `src/vscode/services/` - Commands and terminal management
- `src/vscode/providers/AgentSessionProvider.ts` - Tree data provider for sidebar
- `src/cli/` - Standalone CLI and platform adapters
- `package.json` - Extension manifest (commands, views, menus)
- `src/test/` - Tests mirroring the source structure

## Constraints

1. **Always plan tests first** - Plan tests before writing any code
2. Always read files before editing them
3. Never skip the relevant specialist checks for non-trivial changes
4. Ensure all changes maintain backward compatibility
5. Keep changes focused and minimal - don't over-engineer
