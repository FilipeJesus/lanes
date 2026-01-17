---
title: "Getting Started with Lanes Workflows"
date: 2024-03-01
tags: [tutorial, workflows]
excerpt: "Learn how to use Lanes' structured workflow system to guide your AI agents through complex tasks."
---

# Getting Started with Lanes Workflows

Lanes includes a powerful workflow system that guides AI agents through structured phases: Plan → Implement → Test → Review. This ensures reliable, repeatable results for complex tasks.

## What Are Workflows?

Workflows are YAML configuration files that define:
1. **Agents** - Which specialists work on each task
2. **Steps** - The phases of work (planning, implementation, testing, review)
3. **Loops** - Iterative cycles for refinement

## Creating Your First Workflow

Create a `.lanes/workflows/feature.yaml` file:

```yaml
name: Feature Development Workflow
description: Structured workflow with plan, implement, test, review

agents:
  coder:
    description: Responsible for implementing features
  test-engineer:
    description: Responsible for writing and executing tests

steps:
  - id: plan
    type: action
    instructions: Analyze goal and break into features

  - id: implement
    type: loop
    agent: coder
    iterations: 3

  - id: test
    type: action
    agent: test-engineer
    instructions: Write comprehensive tests

  - id: review
    type: action
    instructions: Review all changes and verify quality
```

## Using Workflows in a Session

When creating a new session in Lanes:

1. Select your workflow from the dropdown
2. Provide your starting prompt
3. Add acceptance criteria

Lanes will automatically:
- Create the worktree
- Track progress in `workflow-state.json`
- Guide each agent through their assigned steps
- Update the sidebar with current progress

## Key Benefits

### 1. Structured Progress
Each phase has clear outputs before moving to the next. No more "just start coding" without a plan.

### 2. Agent Specialization
Different agents handle different phases. The test-engineer doesn't write implementation code; the coder doesn't write tests (initially).

### 3. Quality Gates
The review step ensures nothing gets merged without verification.

### 4. Progress Tracking
The workflow-state.json file persists across context windows, so the agent always knows where it is.

## Example: Building a New Feature

Let's say you want to add user authentication:

**Plan Phase:**
- Analyze requirements
- Design the data model
- Plan API endpoints
- Identify security considerations

**Implement Phase (loop):**
- Iteration 1: User model and database schema
- Iteration 2: Registration endpoint
- Iteration 3: Login endpoint and session management

**Test Phase:**
- Unit tests for authentication logic
- Integration tests for API endpoints
- Security tests for common vulnerabilities

**Review Phase:**
- Verify all tests pass
- Check code quality
- Ensure documentation is complete
- Validate against acceptance criteria

## Advanced: Loop with Multiple Agents

For complex features, you can loop through multiple agents:

```yaml
loops:
  develop:
    - id: programming
      agent: coder
      instructions: Implement feature
    - id: testing
      agent: test-engineer
      instructions: Write and run tests
```

This creates a TDD cycle: implement → test → implement → test...

## Next Steps

Ready to level up your AI-assisted development?

1. Check out [workflow examples](https://github.com/FilipeJesus/lanes/tree/main/.lanes/workflows)
2. Read the [workflow documentation](https://filipejesus.github.io/lanes/docs.html)
3. Create your own custom workflow

Happy coding!
