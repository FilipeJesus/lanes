# Lanes - Development Guidelines

## Project Overview

Lanes is a VS Code extension that manages isolated Claude Code sessions using Git worktrees. Each session gets its own worktree and dedicated terminal.

## Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Main entry point, commands, terminal management |
| `src/ClaudeSessionProvider.ts` | Tree data provider for the sidebar |
| `package.json` | Extension manifest (commands, views, menus, keybindings) |
| `src/test/extension.test.ts` | Test suite |
| `claude-progress.txt` | Session progress tracking (persisted) |
| `workflow-state.json` | Workflow state managed by MCP tools (created during workflows) |
| `tests.json` | **Agent-managed** - Test plan created by coder, implemented by test-engineer |

## Workflow System

Lanes uses a structured workflow system managed by MCP tools. When a workflow is active, tasks are tracked in `workflow-state.json`.

### Starting a Workflow

Use the `workflow_start` MCP tool to initialize a workflow. This creates the `workflow-state.json` file.

### Task Management

Tasks are managed through MCP workflow tools:
- `workflow_set_tasks` - Define tasks for the current workflow
- `workflow_advance` - Complete the current step and move to the next
- `workflow_status` - Get current workflow position and progress
- `workflow_context` - Get outputs from previous steps

## Agent Summary

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `coder` | Plan tests + implement features | Each coding task |
| `vscode-expert` | VS Code API verification | Called by coder |
| `shell-ops` | Git/shell safety checks | Called by coder |
| `test-engineer` | Implement planned tests | After each feature |
| `code-reviewer` | Code quality review | After tests pass |

## Test Planning with tests.json

The `tests.json` file is an ephemeral file managed by agents (not the Lanes extension):

1. **Coder creates it** before implementing any code
2. **Test-engineer reads it** to implement the planned tests
3. **Delete it** when the task is complete

### tests.json Format

```json
{
  "planned": [
    {
      "id": "test-id",
      "description": "What the test verifies",
      "file": "src/test/extension.test.ts",
      "suite": "Suite name",
      "priority": "critical|high|medium|low",
      "acceptance_criteria": ["Given X, when Y, then Z"],
      "implemented": false
    }
  ]
}
```

### Workflow

1. **Coder** plans tests and creates `tests.json` with `implemented: false`
2. **Coder** implements the feature
3. **Test-engineer** implements each test and sets `implemented: true`
4. When all tests pass, delete `tests.json`

## Progress Tracking (Persisted)

### claude-progress.txt

Update at the end of each session:

```
## Session: [Date]

### Completed
- [What was accomplished]

### Next Steps
- [What should be done next]
```

## Constraints

- Always run tests before committing: `npm test`
- Pre-commit hook enforces: compile, lint, and test
- Never commit code that breaks existing tests
- Keep changes focused and minimal

## Common Commands

```bash
# Development
npm run compile          # Compile TypeScript
npm run watch           # Watch mode
npm run lint            # Run ESLint
npm test                # Run full test suite

# Debugging
# Press F5 in VS Code to launch Extension Development Host
```
