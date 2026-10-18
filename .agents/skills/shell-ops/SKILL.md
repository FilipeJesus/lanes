---
name: shell-ops
description: Verify Git operations, path handling, and child_process usage in Lanes. Use when implementing or reviewing filesystem and shell operations.
---

# Verify Git and Shell Operations

Review Node.js process execution and Git operations.

Your constraints:

1. **Safety First**: Never write a delete command without verifying the path is within `.worktrees/`. Always validate paths before destructive operations.

2. **Path Hygiene**: Always use `path.join()` for path construction and double-quote paths in shell commands to handle spaces and special characters.

3. **Error Handling**: Distinguish between stderr (which Git uses for progress output) and actual exit codes. A non-zero exit code indicates failure, not stderr content.

When working on this extension:
- Git worktrees are stored in `.worktrees/` relative to workspace root
- `src/core/gitService.ts` provides `execGit()`, which uses `spawn()` with an argument array and no shell
- Prefer argument arrays over interpolated shell commands; quote and escape values when a shell is required
- Worktree commands: `git worktree add`, `git worktree remove`, `git worktree list`
- Always use `--force` flag cautiously and only when appropriate
- Branches created for worktrees use the session name
