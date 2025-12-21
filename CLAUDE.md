# Claude Orchestra - Development Guidelines

## Project Overview

Claude Orchestra is a VS Code extension that manages isolated Claude Code sessions using Git worktrees. Each session gets its own worktree and dedicated terminal.

## Key Files

- `src/extension.ts` - Main entry point, commands, terminal management
- `src/ClaudeSessionProvider.ts` - Tree data provider for the sidebar
- `package.json` - Extension manifest (commands, views, menus, keybindings)
- `src/test/extension.test.ts` - Test suite

## Development Workflow

When implementing features or fixing bugs, follow this workflow:

### 1. Plan

Before writing any code:
- Understand the requirements fully
- Identify which files need to be modified
- Break down the work into discrete tasks
- Use the TodoWrite tool to track tasks

### 2. Implement (per task)

For each task that requires code changes, delegate to the **coder** agent:

```
Use the coder agent to: [describe the specific task]
```

The coder agent will:
- Make the necessary code changes
- Consult with `vscode-expert` for VS Code API logic
- Consult with `shell-ops` for git/shell operations

### 3. Test (per task)

After each task is implemented, delegate to the **test-engineer** agent:

```
Use the test-engineer agent to: verify and add tests for [the changes just made]
```

The test-engineer will:
- Write or update unit tests
- Ensure proper test coverage
- Verify tests pass

### 4. Review (per task)

After testing, delegate to the **code-reviewer** agent:

```
Use the code-reviewer agent to: review the changes made for [task]
```

The code-reviewer will:
- Check code quality and style
- Identify potential issues
- Suggest improvements

### 5. Repeat

Continue with the next task until all tasks are complete.

## Agent Summary

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `coder` | Primary implementation | Each coding task |
| `vscode-expert` | VS Code API verification | Called by coder for API logic |
| `shell-ops` | Git/shell safety checks | Called by coder for shell ops |
| `test-engineer` | Test writing and verification | After each coding task |
| `code-reviewer` | Code quality review | After each task is tested |

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
