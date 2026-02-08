# Architecture

**Analysis Date:** 2026-02-08

## Pattern Overview

**Overall:** Event-driven extension with provider pattern and session management

**Key Characteristics:**
- VS Code extension with tree view providers for different UI components
- Git worktrees for isolated Claude Code sessions
- Session lifecycle management through tree views
- Workflow system with state machines
- MCP server integration for remote agent communication
- Project management with persistence

## Layers

**Extension Layer (`extension.ts`):**
- Purpose: Main entry point, command registration, lifecycle management
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/extension.ts`
- Contains: Command handlers, session initialization, workspace setup
- Depends on: VS Code APIs, provider services, git service
- Used by: VS Code extension host, user commands

**Provider Layer:**
- Purpose: Tree data providers for sidebar views
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/ClaudeSessionProvider.ts`
- Contains: Session management, tree view data, state persistence
- Depends on: VS Code APIs, code agents, file system
- Used by: Extension layer, tree views

**Session Management Layer:**
- Purpose: Session lifecycle and workflow coordination
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/SessionFormProvider.ts`
- Contains: Session creation, workflow integration, permission handling
- Depends on: VS Code APIs, code agents, git service
- Used by: Extension layer, providers

**Agent Layer:**
- Purpose: Code execution and communication with Claude
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/codeAgents/`
- Contains: Agent implementations, session data, status management
- Depends on: MCP tools, VS Code APIs, file system
- Used by: Session management, extension layer

**Workflow Layer:**
- Purpose: Workflow execution and state management
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/workflow/`
- Contains: State machine, workflow templates, validation
- Depends on: File system, MCP tools
- Used by: Session management, extension layer

**MCP Integration Layer:**
- Purpose: Communication with MCP server
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/mcp/`
- Contains: Tool implementations, state persistence
- Depends on: File system, HTTP client
- Used by: Agent layer, workflow layer

**Git Service Layer:**
- Purpose: Git operations and worktree management
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/gitService.ts`
- Contains: Git command execution, worktree operations
- Depends on: Git CLI, file system
- Used by: Extension layer, session management

**UI Layer:**
- Purpose: Webview panels and user interaction
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/GitChangesPanel.ts`
- Contains: Git diff display, review comments, clipboard operations
- Depends on: VS Code webviews, markdown renderer
- Used by: Extension layer, user interactions

## Data Flow

**Session Creation Flow:**

1. User triggers session creation via command or UI
2. Extension validates parameters and creates worktree
3. Git service creates new branch/worktree
4. Session provider registers new session
5. Code agent initializes Claude connection
6. Session becomes available in tree view

**Workflow Execution Flow:**

1. User selects workflow or specifies custom workflow
2. Workflow template is validated and loaded
3. State machine initializes with workflow template
4. MCP workflow_start is called to create initial state
5. Tasks are set via MCP workflow_set_tasks
6. Execution progresses via workflow_advance
7. State is persisted to workflow-state.json

**Git Changes Flow:**

1. Session makes changes to worktree
2. Git service detects changes in worktree
3. Git changes panel displays diff
4. User can review and copy changes
5. Changes can be applied to base branch

## Key Abstractions

**Session Management:**
- Purpose: Abstract Claude Code sessions with isolation
- Examples: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/ClaudeSessionProvider.ts`
- Pattern: Singleton with map of active sessions

**Code Agents:**
- Purpose: Interface with Claude Code for execution
- Examples: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/codeAgents/ClaudeCodeAgent.ts`
- Pattern: Abstract factory with concrete implementations

**Workflow State Machine:**
- Purpose: Manage workflow execution state
- Examples: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/workflow/state.ts`
- Pattern: State machine with persistence

**Tree Providers:**
- Purpose: Provide data for VS Code tree views
- Examples: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/ClaudeSessionProvider.ts`
- Pattern: VS Code TreeDataProvider interface

**MCP Tools:**
- Purpose: Communication with external MCP server
- Examples: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/mcp/tools.ts`
- Pattern: Tool functions with state persistence

## Entry Points

**Extension Activation:**
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/extension.ts` - `activate()` function
- Triggers: VS Code startup, workspace open
- Responsibilities: Initialize providers, register commands, set up event listeners

**Session Commands:**
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/extension.ts` - Command handlers
- Triggers: User via palette, keyboard shortcuts, UI buttons
- Responsibilities: Create, delete, open sessions

**Tree View Providers:**
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/ClaudeSessionProvider.ts`
- Triggers: UI interactions, session changes
- Responsibilities: Provide session data, handle tree events

**MCP Communication:**
- Location: `/Users/filipejesus/Documents/repos/ai-agent-extension/claude-orchestra/src/mcp/tools.ts`
- Triggers: Workflow execution, agent communication
- Responsibilities: Send commands, receive responses, manage state

## Error Handling

**Strategy:** Centralized error handling with user feedback

**Patterns:**
- Try-catch blocks in command handlers
- Error logging via VS Code output channel
- User notifications via VS Code message API
- Graceful degradation for missing dependencies
- Validation for user inputs

## Cross-Cutting Concerns

**Logging:** VS Code Output API for extension logs, console for debugging
**Validation:** Input validation with descriptive error messages
**Authentication:** Git integration via VS Code Git extension
**Persistence:** JSON files for session state, worktree persistence
**Configuration:** VS Code settings for extension configuration

---

*Architecture analysis: 2026-02-08*
*