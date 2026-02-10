# Roadmap: Codex CLI Support

## Overview

Adding OpenAI Codex CLI as a second supported agent in Lanes requires eliminating hardcoded Claude assumptions, enhancing the CodeAgent abstraction to support agents without hook systems, implementing the CodexCodeAgent with TOML configuration, integrating agent selection UI, and validating the multi-agent system. This roadmap follows a sequential dependency chain from foundation refactoring through comprehensive testing.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation Refactoring** - Eliminate hardcoded Claude assumptions
- [ ] **Phase 2: Agent Abstraction Enhancement** - Add agent factory, tracking interface, settings service
- [ ] **Phase 3: Codex CLI Integration** - Implement CodexCodeAgent with TOML config
- [ ] **Phase 4: UI Integration** - Agent selection and terminal differentiation
- [ ] **Phase 5: Testing & Validation** - Multi-agent test suite and compatibility

## Phase Details

### Phase 1: Foundation Refactoring
**Goal**: Codebase is agent-agnostic with no hardcoded Claude assumptions outside agent classes
**Depends on**: Nothing (first phase)
**Requirements**: REQ-F1, REQ-F2, REQ-F3
**Success Criteria** (what must be TRUE):
  1. All file paths use agent method calls instead of string literals (no ".claude-session" hardcoded strings)
  2. Services have agent-neutral names (SessionProvider, not ClaudeSessionProvider)
  3. All services receive CodeAgent via dependency injection with no direct instantiation outside factory
**Plans**: 4 plans

Plans:
- [ ] 01-01-PLAN.md — Replace hardcoded file paths, watch patterns, terminal names with CodeAgent method calls
- [ ] 01-02-PLAN.md — Generalize localSettings.ts to be agent-aware; fix tests for signature changes
- [ ] 01-03-PLAN.md — Rename ClaudeSessionProvider to AgentSessionProvider, update all production imports
- [ ] 01-04-PLAN.md — Update command/view IDs to lanes.*, add backward-compatible aliases, update all test files

### Phase 2: Agent Abstraction Enhancement
**Goal**: Infrastructure supports multiple agents with different capabilities (hooks vs polling, JSON vs TOML)
**Depends on**: Phase 1
**Requirements**: REQ-A1, REQ-A2, REQ-A3, REQ-A4
**Success Criteria** (what must be TRUE):
  1. Agent factory creates correct CodeAgent subclass from VS Code setting
  2. Session creation stores agent selection in metadata that persists across restarts
  3. Session tracking works for both hook-based (Claude) and hookless (alternative) agents
  4. Settings service reads and writes both JSON and TOML formats based on agent specification
**Plans**: 3 plans

Plans:
- [ ] 02-01: Agent factory with VS Code setting
- [ ] 02-02: Agent-specific session tracking abstraction
- [ ] 02-03: Format-agnostic settings service (JSON + TOML)

### Phase 3: Codex CLI Integration
**Goal**: CodexCodeAgent fully implements CodeAgent interface with proper CLI commands and TOML configuration
**Depends on**: Phase 2
**Requirements**: REQ-C1, REQ-C2, REQ-C3, REQ-C4, REQ-C5, REQ-C6
**Success Criteria** (what must be TRUE):
  1. CodexCodeAgent generates correct `codex` CLI commands with proper shell escaping
  2. Codex sessions can start with permission modes mapped to --sandbox and --ask-for-approval flags
  3. Codex sessions can resume using session ID or --last fallback
  4. Codex session IDs are captured without hooks to enable resume functionality
  5. Codex terminals display distinct names and icons from Claude terminals
**Plans**: 2 plans

Plans:
- [ ] 03-01: CodexCodeAgent implementation (commands, permissions, config)
- [ ] 03-02: Codex session tracking and terminal identification

### Phase 4: UI Integration
**Goal**: Users can select agent during session creation and distinguish agent types visually in terminals
**Depends on**: Phase 3
**Requirements**: REQ-U1, REQ-U2, REQ-U3
**Success Criteria** (what must be TRUE):
  1. Session creation form includes agent dropdown that defaults to lanes.defaultAgent setting
  2. Permission UI adapts to selected agent (Claude: acceptEdits/bypassPermissions, Codex: read-only/workspace-write/full-access)
  3. Terminal titles include agent name and display agent-specific icons
**Plans**: 1 plan

Plans:
- [ ] 04-01: Agent selector form and terminal differentiation UI

### Phase 5: Testing & Validation
**Goal**: Multi-agent system verified with comprehensive tests and backward compatibility confirmed
**Depends on**: Phase 4
**Requirements**: REQ-T1, REQ-T2, REQ-T3, REQ-T4
**Success Criteria** (what must be TRUE):
  1. All CodexCodeAgent abstract methods have passing unit tests
  2. Agent factory correctly creates agents from settings with proper error handling
  3. Session form agent selection persists and updates permission UI correctly
  4. All existing Claude Code tests pass unchanged with no regression in session lifecycle
**Plans**: 2 plans

Plans:
- [ ] 05-01: CodexCodeAgent and factory unit tests
- [ ] 05-02: Integration tests and backward compatibility validation

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation Refactoring | 0/4 | Not started | - |
| 2. Agent Abstraction Enhancement | 0/3 | Not started | - |
| 3. Codex CLI Integration | 0/2 | Not started | - |
| 4. UI Integration | 0/1 | Not started | - |
| 5. Testing & Validation | 0/2 | Not started | - |
