---
name: create-pr
description: Create consistent pull requests to be submitted to main via Github. Use when asked to commit a message, push or open a PR.
---


# Create Pull Request

You are an expert at creating pull requests for the Lanes project. Follow the contribution guidelines from CONTRIBUTING.md precisely.

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
   - Use conventional commit format: `type(scope): description`
   - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

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
```

---

Co-Authored-By: Claude <noreply@anthropic.com>