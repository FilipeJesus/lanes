# Shared agent instructions

Repository-wide guidance is in [AGENTS.md](../AGENTS.md). Reusable procedures are
stored as `skills/<name>/SKILL.md` using the [Agent Skills specification](https://agentskills.io/specification).
The `.agents/skills/` location follows the [cross-client discovery convention](https://agentskills.io/client-implementation/adding-skills-support).
Clients that do not discover this directory can read the files linked from
`AGENTS.md` directly.

## Migration map

| Previous location | Shared location |
| --- | --- |
| `AGENT.md`, imported by `CLAUDE.md` | `AGENTS.md` |
| `.claude/skills/create-pr/SKILL.md` | `.agents/skills/create-pr/SKILL.md` |
| `.claude/skills/new-agent/SKILL.md` | `.agents/skills/new-agent/SKILL.md` |
| `.claude/agents/<role>.md` | `.agents/skills/<role>/SKILL.md` |
| `claude-progress.txt` created by the initializer | `agent-progress.txt` |

All six former roles are available as skills: `coder`, `vscode-expert`,
`shell-ops`, `test-engineer`, `code-reviewer`, and `initializer`. Their role names,
test planning, review checks, and safety constraints are retained. Stale source
paths have been updated to the current `src/core/` and `src/vscode/` layout.
The pull request skill no longer inserts a fixed Claude co-author identity.

Repository workflows in `.lanes/workflows/` run steps directly, loading these
skills where needed. They do not require a host-specific named sub-agent registry.
The GSD workflow still requires the separately installed GSD skills and their
client-supported invocation syntax.

## Client-specific settings

`AGENTS.md` and Agent Skills provide instructions, not a shared runtime
configuration or permission enforcement mechanism. The former
`.claude/settings.json` and agent frontmatter contained these client settings:

| Previous setting | Migration |
| --- | --- |
| `typescript-lsp@claude-plugins-official` enabled | Configure TypeScript language tooling in the editor or client you use. There is no portable plugin toggle. |
| Allow `npm`, `npx`, and `git` shell commands | These remain the development tools documented in `AGENTS.md`; configure execution permissions in your client. |
| Allow Lanes MCP tools `workflow_start`, `workflow_set_tasks`, `workflow_status`, `workflow_advance`, `workflow_context`, and `session_create` | Connect the Lanes MCP server and configure its tool permissions in your client. |
| Deny `./scripts/release.sh*` | Preserved as an instruction in `AGENTS.md`; configure a client-side deny rule if you need runtime enforcement. |
| Agent `model: sonnet` / `model: inherit` | Use the model selected in the active client. |
| Agent `tools: Read, Edit, Write, Grep, Glob, Bash, Task` (varying by role) | Use equivalent client capabilities. Code review remains read-only; delegation is optional. Tool access controls belong to the client. |

The development container provides Node.js, Git, GitHub CLI, and the extension
test dependencies. Install your chosen coding CLI and configure authentication
in that environment; no Claude installation or host credential mounts are required.

Lanes itself still supports Claude Code and other backends. Product paths such
as `.claude/settings.local.json`, `.codex/`, `.agents/mcp_config.json`, and the
shared legacy `.claude-session` / `.claude-status` filenames are runtime
integration details and remain unchanged.
