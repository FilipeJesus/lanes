# Milestones: Lanes

## v1.0 Codex CLI Support (Shipped: 2026-02-10)

**Delivered:** Added OpenAI Codex CLI as a second supported agent in Lanes, with full session lifecycle management, agent selection UI, and backward-compatible Claude Code support.

**Phases completed:** 1-5 (12 plans total)

**Key accomplishments:**

- Eliminated hardcoded Claude assumptions — codebase is fully agent-agnostic with dependency injection throughout
- Built agent factory with CLI availability detection, singleton caching, and VS Code settings integration
- Implemented CodexCodeAgent with full command building, permission mapping, and filesystem-based session ID capture
- Added agent selection dropdown in session creation form with dynamic CLI availability checks
- Fixed 4 security/correctness issues and added 57 new tests covering the multi-agent system
- Maintained 100% backward compatibility with 15 legacy command aliases

**Stats:**

- 86 files created/modified
- 11,572 lines added (TypeScript)
- 5 phases, 12 plans
- Completed in a single day (2026-02-10)
- 705 tests passing (57 new, zero regressions)

**Git range:** `e469668` -> `121e41d`

**Tech debt:** 18 non-blocking items (3 important, 15 minor) — see milestones/v1.0-MILESTONE-AUDIT.md

**What's next:** Address tech debt (duplicate utilities, status validation) and plan next feature milestone

---
