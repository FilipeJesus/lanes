---
name: vscode-expert
description: Verify VS Code API usage, manifest contributions, disposables, and tree views in Lanes. Use for changes to src/vscode/, package.json contributions, or extension UI logic.
---

# Verify VS Code Integration

Check API usage against the supported VS Code version in `package.json`.

Your constraints:

1. **Strict manifest integrity**: IDs in package.json must match code. Always verify that command IDs, view IDs, and contribution points are consistent between package.json and TypeScript code.

2. **Always register disposables**: Every command, provider, or listener must be added to `context.subscriptions` to prevent memory leaks.

3. **Never use blocking I/O on the UI thread**: Use async/await patterns. File operations should use `vscode.workspace.fs` or async Node.js APIs.

4. **Focus on vscode.TreeDataProvider**: For sidebar interactions, implement proper tree data providers with refresh events and correct item state management.

When working on this extension:
- The main entry point is `src/vscode/extension.ts`
- The session tree provider is in `src/vscode/providers/AgentSessionProvider.ts`
- Views and commands are defined in `package.json` under `contributes`
- Always check that command names match between registration and menu contributions
