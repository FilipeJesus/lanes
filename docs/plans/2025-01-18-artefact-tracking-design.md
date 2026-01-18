# Artefact Tracking Feature Design

**Date:** 2025-01-18
**Status:** Design Approved
**Feature:** Workflow Artefact Tracking for Lanes

## Overview

The Artefact Tracking feature allows workflow steps to register output files (artefacts) which are tracked in the global workflow state. This enables the system to maintain a record of all files created during workflow execution.

## Requirements

1. **Workflow Schema:** Add optional `artefacts: boolean` field to step definitions
2. **State Management:** Track artefacts in `workflow-state.json`
3. **MCP Tool:** New `register_artefacts` tool for registering files
4. **Instruction Injection:** Auto-inject registration instructions when `artefacts: true`
5. **Response Handling:** Return artefacts in `workflow_start` and `workflow_status` responses

## Architecture

### Files Modified

| File | Changes |
|------|---------|
| `src/workflow/types.ts` | Add `artefacts` to step and state types |
| `src/workflow/state.ts` | Implement artefact registration in state machine |
| `src/workflow/loader.ts` | Parse `artefacts` field from YAML |
| `src/mcp/tools.ts` | Add `workflowRegisterArtefacts()` helper |
| `src/mcp/server.ts` | Register `register_artefacts` MCP tool |

### Type Definitions

```typescript
// src/workflow/types.ts

export interface WorkflowStep {
  id: string;
  type: 'action' | 'loop' | 'ralph';
  agent?: string;
  instructions?: string;
  n?: number;
  artefacts?: boolean;  // NEW: Enable artefact tracking for this step
}

export interface WorkflowState {
  status: 'running' | 'complete' | 'failed';
  step: string;
  stepType: 'action' | 'loop' | 'ralph';
  task?: TaskContext;
  subStep?: string;
  ralphIteration?: number;
  tasks: Record<string, Task[]>;
  outputs: Record<string, string>;
  summary?: string;
  artefacts: string[];  // NEW: Tracked artefact paths (absolute)
}

export interface WorkflowStatusResponse {
  status: 'running' | 'complete' | 'failed';
  step: string;
  stepType: 'action' | 'loop' | 'ralph';
  task?: TaskStatusContext;
  subStep?: string;
  subStepIndex?: number;
  totalSubSteps?: number;
  ralphIteration?: number;
  ralphTotal?: number;
  agent: string | null;
  delegate?: boolean;
  instructions: string;
  progress: WorkflowProgress;
  artefacts?: string[];  // NEW: Current artefacts list
}
```

## Implementation Details

### 1. State Machine (`src/workflow/state.ts`)

**Initialization:**
```typescript
private createInitialState(): WorkflowState {
  const firstStep = this.template.steps[0];
  const state: WorkflowState = {
    status: 'running',
    step: firstStep.id,
    stepType: firstStep.type,
    tasks: {},
    outputs: {},
    artefacts: [],  // NEW: Start with empty array
  };

  if (firstStep.type === 'ralph') {
    state.ralphIteration = 1;
  }

  return state;
}
```

**Registration Method:**
```typescript
/**
 * Registers artefact paths created during the current step.
 * @param paths - Array of file paths (absolute or relative to workspace)
 * @returns Object with registered, duplicates, and invalid paths
 */
registerArtefacts(paths: string[]): {
  registered: string[];
  duplicates: string[];
  invalid: string[];
} {
  const workspaceRoot = process.cwd();
  const registered: string[] = [];
  const duplicates: string[] = [];
  const invalid: string[] = [];

  for (const rawPath of paths) {
    // Validate input
    if (typeof rawPath !== 'string' || !rawPath.trim()) {
      invalid.push(rawPath);
      continue;
    }

    // Resolve to absolute path
    const absolutePath = path.isAbsolute(rawPath)
      ? rawPath
      : path.resolve(workspaceRoot, rawPath);

    // Validate file exists
    if (!fs.existsSync(absolutePath)) {
      invalid.push(absolutePath);
      continue;
    }

    // Check for duplicates
    if (!this.state.artefacts.includes(absolutePath)) {
      this.state.artefacts.push(absolutePath);
      registered.push(absolutePath);
    } else {
      duplicates.push(absolutePath);
    }
  }

  return { registered, duplicates, invalid };
}
```

**Instruction Injection:**
```typescript
private getCurrentInstructions(): string {
  const step = this.getCurrentStep();
  let instructions = '';

  // Build base instructions based on step type
  if (step.type === 'action') {
    instructions = step.instructions || '';
  }
  if (step.type === 'ralph') {
    instructions = step.instructions || '';
  }

  // Loop step handling...
  const loopStep = this.getCurrentLoopStep();
  if (loopStep) {
    // ... existing interpolation logic ...
  }

  // NEW: Inject artefact instruction if enabled
  if (step.artefacts === true) {
    instructions += '\n\n' +
      'You are expected to create output files during this step. ' +
      'Once you have created a file, you MUST call the `register_artefacts` tool ' +
      'with the path to the file(s). Do not stop the step without registering your work.';
  }

  // Agent delegation
  const agent = this.getCurrentAgent();
  if (agent !== null) {
    instructions = `SPAWN the '${agent}' sub-agent to handle this step:\n\n${instructions}`;
  }

  return instructions;
}
```

**Status Response:**
```typescript
getStatus(): WorkflowStatusResponse {
  // ... existing logic ...

  const response: WorkflowStatusResponse = {
    status: 'running',
    step: this.state.step,
    stepType: this.state.stepType,
    agent,
    delegate: agent !== null,
    instructions,
    progress,
    artefacts: [...this.state.artefacts],  // NEW: Include artefacts
  };

  // ... rest of existing logic ...

  return response;
}
```

### 2. MCP Tool Handler (`src/mcp/tools.ts`)

```typescript
/**
 * Registers artefact paths for the current workflow.
 * @param machine - The workflow state machine
 * @param paths - Array of file paths to register
 * @param worktreePath - The worktree root path for state persistence
 * @returns Result with registered, duplicate, and invalid paths
 */
export async function workflowRegisterArtefacts(
  machine: WorkflowStateMachine,
  paths: string[],
  worktreePath: string
): Promise<{ registered: string[]; duplicates: string[]; invalid: string[] }> {
  const result = machine.registerArtefacts(paths);

  // Persist state after registration
  await saveState(worktreePath, machine.getState());

  return result;
}
```

### 3. MCP Server Tool Registration (`src/mcp/server.ts`)

```typescript
{
  name: 'register_artefacts',
  description:
    'Register output files (artefacts) created during the current workflow step. ' +
    'These files will be tracked in the workflow state and visible in status responses.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      paths: {
        type: 'array',
        description: 'List of file paths (absolute or relative to workspace) to register as artefacts',
        items: { type: 'string' },
      },
    },
    required: ['paths'],
  },
}
```

**Handler:**
```typescript
case 'register_artefacts': {
  if (!machine) {
    throw new Error('Workflow not started. Call workflow_start first.');
  }

  if (!Array.isArray(toolArgs?.paths)) {
    throw new Error('paths must be an array');
  }

  const paths: string[] = toolArgs.paths.map((p: unknown) => {
    if (typeof p !== 'string') {
      throw new Error('Each path must be a string');
    }
    return p;
  });

  const result = await tools.workflowRegisterArtefacts(machine, paths, worktreePath);

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
```

### 4. YAML Loader (`src/workflow/loader.ts`)

The loader already uses loose YAML parsing, so the optional `artefacts` field will be automatically parsed. No changes needed unless strict validation is added.

### 5. Workflow YAML Example

```yaml
name: feature-dev
description: Standard feature development workflow

steps:
  - id: brainstorming
    type: action
    artefacts: true
    instructions: |
      Scope out the feature and save the scope to a markdown file.

  - id: writing-plans
    type: action
    artefacts: true
    instructions: |
      Create a detailed implementation plan and save to file.

  - id: implementation
    type: loop
    artefacts: true  # Also works for loops
    instructions: |
      Implement the feature and register all created files.
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Empty paths array | Returns empty result (no error) |
| Invalid path type | Returns in `invalid` array |
| File doesn't exist | Returns in `invalid` array |
| Duplicate path | Returns in `duplicates` array, not re-added |
| Workflow not started | Throws error in MCP handler |

## Testing

### Unit Tests

1. **State Machine Tests (`src/test/workflow.test.ts`)**
   - Test `registerArtefacts()` with new paths
   - Test `registerArtefacts()` with duplicate paths
   - Test `registerArtefacts()` with invalid/non-existent paths
   - Test `registerArtefacts()` with mixed valid/invalid paths
   - Test artefacts initialization in `createInitialState()`
   - Test instruction injection when `artefacts: true`

2. **MCP Tool Tests (`src/test/mcp.test.ts`)**
   - Test `register_artefacts` tool handler
   - Test state persistence after registration
   - Test error handling when workflow not started

### Integration Test

Full workflow test:
1. Start workflow with `artefacts: true` step
2. Create a file
3. Call `register_artefacts`
4. Call `workflow_status` and verify artefacts are returned
5. Advance step and verify artefacts persist

## Migration Notes

- **Backward compatible:** Existing workflows without `artefacts` field work unchanged
- **State format:** New `artefacts` array added to `WorkflowState` - old states without it will default to empty array on load
- **Optional field:** `artefacts` defaults to `false` when not specified
