# Claude Harness

For long-running agent sessions that span multiple context windows, we recommend setting up a **Claude Harness** - a structured approach to task management that helps Claude maintain continuity across sessions.

This pattern is based on Anthropic's research on [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## Why Use a Harness?

Each new Claude session begins with no memory of what came before. A harness solves this by:

- **Defining scope** - A structured feature list prevents over-ambition and premature completion claims
- **Tracking progress** - Clear pass/fail status for each feature
- **Enabling handoffs** - Fresh sessions can quickly assess the current state

## Setting Up Your Harness

Add the following instructions to your project's `CLAUDE.md` file (or create one in your repository root):

```markdown
## Task Planning

When starting a new task, create a `features.json` file to track all features:

\`\`\`json
{
  "features": [
    {
      "id": "unique-feature-id",
      "description": "What needs to be implemented",
      "passes": false
    }
  ]
}
\`\`\`

### Rules:
- Break down the user's request into discrete, testable features
- All features start with `passes: false`
- Work on one feature at a time
- Only set `passes: true` after the feature is fully implemented and tested
- Commit changes after completing each feature
- Delete `features.json` when the task is complete
```

## Required Fields

Claude Lanes expects the following structure in `features.json`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `features` | array | Yes | Array of feature objects |
| `features[].id` | string | Yes | Unique identifier for the feature |
| `features[].description` | string | Yes | What needs to be implemented |
| `features[].passes` | boolean | Yes | Whether the feature is complete |

> **Note:** Your harness can include additional fields (e.g., `priority`, `dependencies`, `assignee`) - Claude Lanes only requires the fields listed above. Feel free to extend the schema to suit your workflow.

## Example Workflow

1. **User requests**: "Add user authentication with login and logout"
2. **Claude creates** `features.json`:
   ```json
   {
     "features": [
       { "id": "login-form", "description": "Create login form UI", "passes": false },
       { "id": "auth-api", "description": "Implement authentication API endpoint", "passes": false },
       { "id": "logout", "description": "Add logout functionality", "passes": false },
       { "id": "session-persistence", "description": "Persist user session across page reloads", "passes": false }
     ]
   }
   ```
3. **Claude works** on each feature incrementally, marking `passes: true` as each is completed
4. **On completion**, Claude deletes the file and updates progress notes

## Combining with Progress Tracking

For even better continuity, add a `claude-progress.txt` file that Claude updates at the end of each session:

```markdown
## Session: 2025-01-15

### Completed
- Implemented login form UI
- Created authentication API endpoint

### Next Steps
- Add logout functionality
- Test session persistence
```

This gives new sessions immediate context about what's been accomplished.
