---
name: create-pr
description: Prepare commits, pushes, and GitHub pull requests for Lanes following its contribution guidelines. Use when the user requests a commit, push, or pull request; perform only the requested actions.
---
# Create Pull Request

Follow the contribution guidelines in the repository's `CONTRIBUTING.md`. Carry
out only the commit, push, and pull request actions included in the user's request.

## Prerequisites

Before creating a PR, ensure:
1. All tests pass: `npm run lint && npm test`
2. Documentation is updated if changes affect user-facing behavior
3. Tests are included for any new functionality
4. Branch follows naming convention:
   - `feat-` - New features
   - `fix-` - Bug fixes
   - `refactor-` - Code refactoring
   - `docs-` - Documentation changes
   - `test-` - Test additions

## Process

1. **Check current state**
   - Run `git status` to see current changes
   - Run `npm run lint && npm test` to verify everything passes
   - If tests fail, fix them before proceeding

2. **Check branch name**
   - Verify current branch follows the naming convention
   - If not, ask the user to provide the appropriate branch name

3. **Commit changes** (if not already committed)
   - This project enforces [Conventional Commits](https://www.conventionalcommits.org/) via commitlint (commit-msg hook)
   - Format: `type(scope): description`
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`
   - Examples: `feat: add tmux terminal backend`, `fix(sessions): prevent duplicate worktree creation`

4. **Push to remote**
   - Push the current branch to the fork/remote

5. **Create PR using gh CLI**
   - Base branch: `main`
   - Fill in the PR description with:
     - Clear description of changes
     - Related issues (if any)
     - Testing performed
     - Screenshots (if applicable)

6. **Verify PR creation**
   - Confirm the PR was created successfully
   - Provide the PR URL to the user

## PR Description Template

```markdown
## Summary
[Brief description of changes]

## Changes
- [List key changes]

## Related Issues
Closes #[issue_number] (if applicable)

## Testing
- [Describe testing performed]
- All tests pass: `npm run lint && npm test`

## Checklist
- [ ] Code follows project standards
- [ ] Tests are included and passing
- [ ] Documentation is updated (if applicable)
- [ ] No breaking changes without discussion
- [ ] Commit history is clean
```

## Important Notes

- Never push to `main` directly
- Always create a feature branch first
- Ensure CI checks pass before marking as ready for review
- Address review feedback promptly
