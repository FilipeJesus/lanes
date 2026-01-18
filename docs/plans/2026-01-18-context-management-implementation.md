# Context Management Strategy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add optional context management (compact/clear) to workflow steps, allowing workflows to explicitly control conversation history before executing steps.

**Architecture:** Extend workflow type system with `context` field, add state machine methods to track context action execution, and integrate with MCP server to trigger commands before step instructions. State flag prevents infinite loops.

**Tech Stack:** TypeScript, Node.js, MCP SDK, YAML, Mocha test framework

---

## Task 1: Add Type Definitions

**Files:**
- Modify: `src/workflow/types.ts`

**Step 1: Add StepContextAction type**

Add this new type after the `AgentConfig` interface (around line 12):

```typescript
/**
 * Context action to perform before executing a step.
 */
export type StepContextAction = 'compact' | 'clear';
```

**Step 2: Add context field to WorkflowStep interface**

Modify the `WorkflowStep` interface to include the context field:

```typescript
export interface WorkflowStep {
  /** Unique identifier for this step */
  id: string;
  /** Type of step: 'action' for single steps, 'loop' for iterating over tasks, 'ralph' for n iterations */
  type: 'action' | 'loop' | 'ralph';
  /** Agent to execute this step (omit for main agent) */
  agent?: string;
  /** Instructions for action steps */
  instructions?: string;
  /** Number of iterations for ralph steps */
  n?: number;
  /** Enable artefact tracking for this step */
  artefacts?: boolean;
  /** Optional context action to perform before executing this step */
  context?: StepContextAction;
}
```

**Step 3: Add context field to LoopStep interface**

Modify the `LoopStep` interface to include the context field:

```typescript
export interface LoopStep {
  /** Unique identifier for this sub-step within the loop */
  id: string;
  /** Agent to execute this step (omit to use main agent) */
  agent?: string;
  /** Instructions for what to do in this step */
  instructions: string;
  /** Action to take if this step fails */
  on_fail?: 'retry' | 'skip' | 'abort';
  /** Optional context action to perform before executing this sub-step */
  context?: StepContextAction;
}
```

**Step 4: Add contextActionExecuted field to WorkflowState interface**

Modify the `WorkflowState` interface to include the tracking flag:

```typescript
export interface WorkflowState {
  /** Overall workflow status */
  status: 'running' | 'complete' | 'failed';
  /** Current main step ID */
  step: string;
  /** Type of the current step */
  stepType: 'action' | 'loop' | 'ralph';
  /** Current task context (only for loop steps) */
  task?: TaskContext;
  /** Current sub-step ID within a loop (only for loop steps) */
  subStep?: string;
  /** Current iteration for ralph steps (1-based) */
  ralphIteration?: number;
  /** Tasks organized by loop ID */
  tasks: Record<string, Task[]>;
  /** Outputs from completed steps, keyed by "step.task.subStep", "step", or "step.iteration" for ralph steps */
  outputs: Record<string, string>;
  /** Brief summary of the user's request (recommended: keep under 100 characters) */
  summary?: string;
  /** Tracked artefact paths (absolute) */
  artefacts: string[];
  /** Whether artefact tracking is enabled for the current step */
  currentStepArtefacts?: boolean;
  /** Whether the context action for the current step has been executed */
  contextActionExecuted: boolean;
}
```

**Step 5: Run TypeScript compilation to verify**

Run: `npm run compile`
Expected: No errors, types compile successfully

**Step 6: Commit**

```bash
git add src/workflow/types.ts
git commit -m "feat: add context management types to workflow system"
```

---

## Task 2: Add State Machine Methods

**Files:**
- Modify: `src/workflow/state.ts`

**Step 1: Add import for StepContextAction**

The import statement already imports all types from `./types`, so `StepContextAction` is already available. No change needed.

**Step 2: Update createInitialState to initialize contextActionExecuted**

Find the `createInitialState()` method (around line 39) and modify it:

```typescript
private createInitialState(): WorkflowState {
  const firstStep = this.template.steps[0];
  const state: WorkflowState = {
    status: 'running',
    step: firstStep.id,
    stepType: firstStep.type,
    tasks: {},
    outputs: {},
    artefacts: [],
    currentStepArtefacts: firstStep.artefacts,
    contextActionExecuted: false,  // Initialize flag
  };

  // Initialize ralph iteration if first step is ralph
  if (firstStep.type === 'ralph') {
    state.ralphIteration = 1;
  }

  return state;
}
```

**Step 3: Add getContextActionIfNeeded method**

Add this new public method after the `getCurrentAgent()` method (around line 134):

```typescript
/**
 * Gets the context action that should be performed before executing the current step.
 * Checks sub-step first (for loops), then main step. Returns null if already executed.
 * @returns The context action ('compact' | 'clear') or null
 */
getContextActionIfNeeded(): StepContextAction | null {
  const step = this.getCurrentStep();

  // Already executed
  if (this.state.contextActionExecuted) {
    return null;
  }

  // Check loop sub-step first (takes precedence)
  const loopStep = this.getCurrentLoopStep();
  if (loopStep?.context) {
    return loopStep.context;
  }

  // Check main step
  if (step.context) {
    return step.context;
  }

  return null;
}
```

**Step 4: Add markContextActionExecuted method**

Add this new public method right after `getContextActionIfNeeded()`:

```typescript
/**
 * Marks that the context action has been executed.
 * This prevents the same action from being triggered multiple times.
 */
markContextActionExecuted(): void {
  this.state.contextActionExecuted = true;
}
```

**Step 5: Update advanceToNextStep to reset flag**

Find the `advanceToNextStep()` private method (around line 384) and add the flag reset:

```typescript
private advanceToNextStep(): void {
  const currentIndex = this.getCurrentStepIndex();
  const nextIndex = currentIndex + 1;

  if (nextIndex >= this.template.steps.length) {
    // Workflow complete
    this.state.status = 'complete';
    return;
  }

  const nextStep = this.template.steps[nextIndex];
  this.state.step = nextStep.id;
  this.state.stepType = nextStep.type;
  this.state.task = undefined;
  this.state.subStep = undefined;
  this.state.ralphIteration = undefined;
  this.state.currentStepArtefacts = nextStep.artefacts;
  this.state.contextActionExecuted = false;  // Reset for new step

  // If next step is a loop, check if tasks are already set
  if (nextStep.type === 'loop' && this.state.tasks[nextStep.id]?.length > 0) {
    this.initializeLoopIteration();
  }

  // If next step is a ralph, initialize iteration to 1
  if (nextStep.type === 'ralph') {
    this.state.ralphIteration = 1;
  }
}
```

**Step 6: Update advanceWithinLoop to reset flag for sub-steps**

Find the `advanceWithinLoop()` private method (around line 416) and add the flag reset when moving to next sub-step:

```typescript
private advanceWithinLoop(): void {
  const loopSteps = this.getLoopSteps(this.state.step);
  const tasks = this.getCurrentTasks();
  const currentSubStepIndex = this.getCurrentSubStepIndex();

  // Try to advance to next sub-step
  if (currentSubStepIndex < loopSteps.length - 1) {
    this.state.subStep = loopSteps[currentSubStepIndex + 1].id;
    this.state.contextActionExecuted = false;  // Reset for new sub-step
    return;
  }

  // ... rest of method remains unchanged
}
```

**Step 7: Update advance method to reset flag for ralph iterations**

Find the `advance()` method (around line 465) and add flag reset for ralph iterations:

```typescript
advance(output: string): WorkflowStatusResponse {
  if (this.state.status !== 'running') {
    return this.getStatus();
  }

  // Store output
  const outputKey = this.getOutputKey();
  this.state.outputs[outputKey] = output;

  // Advance based on step type
  if (this.state.stepType === 'action') {
    this.advanceToNextStep();
  } else if (this.state.stepType === 'ralph') {
    // Ralph step - check if we need to iterate or advance
    const currentStep = this.getCurrentStep();
    const n = currentStep.n || 1;
    const currentIteration = this.state.ralphIteration || 1;

    if (currentIteration < n) {
      // Increment iteration and stay on same step
      this.state.ralphIteration = currentIteration + 1;
      this.state.contextActionExecuted = false;  // Reset for next iteration
    } else {
      // Completed all iterations - advance to next step
      this.advanceToNextStep();
    }
  } else {
    // Loop step
    if (this.state.task && this.state.subStep) {
      this.advanceWithinLoop();
    } else {
      // Loop not initialized - this shouldn't happen if tasks were set
      this.advanceToNextStep();
    }
  }

  return this.getStatus();
}
```

**Step 8: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 9: Run existing tests**

Run: `npm test`
Expected: All existing tests pass (new flag defaults to false, doesn't break existing behavior)

**Step 10: Commit**

```bash
git add src/workflow/state.ts
git commit -m "feat: add context action methods to WorkflowStateMachine"
```

---

## Task 3: Add MCP Server Integration

**Files:**
- Modify: `src/mcp/server.ts`

**Step 1: Update workflow_start handler**

Find the `workflow_start` case in the CallToolRequestSchema handler (around line 258) and add the context check:

```typescript
case 'workflow_start': {
  // Initialize or restore workflow
  if (!machine) {
    // Extract optional summary from args, enforce max length
    let summary: string | undefined;
    if (typeof toolArgs?.summary === 'string' && toolArgs.summary.trim()) {
      const trimmed = toolArgs.summary.trim();
      // Truncate to approximately 10 words (max ~100 chars)
      summary = trimmed.length > 100 ? trimmed.substring(0, 97) + '...' : trimmed;
    }
    machine = await initializeMachine(summary);
  }

  // NEW: Check for pending context action
  const contextAction = machine.getContextActionIfNeeded();
  if (contextAction) {
    machine.markContextActionExecuted();
    await tools.saveState(worktreePath, machine.getState());

    const command = contextAction === 'compact' ? '/compact' : '/clear';
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          contextAction: command,
          message: `Please run \`${command}\` first, then call workflow_status again.`
        }, null, 2)
      }]
    };
  }

  // Normal path: return status
  const status = tools.workflowStatus(machine);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
  };
}
```

**Step 2: Update workflow_advance handler**

Find the `workflow_advance` case (around line 341) and add the context check after advancing:

```typescript
case 'workflow_advance': {
  if (!machine) {
    throw new Error('Workflow not started. Call workflow_start first.');
  }
  // Validate output
  if (toolArgs?.output !== undefined && typeof toolArgs.output !== 'string') {
    throw new Error('output must be a string');
  }
  const output = (toolArgs?.output as string) || '';
  const status = await tools.workflowAdvance(machine, output, worktreePath);

  // NEW: Check for pending context action on the NEW step
  const contextAction = machine.getContextActionIfNeeded();
  if (contextAction) {
    machine.markContextActionExecuted();
    await tools.saveState(worktreePath, machine.getState());

    const command = contextAction === 'compact' ? '/compact' : '/clear';
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          contextAction: command,
          message: `Please run \`${command}\` first, then call workflow_status again.`
        }, null, 2)
      }]
    };
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
  };
}
```

**Step 3: Run TypeScript compilation**

Run: `npm run compile`
Expected: No errors

**Step 4: Commit**

```bash
git add src/mcp/server.ts
git commit -m "feat: integrate context action checking in MCP server"
```

---

## Task 4: Add Tests for Context Management

**Files:**
- Modify: `src/test/workflow.test.ts`

**Step 1: Add getContextActionIfNeeded tests**

Add this test suite after the 'Workflow Types' suite (around line 177):

```typescript
suite('Context Management', () => {
  let templateWithContext: WorkflowTemplate;

  setup(() => {
    templateWithContext = loadWorkflowTemplateFromString(`
name: context-test
description: Test context management

steps:
  - id: step_with_clear
    type: action
    context: clear
    instructions: Clear context first
  - id: step_with_compact
    type: action
    context: compact
    instructions: Compact context first
  - id: step_no_context
    type: action
    instructions: Normal step
`);
  });

  suite('getContextActionIfNeeded', () => {
    test('Returns null when step has no context action', () => {
      // Arrange
      const template = loadWorkflowTemplateFromString(`
name: test
description: Test
steps:
  - id: step1
    type: action
    instructions: Do something
`);
      const machine = new WorkflowStateMachine(template);
      machine.start();

      // Act
      const action = machine.getContextActionIfNeeded();

      // Assert
      assert.strictEqual(action, null);
    });

    test('Returns clear action when step has context: clear', () => {
      // Arrange
      const machine = new WorkflowStateMachine(templateWithContext);
      machine.start();

      // Act
      const action = machine.getContextActionIfNeeded();

      // Assert
      assert.strictEqual(action, 'clear');
    });

    test('Returns compact action when step has context: compact', () => {
      // Arrange
      const machine = new WorkflowStateMachine(templateWithContext);
      machine.start();
      machine.advance('First step done');

      // Act
      const action = machine.getContextActionIfNeeded();

      // Assert
      assert.strictEqual(action, 'compact');
    });

    test('Returns null after action is marked executed', () => {
      // Arrange
      const machine = new WorkflowStateMachine(templateWithContext);
      machine.start();

      // Act
      machine.markContextActionExecuted();
      const action = machine.getContextActionIfNeeded();

      // Assert
      assert.strictEqual(action, null);
    });

    test('Sub-step context action takes precedence over main step', () => {
      // Arrange
      const template = loadWorkflowTemplateFromString(`
name: test
description: Test
loops:
  my_loop:
    - id: sub1
      context: clear
      instructions: Sub step with clear
    - id: sub2
      instructions: Sub step without
steps:
  - id: step1
    type: loop
    context: compact
`);
      const machine = new WorkflowStateMachine(template);
      machine.start();
      machine.setTasks('step1', [{ id: 't1', title: 'Task 1', status: 'pending' }]);

      // Act
      const action = machine.getContextActionIfNeeded();

      // Assert - sub-step's 'clear' should win over main step's 'compact'
      assert.strictEqual(action, 'clear');
    });

    test('Returns null when sub-step has no context and main step has none', () => {
      // Arrange
      const template = loadWorkflowTemplateFromString(`
name: test
description: Test
loops:
  my_loop:
    - id: sub1
      instructions: Sub step
steps:
  - id: step1
    type: loop
`);
      const machine = new WorkflowStateMachine(template);
      machine.start();
      machine.setTasks('step1', [{ id: 't1', title: 'Task 1', status: 'pending' }]);

      // Act
      const action = machine.getContextActionIfNeeded();

      // Assert
      assert.strictEqual(action, null);
    });
  });

  suite('markContextActionExecuted', () => {
    test('Updates state flag to true', () => {
      // Arrange
      const machine = new WorkflowStateMachine(templateWithContext);
      machine.start();

      // Act
      machine.markContextActionExecuted();

      // Assert
      assert.strictEqual(machine.getState().contextActionExecuted, true);
    });
  });

  suite('State Initialization and Reset', () => {
    test('contextActionExecuted initializes to false', () => {
      // Arrange & Act
      const machine = new WorkflowStateMachine(templateWithContext);
      machine.start();

      // Assert
      assert.strictEqual(machine.getState().contextActionExecuted, false);
    });

    test('contextActionExecuted resets when advancing to next step', () => {
      // Arrange
      const machine = new WorkflowStateMachine(templateWithContext);
      machine.start();
      machine.markContextActionExecuted();
      assert.strictEqual(machine.getState().contextActionExecuted, true);

      // Act
      machine.advance('Done');

      // Assert - should be reset for new step
      assert.strictEqual(machine.getState().contextActionExecuted, false);
    });

    test('contextActionExecuted resets when advancing loop sub-steps', () => {
      // Arrange
      const template = loadWorkflowTemplateFromString(`
name: test
description: Test
loops:
  my_loop:
    - id: sub1
      context: clear
      instructions: Sub 1
    - id: sub2
      context: compact
      instructions: Sub 2
steps:
  - id: step1
    type: loop
`);
      const machine = new WorkflowStateMachine(template);
      machine.start();
      machine.setTasks('step1', [{ id: 't1', title: 'Task 1', status: 'pending' }]);
      machine.markContextActionExecuted();

      // Act - advance to next sub-step
      machine.advance('Sub 1 done');

      // Assert - should be reset for new sub-step
      assert.strictEqual(machine.getState().contextActionExecuted, false);
    });

    test('contextActionExecuted resets for each ralph iteration', () => {
      // Arrange
      const template = loadWorkflowTemplateFromString(`
name: test
description: Test
steps:
  - id: refine
    type: ralph
    n: 3
    context: compact
    instructions: Refine
`);
      const machine = new WorkflowStateMachine(template);
      machine.start();
      machine.markContextActionExecuted();

      // Act - advance to next iteration
      machine.advance('Iter 1');

      // Assert - should be reset for next iteration
      assert.strictEqual(machine.getState().contextActionExecuted, false);
    });
  });

  suite('State Persistence', () => {
    test('contextActionExecuted is preserved when restoring state', () => {
      // Arrange
      const machine1 = new WorkflowStateMachine(templateWithContext);
      machine1.start();
      machine1.markContextActionExecuted();

      const savedState = machine1.getState();

      // Act - restore from saved state
      const machine2 = WorkflowStateMachine.fromState(templateWithContext, savedState);

      // Assert
      assert.strictEqual(machine2.getState().contextActionExecuted, true);
    });

    test('contextActionExecuted false is preserved when restoring state', () => {
      // Arrange
      const machine1 = new WorkflowStateMachine(templateWithContext);
      machine1.start();
      // Don't mark as executed - should stay false

      const savedState = machine1.getState();

      // Act
      const machine2 = WorkflowStateMachine.fromState(templateWithContext, savedState);

      // Assert
      assert.strictEqual(machine2.getState().contextActionExecuted, false);
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test -- --grep "Context Management"`
Expected: All 11 new tests pass

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass (existing + new)

**Step 4: Commit**

```bash
git add src/test/workflow.test.ts
git commit -m "test: add comprehensive context management tests"
```

---

## Task 5: Add YAML Validation

**Files:**
- Modify: `src/workflow/loader.ts`

**Step 1: Find the validateStep function**

Locate the `validateStep` function around line 150.

**Step 2: Add context validation to validateStep**

Add validation for the optional `context` field. Add this check after the `artefacts` validation:

```typescript
// Validate optional context field
if (step.context !== undefined) {
  if (typeof step.context !== 'string') {
    throw new WorkflowValidationError(
      `Step '${stepId}' context must be a string`
    );
  }
  if (step.context !== 'compact' && step.context !== 'clear') {
    throw new WorkflowValidationError(
      `Step '${stepId}' context must be either 'compact' or 'clear', got: ${step.context}`
    );
  }
}
```

**Step 3: Add context validation to validateLoopStep**

Find the `validateLoopStep` function and add similar validation:

```typescript
// Validate optional context field
if (step.context !== undefined) {
  if (typeof step.context !== 'string') {
    throw new WorkflowValidationError(
      `Loop step '${stepId}' context must be a string`
    );
  }
  if (step.context !== 'compact' && step.context !== 'clear') {
    throw new WorkflowValidationError(
      `Loop step '${stepId}' context must be either 'compact' or 'clear', got: ${step.context}`
    );
  }
}
```

**Step 4: Add tests for invalid context values**

Add these tests to the workflow.test.ts file in the 'Invalid Templates' suite:

```typescript
test('Loader rejects template with invalid context value', () => {
  const invalidYaml = `
name: invalid-context
description: A template
steps:
  - id: step1
    type: action
    context: invalid
    instructions: Do something
`;
  assert.throws(
    () => loadWorkflowTemplateFromString(invalidYaml),
    WorkflowValidationError,
    'Should throw WorkflowValidationError for invalid context value'
  );
});

test('Loader accepts template with valid context: clear', () => {
  const validYaml = `
name: valid-clear
description: A template
steps:
  - id: step1
    type: action
    context: clear
    instructions: Do something
`;
  const template = loadWorkflowTemplateFromString(validYaml);
  assert.strictEqual(template.steps[0].context, 'clear');
});

test('Loader accepts template with valid context: compact', () => {
  const validYaml = `
name: valid-compact
description: A template
steps:
  - id: step1
    type: action
    context: compact
    instructions: Do something
`;
  const template = loadWorkflowTemplateFromString(validYaml);
  assert.strictEqual(template.steps[0].context, 'compact');
});
```

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/workflow/loader.ts src/test/workflow.test.ts
git commit -m "feat: add context field validation in workflow loader"
```

---

## Task 6: Create Example Workflow

**Files:**
- Create: `workflows/context-example.yaml`

**Step 1: Create example workflow demonstrating context usage**

```yaml
name: context-example
description: Example workflow demonstrating context management features

steps:
  - id: brainstorm
    type: action
    context: clear
    instructions: |
      Start with a fresh context and brainstorm ideas.
      This step clears previous conversation history.

  - id: plan
    type: action
    instructions: |
      Create a detailed plan based on the brainstorming.
      No context action - this step uses the accumulated context.

  - id: implement_loop
    type: loop

  - id: review
    type: action
    context: compact
    instructions: |
      Review the implementation.
      This step compacts the conversation before review.

loops:
  implement_loop:
    - id: analyze
      instructions: Analyze the requirements

    - id: code
      context: compact
      instructions: |
        Write the implementation code.
        Context is compacted before coding to focus on current task.

    - id: verify
      instructions: Verify the implementation works
```

**Step 2: Validate the example workflow loads**

Create a quick test to verify:

```bash
node -e "
const { loadWorkflowTemplate } = require('./out/workflow/index.js');
const template = loadWorkflowTemplate('./workflows/context-example.yaml');
console.log('Workflow loaded successfully:', template.name);
console.log('Steps:', template.steps.map(s => ({ id: s.id, context: s.context })));
"
```

Expected: No errors, shows context values for each step

**Step 3: Commit**

```bash
git add workflows/context-example.yaml
git commit -m "docs: add example workflow demonstrating context management"
```

---

## Task 7: Final Integration Testing

**Step 1: Compile everything**

Run: `npm run compile`
Expected: No errors

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Test with MCP server manually**

Start the MCP server and test the flow:

```bash
# In a test worktree with workflow-state.json
node out/mcp/server.js --worktree /path/to/worktree --workflow-path /path/to/workflows/context-example.yaml --repo-root /path/to/repo
```

Test calling `workflow_start` - should return context action if first step has one.

**Step 4: Check git diff**

Run: `git diff`
Expected: Only planned changes, no unintended modifications

**Step 5: Final commit if needed**

If any adjustments were made:

```bash
git add -A
git commit -m "chore: final adjustments for context management feature"
```

---

## Summary

This implementation plan adds context management to the Lanes workflow system in 7 tasks:

1. **Type definitions** - Add `StepContextAction` type and `context` fields to step types
2. **State machine methods** - Add `getContextActionIfNeeded()` and `markContextActionExecuted()`
3. **MCP integration** - Check for context actions before returning instructions
4. **Tests** - Comprehensive test coverage for all scenarios
5. **Validation** - Ensure only 'compact' or 'clear' are accepted
6. **Example** - Demonstrate usage in example workflow
7. **Integration** - Final testing and verification

The design ensures context actions are triggered exactly once per step/sub-step, preventing infinite loops while allowing workflows to manage conversation history explicitly.
