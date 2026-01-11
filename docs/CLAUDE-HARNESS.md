# Claude Harness

For long-running agent sessions that span multiple context windows, we recommend setting up a **Claude Harness** - a structured approach to task management that helps Claude maintain continuity across sessions.

This pattern is based on Anthropic's research on [Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

## Why Use a Harness?

Each new Claude session begins with no memory of what came before. A harness solves this by:

- **Defining scope** - A structured feature list prevents over-ambition and premature completion claims
- **Tracking progress** - Clear pass/fail status for each feature
- **Enabling handoffs** - Fresh sessions can quickly assess the current state

Lanes provides an **MCP Workflow System** - a structured approach using workflow templates, specialized agents, and MCP tools to guide Claude through complex development work.

---

## MCP Workflow System

The MCP (Model Context Protocol) based workflow system provides structured phases for planning, implementation, testing, and review.

### What is the Workflow System?

The MCP Workflow System guides Claude through structured development phases using:

- **Workflow Templates** - YAML files that define the sequence of steps
- **Specialized Agents** - Sub-agents with specific roles and tool restrictions
- **Reusable Loops** - Sub-workflows that iterate over tasks
- **MCP Tools** - Functions Claude uses to navigate the workflow

### Key Concepts

#### 1. Workflow Templates

Workflow templates are YAML files that define:
- **Agents** - Specialized roles with allowed/disallowed tools
- **Loops** - Reusable sub-workflows that iterate over tasks
- **Steps** - The main workflow sequence

**Template Locations:**
- Built-in templates: `workflows/` (feature, bugfix, refactor, default)
- Custom templates: `.lanes/workflows/` (appear in VS Code dropdown)

**Example Template Structure:**

```yaml
name: feature
description: Plan and implement a new feature

agents:
  orchestrator:
    description: Plans work and coordinates
    tools: [Read, Glob, Grep, Task]
    cannot: [Write, Edit, Bash, commit]

  implementer:
    description: Writes code
    tools: [Read, Write, Edit, Bash, Glob, Grep]
    cannot: [commit, Task]

loops:
  feature_development:
    - id: implement
      agent: implementer
      instructions: |
        Implement: {task.title}
        ...
    - id: test
      agent: tester
      instructions: ...
    - id: review
      agent: reviewer
      instructions: ...

steps:
  - id: plan
    type: action
    agent: orchestrator
    instructions: Analyze the goal...

  - id: feature_development
    type: loop

  - id: final_review
    type: action
    agent: reviewer
    instructions: ...
```

#### 2. Agents

Agents are specialized roles that execute specific workflow steps. Each agent has:
- A **description** of its role
- A list of **tools** it can use (Read, Write, Edit, Bash, Grep, Glob, Task, commit)
- A list of actions it **cannot** perform

**Built-in Agent Examples:**
- **orchestrator** - Plans work, breaks down tasks, coordinates (cannot modify code)
- **implementer** - Writes code (cannot commit or spawn sub-tasks)
- **tester** - Runs tests and fixes failures (cannot modify feature code)
- **reviewer** - Reviews code quality (cannot modify code directly)

**Agent Field is Optional:** You can omit the `agent:` field on any step or sub-step. When omitted, the main Claude agent handles that step directly instead of delegating to a sub-agent. This is useful for simpler workflows.

```yaml
# With agent (delegated to sub-agent)
- id: implement
  agent: implementer
  instructions: Write the code...

# Without agent (main Claude handles it)
- id: cleanup
  instructions: Clean up temp files...
```

#### 3. Loops and Steps

**Steps** are the main workflow sequence. Each step has:
- **id** - Unique identifier
- **type** - One of `action`, `loop`, or `ralph`
- **agent** - (optional) Agent to execute the step
- **instructions** - What to do (for action and ralph steps)
- **n** - Number of iterations (required for ralph steps)

**Step Types:**

| Type | Purpose | Required Fields |
|------|---------|-----------------|
| `action` | Single operation executed once | `instructions` |
| `loop` | Iterate over a list of tasks | References a defined loop |
| `ralph` | Repeat same task n times for iterative refinement | `instructions`, `n` |

**Loops** are reusable sub-workflows that iterate over a list of tasks. Each loop contains sub-steps that execute for each task:

```yaml
loops:
  feature_development:
    - id: implement
      agent: implementer
      instructions: |
        Implement: {task.title}
        Description: {task.description}
    - id: test
      agent: tester
      instructions: Run tests for {task.title}
    - id: review
      agent: reviewer
      instructions: Review {task.title}

steps:
  - id: plan
    type: action
    instructions: Break down the goal into tasks

  - id: feature_development  # References the loop above
    type: loop
```

**Task Variables:** Within loop instructions, you can reference:
- `{task.id}` - Task identifier
- `{task.title}` - Task title
- `{task.description}` - Task description

#### Ralph Steps (Iterative Refinement)

**Ralph steps** are a special step type that repeats the same task `n` times to iteratively improve the result. This pattern is useful when you want Claude to refine its work through multiple passes.

```yaml
steps:
  - id: plan
    type: action
    instructions: Create initial plan

  - id: refine-plan
    type: ralph
    n: 3
    instructions: |
      Review and improve the plan.
      Look for gaps, edge cases, and potential issues.
      Refine the approach based on your analysis.

  - id: implement
    type: action
    instructions: Implement the refined plan
```

**How Ralph Steps Work:**

1. When Claude calls `workflow_advance` on a ralph step, the workflow checks the current iteration
2. If iteration < n, the workflow returns the **same step** with incremented iteration count
3. Claude receives clear messaging that this is intentional and should work on the task again
4. When iteration reaches n, the workflow advances to the next step

**Output Storage:**

Each ralph iteration stores its output with a unique key including the iteration number:
- `refine-plan.1` - Output from first iteration
- `refine-plan.2` - Output from second iteration
- `refine-plan.3` - Output from third iteration

**Status Response:**

The `workflow_status` response includes ralph-specific fields:
- `ralphIteration` - Current iteration (1-based)
- `ralphTotal` - Total iterations (the `n` value)

**Best Use Cases:**
- **Plan refinement** - Iterate on implementation plans before coding
- **Code review** - Multiple passes to catch different types of issues
- **Documentation** - Refine documentation through multiple drafts
- **Test coverage** - Iteratively improve test cases

#### 4. MCP Tools

Claude uses these MCP tools to navigate the workflow:

| Tool | Purpose | Usage |
|------|---------|-------|
| `workflow_start` | Initialize workflow | Called with workflow name and optional summary |
| `workflow_set_tasks` | Associate tasks with a loop | Called with loop ID and task list |
| `workflow_status` | Get current position | Returns step, agent, instructions, progress |
| `workflow_advance` | Complete step and move to next | Called with output/summary of current step |
| `workflow_context` | Get outputs from previous steps | Returns record of all step outputs |

**Example Usage Flow:**

```
1. Claude calls workflow_start("feature", "Add user authentication")
   → Returns: "Step 1: plan" with instructions

2. Claude reads code, plans the work
   Claude calls workflow_advance("Planned 3 features: login, logout, session")
   → Returns: "Step 2: define_tasks" with instructions

3. Claude calls workflow_set_tasks("feature_development", [
     {id: "login", title: "Login form", ...},
     {id: "logout", title: "Logout", ...},
     {id: "session", title: "Session persistence", ...}
   ])
   → Returns: "Task 1/3: implement login" with instructions

4. Claude implements the feature
   Claude calls workflow_advance("Implemented login form with validation")
   → Returns: "Task 1/3: test login" with instructions

5. Claude runs tests, fixes issues
   Claude calls workflow_advance("All tests pass")
   → Returns: "Task 1/3: review login" with instructions

... and so on
```

### Built-in Workflow Templates

Lanes includes four built-in workflow templates:

#### 1. feature.yaml
**Purpose:** Plan and implement a new feature

**Phases:**
1. Plan - Analyze goal, break into tasks
2. Define tasks - Create task list
3. Feature development loop (for each task):
   - Implement (implementer agent)
   - Test (tester agent)
   - Review (reviewer agent)
   - Resolution (main agent addresses issues)
4. Final review - Review implementation as a whole
5. Final resolution - Address any final issues

**Best for:** New features, significant additions, multi-part implementations

#### 2. bugfix.yaml
**Purpose:** Diagnose and fix bugs

**Phases:**
1. Diagnose - Identify root cause
2. Plan fixes - Break into discrete fixes
3. Fix loop (for each fix):
   - Implement fix
   - Test
   - Review
   - Resolution
4. Final verification

**Best for:** Bug fixes, issue resolution

#### 3. refactor.yaml
**Purpose:** Improve code quality without changing behavior

**Phases:**
1. Analyze - Identify refactoring opportunities
2. Plan refactors - Break into safe changes
3. Refactor loop (for each change):
   - Implement
   - Test (ensure behavior unchanged)
   - Review
   - Resolution
4. Final verification

**Best for:** Code cleanup, performance improvements, architectural changes

#### 4. default.yaml
**Purpose:** Standard development workflow

**Phases:**
1. Plan - Break down task
2. Implementation loop (for each task):
   - Code (coder agent)
   - Test (test-engineer agent)
   - Review (code-reviewer agent)
3. Cleanup - Finalize and clean up

**Best for:** General development work, simple tasks

### Creating Custom Workflows

To create a custom workflow for your project:

1. **Create the directory structure:**
   ```bash
   mkdir -p .lanes/workflows
   ```

2. **Copy a built-in template as a starting point:**
   ```bash
   cp workflows/feature.yaml .lanes/workflows/my-custom-workflow.yaml
   ```

3. **Customize the workflow:**
   - Edit the `name` and `description`
   - Define or modify agents (tools, restrictions)
   - Adjust the loop steps
   - Modify the main steps sequence

4. **Define corresponding agents (if needed):**
   ```bash
   mkdir -p .claude/agents
   # Create .claude/agents/my-agent.md with agent instructions
   ```

5. **The workflow will appear in VS Code:**
   - Open the Lanes sidebar
   - Click "Start Workflow"
   - Your custom workflow appears in the "Custom" section

**Note:** Agent names in the workflow (in the `agents:` section and `agent:` fields) must match either:
- Inline agent definitions in the workflow file, OR
- Agent files in `.claude/agents/` (e.g., `agent: orchestrator` requires `.claude/agents/orchestrator.md`)

Inline definitions take precedence over external files.

### Workflow State Persistence

The workflow system automatically persists state to `workflow-state.json` in your worktree. This enables:

- **Resume capability** - If Claude crashes or loses context, the workflow can resume
- **Context preservation** - All step outputs are stored and accessible
- **Progress tracking** - Current position, completed tasks, remaining work

The state file is automatically updated after each step and should not be manually edited.

---

## Progress Tracking with claude-progress.txt

For even better continuity across sessions, add a `claude-progress.txt` file that Claude updates at the end of each session:

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

**Recommended Structure:**

```markdown
## Session: [Date]

### Completed
- [What was accomplished]

### Issues Encountered
- [Any blockers or problems]

### Next Steps
- [What should be done next]

### Notes
- [Any additional context]
```

---

## Choosing the Right Workflow

| Use Case | Recommended Workflow |
|----------|---------------------|
| New features | feature.yaml |
| Bug fixes | bugfix.yaml |
| Code quality improvements | refactor.yaml |
| General development | default.yaml |
| Standardized team process | Custom workflow template |

---

## Best Practices

1. **Always use a workflow** - Even simple tasks benefit from structured tracking
2. **Break down work into discrete units** - Smaller tasks are easier to complete and verify
3. **Update claude-progress.txt at the end of each session** - Future sessions will thank you
4. **Clean up when done** - Delete workflow-state.json when the task is complete
5. **Commit frequently** - Commit after each task completion
6. **Use workflows for consistency** - Create custom workflows for your team's standard processes

---

## Further Reading

- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Model Context Protocol (MCP) Specification](https://modelcontextprotocol.io/)
- Lanes Documentation: `CLAUDE.md` in the project root
