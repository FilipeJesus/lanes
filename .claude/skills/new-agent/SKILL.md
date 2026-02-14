---
name: new-agent
description: You MUST use the new-agent skill when asked to add a implement a agent in lanes.
---

# New Agent Implementation

You are implementing a new code agent backend for the Lanes VS Code extension.

# IRON LAW: Agent Abstraction

When implementing new agents DO NOT add agent specific logic to any files outside of the `src/codeAgents/<ClassName>.ts` files.

## Step 0: Gather information

Ask the user for:

1. **Agent internal name** - lowercase identifier, e.g. `aider`
2. **Display name** - user-facing label, e.g. `Aider`
3. **CLI command** - shell command that launches the agent, e.g. `aider`
4. **Data directory** - where the agent stores config, e.g. `.aider`
5. **Logo SVG** - inline SVG for the dropdown (ask the user to provide one, or search for the official logo)

Also determine these behavioral traits:

- **Hooks**: Does the CLI emit lifecycle events (SessionStart, Stop, etc.)? If no, it's "hookless" and needs `captureSessionId()` — use `CodexAgent.ts` as reference.
- **Prompt passing**: Positional argument (`cli 'prompt'`) or stdin?
- **MCP support**: If yes, how is config delivered — CLI flag, settings file, or `-c` overrides?
- **Permission modes**: What flags does the CLI accept? (e.g. `--yes`, `--yolo`, `--bypass`)
- **Session ID format**: UUID, numeric index, or something else?
- **Resume support**: Does the CLI support `--resume`? What format?

## Step 1: Study the base class and a reference agent

Read these files to understand the current abstract contract:

- `src/codeAgents/CodeAgent.ts` — the abstract base class defines all required and optional methods, interfaces, and types. **This is the source of truth** for what must be implemented.
- Pick the closest existing agent as reference:
  - **Hook-based with MCP via CLI flag**: `ClaudeCodeAgent.ts`
  - **Hookless with MCP via CLI overrides**: `CodexAgent.ts`
  - **Hook-based with MCP via settings file**: `GeminiAgent.ts`
  - **Hook-based without MCP, stdin prompts**: `CortexCodeAgent.ts`

## Step 2: Create the agent class

Create `src/codeAgents/<ClassName>.ts` using the reference agent from Step 1 as a template. Implement every abstract method from `CodeAgent.ts` and override optional base class methods as needed based on the agent's capabilities.

## Step 3: Register the agent

1. **Factory** (`src/codeAgents/factory.ts`): add import and entry to `agentConstructors` map
2. **Barrel** (`src/codeAgents/index.ts`): add export for the new class
3. **Settings schema** (`package.json`): add to `lanes.defaultAgent` enum and enumDescriptions

No UI changes are needed — the dropdown derives from `getAvailableAgents()` + `getAgent()` automatically.

## Step 4: Write tests

Create `src/test/codeAgents/<name>-agent.test.ts` following the pattern in an existing test file (e.g. `gemini-agent.test.ts`). Cover: config values, command building, session/status parsing, permission modes, terminal config, hooks, and MCP.

## Constraints

- `sessionFileExtension` MUST be `.claude-session` and `statusFileExtension` MUST be `.claude-status` — all agents share these filenames and existing sessions depend on them.
- Session IDs MUST be validated against a strict regex before use in shell commands (command injection prevention).
- Prompt text MUST be escaped when embedded in shell commands.

## Verification

1. `npm run compile` — no TypeScript errors
2. `npm run lint` — no lint errors
3. `npm test` — all tests pass
4. Manual: create a session with the new agent in Extension Development Host (F5)
