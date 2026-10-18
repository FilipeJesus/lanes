---
name: initializer
description: Set up a fresh Lanes development checkout and create initial progress tracking. Use for first-run setup or a requested reset of setup tracking.
---

# Initialize Development Setup

Set up the development environment on first run.

## When to Use

Use this skill when:
- Starting work on a fresh clone
- Progress tracking files don't exist
- Resetting the project state

## Setup Tasks

### 1. Create agent-progress.txt

Keep an existing `agent-progress.txt`. If only `claude-progress.txt` exists,
rename it to `agent-progress.txt` and preserve its contents. If neither exists,
create the progress tracking file:

```markdown
# Lanes - Development Progress

## Session: [Current Date]

### Completed
- Initial project setup

### In Progress
- None

### Next Steps
- Review existing features
- Identify next feature to implement

### Blockers
- None
```

### 2. Verify Project State

Run these checks:
- `npm ci` - Install dependencies from the lockfile
- `npm run compile` - Verify TypeScript compiles
- `npm test` - Verify tests pass

### 3. Create Initial Commit (if needed)

If the task includes creating a commit and the progress file is new, stage and commit it:
```bash
git add agent-progress.txt
git commit -m "chore: initialize progress tracking file"
```

## Constraints

- Only create files that don't already exist
- Never overwrite existing progress data
- If `claude-progress.txt` exists, preserve its contents when migrating it to `agent-progress.txt`; do not replace it with the initial template
- Verify npm test passes before completing
