# Session Restart Feature Design

**Date:** 2026-01-19
**Status:** Implemented

## Overview

The session restart feature provides a reliable way to clear conversation context without relying on automatic slash commands. When a workflow step specifies `context: restart`, a fresh Claude session is created with no conversation history while workflow state is preserved.

## Problem Solved

The original `context: clear` feature was broken because Claude cannot automatically execute slash commands like `/clear`. The restart feature achieves the same goal by creating a new session.

## How It Works

1. Workflow step specifies `context: restart`
2. MCP server's `workflow_status` detects the pending restart action
3. MCP server calls `restartSession()` which writes a config file
4. VS Code extension's file watcher detects the config file
5. Extension closes the existing terminal and opens a new one
6. New session has no conversation history
7. SessionStart hook fires, telling Claude to run `workflow_status`
8. Claude reads workflow state and continues from current step

## Usage

### In Workflow YAML

```yaml
steps:
  - id: brainstorm
    type: action
    context: restart
    instructions: |
      Start with a completely fresh perspective.
```

### From Context Menu

Right-click on a session in the sidebar and select "Restart Session".

## Files Modified

- `src/extension.ts` - Added restartSession command and file watcher
- `src/mcp/server.ts` - Added session_restart tool
- `src/mcp/tools.ts` - Added restartSession handler
- `src/workflow/types.ts` - Added 'restart' to StepContextAction
- `package.json` - Added context menu item
