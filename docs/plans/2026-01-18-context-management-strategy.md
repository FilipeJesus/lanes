# Context Management Strategy Design

**Date:** 2026-01-18
**Author:** Claude
**Status:** Approved

## Overview

This feature allows workflow steps to explicitly manage conversation history (compacting or clearing context) before the step begins. A state tracking mechanism prevents infinite loops by ensuring each context action is only triggered once per step/sub-step.

## Problem Statement

When running long workflows with multiple steps, conversation context can grow large, potentially:
- Consuming excessive tokens
- Causing Claude to lose focus on the current step
- Including irrelevant historical information

## Solution

Add an optional `context` field to workflow steps that specifies whether to compact or clear the conversation before executing the step. The workflow runner tracks whether the action has been executed to prevent repeated triggers.

## Type System Updates

### New Type

```typescript
export type StepContextAction = 'compact' | 'clear';
```

### WorkflowStep Interface

```typescript
export interface WorkflowStep {
  id: string;
  type: 'action' | 'loop' | 'ralph';
  agent?: string;
  instructions?: string;
  n?: number;
  artefacts?: boolean;
  context?: StepContextAction;  // NEW
}
```

### LoopStep Interface

```typescript
export interface LoopStep {
  id: string;
  agent?: string;
  instructions: string;
  on_fail?: 'retry' | 'skip' | 'abort';
  context?: StepContextAction;  // NEW
}
```

### WorkflowState Interface

```typescript
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
  artefacts: string[];
  currentStepArtefacts?: boolean;
  contextActionExecuted: boolean;  // NEW
}
```

## State Machine Methods

### `getContextActionIfNeeded()`

Determines if a context action should be performed. Checks sub-step first (for loops), then main step.

```typescript
getContextActionIfNeeded(): StepContextAction | null {
  const step = this.getCurrentStep();

  if (this.state.contextActionExecuted) {
    return null;
  }

  // Sub-step context takes precedence
  const loopStep = this.getCurrentLoopStep();
  if (loopStep?.context) {
    return loopStep.context;
  }

  // Main step context
  if (step.context) {
    return step.context;
  }

  return null;
}
```

### `markContextActionExecuted()`

Marks that the context action has been performed.

```typescript
markContextActionExecuted(): void {
  this.state.contextActionExecuted = true;
}
```

### State Initialization

The `contextActionExecuted` flag is initialized to `false` in `createInitialState()`.

### State Reset Logic

The flag resets to `false` when:
- Advancing to a new main step (`advanceToNextStep`)
- Advancing to a new loop sub-step (`advanceWithinLoop`)
- Starting a new ralph iteration

## MCP Server Integration

### workflow_start Handler

```typescript
const contextAction = machine.getContextActionIfNeeded();
if (contextAction) {
  machine.markContextActionExecuted();
  await tools.saveState(worktreePath, machine.getState());

  const command = contextAction === 'compact' ? '/compact' : '/clear';
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        contextAction: command,
        message: `Please run \`${command}\` first, then call workflow_status again.`
      }, null, 2)
    }]
  };
}
```

### workflow_advance Handler

Same pattern applied after advancing to the next step.

### Flow

1. User calls `workflow_start` or `workflow_advance`
2. MCP server detects pending context action
3. Marks action as executed and saves state
4. Returns command to Claude (`/compact` or `/clear`)
5. User runs the command (optional - state is already saved)
6. User calls `workflow_status` → gets normal instructions

## YAML Usage Examples

### Basic Usage

```yaml
steps:
  - id: brainstorming
    type: action
    context: clear
    instructions: |
      Start fresh and brainstorm the feature approach.
```

### Loop Sub-Steps

```yaml
loops:
  process_task:
    - id: implement
      context: compact
      instructions: |
        Implement the solution.
        (Context compacts before this step)

steps:
  - id: process_task
    type: loop
```

### Ralph Iterations

```yaml
steps:
  - id: refine
    type: ralph
    n: 3
    context: compact
    instructions: |
      Refine and improve the work.
      (Context compacts before EACH iteration)
```

### Sub-Step Precedence

Sub-step context actions override main step actions:

```yaml
loops:
  work:
    - id: step2
      context: clear  # This takes precedence
      instructions: |
        This step has its own context action.

steps:
  - id: work
    type: loop
    context: compact  # Sub-step's 'clear' wins
```

## Test Scenarios

| Scenario | Expected Behavior |
|----------|-------------------|
| Step with `context: clear` | Returns `/clear` command on first call, instructions on second |
| Step with `context: compact` | Returns `/compact` command on first call, instructions on second |
| Step without context | Returns instructions immediately |
| Advancing steps | `contextActionExecuted` resets to `false` |
| Advancing loop sub-steps | `contextActionExecuted` resets to `false` |
| Ralph iterations | `contextActionExecuted` resets for each iteration |
| State restoration | `contextActionExecuted` value is preserved |

## Files to Modify

1. `src/workflow/types.ts` - Add types
2. `src/workflow/state.ts` - Add methods, initialize/reset flag
3. `src/mcp/server.ts` - Add context check logic
4. `src/test/workflow.test.ts` - Add tests

## Implementation Notes

- The context action is marked as executed immediately when returned to Claude
- No need for a PostStop hook - state is saved at the same time as the command is returned
- Sub-step context actions take precedence over main step actions
- Ralph steps reset the flag for each iteration to allow per-iteration context management
