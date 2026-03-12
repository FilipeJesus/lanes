<p align="center">
  <a href="https://lanes.pro">
    <img src="media/lanes-default-256px.png" alt="Lanes Logo" width="128" />
  </a>
</p>

# Lanes: AI Project Management

**Manage multiple, isolated AI coding sessions across VS Code, JetBrains IDEs, and the terminal.**

Lanes uses Git Worktrees to give every agent session its own isolated file system and dedicated terminal. Supports Claude Code, Codex CLI, Gemini CLI, Cortex Code, and OpenCode out of the box. No more context contamination. No more half-finished files clashing with each other.

<video src="https://raw.githubusercontent.com/FilipeJesus/lanes/main/media/lanes-demo.mp4#t=4" autoplay loop muted playsinline controls alt="Lanes in action"></video>

---

## Features

- **True Isolation** - Each session gets its own Git worktree and dedicated terminal
- **Session Resume** - Automatically resumes where you left off using `--resume`
- **Real-Time Status** - See which agents are working, waiting, or have errors
- **Built-in Diff Viewer** - Review all changes before merging back
- **One-Click Cleanup** - Delete the worktree when done, keep the branch for merging
- **Workflow System** - Optional MCP-based workflows guide agents through structured phases (plan → implement → test → review)
- **Multi-Agent Support** - Claude Code, Codex CLI, Gemini CLI, and Cortex Code with inline logo selector for easy switching
- **File Attachments** - Drag-and-drop files into the session form to include with your prompt
- **Tmux Terminal Backend** - Persistent tmux sessions via `lanes.terminalMode` setting
- **Local Settings Propagation** - Auto-propagate `.claude/settings.local.json` and `.gemini/settings.json` to worktrees
- **Local Web UI** - Browser-based dashboard for managing registered projects on the current machine via `lanes web`
- **HTTP Daemon** - Machine-wide REST API + SSE events for local session management via `lanes daemon start`

Visit [our website](https://lanes.pro) for more information.

---

## Available On

| Platform | Status | Install |
|----------|--------|---------|
| **VS Code** | Stable | [Marketplace](https://marketplace.visualstudio.com/items?itemName=FilipeMarquesJesus.lanes) · [Open VSX](https://open-vsx.org/extension/FilipeMarquesJesus/lanes) |
| **JetBrains IDEs** | Beta | [From source](https://github.com/FilipeJesus/lanes/tree/main/jetbrains-ide-plugin) |
| **CLI** | Stable | [From source](https://github.com/FilipeJesus/lanes/tree/main/src/cli) |
| **Web UI** | Beta | `lanes web` — [From source](https://github.com/FilipeJesus/lanes/tree/main/web-ui) |

---

## Feature Comparison

| Feature | VS Code | JetBrains (Beta) | CLI | Web UI (Beta) |
|---------|:-------:|:-----------------:|:---:|:-------------:|
| Create / list / delete / open sessions | ✓ | ✓ | ✓ | ✓ |
| Clear sessions | ✓ | ✓ | ✓ | — |
| Pin/protect sessions | ✓ | ✓ | — | ✓ |
| View git diff | ✓ | ✓ | ✓ | ✓ |
| Repair broken worktrees | ✓ | ✓ | ✓ | — |
| Claude Code / Codex / Gemini / Cortex / OpenCode | ✓ | ✓ | ✓ | ✓ |
| Workflow templates (built-in + custom) | ✓ | ✓ | ✓ | ✓ |
| MCP-based workflows | ✓ | ✓ | ✓ | — |
| Integrated terminal | ✓ | ✓ | N/A | — |
| Tmux backend | ✓ | ✓ | ✓ | — |
| File attachments | ✓ | — | — | — |
| Search in worktree | ✓ | — | — | — |
| Chime notifications | ✓ | — | — | — |
| Session insights | ✓ | — | ✓ | ✓ |
| Status hooks | ✓ | ✓ | ✓ | — |
| Local settings propagation | ✓ | ✓ | ✓ | — |
| Multi-project dashboard | — | — | — | ✓ |
| Real-time SSE status updates | — | — | — | ✓ |
| Workflow visualization | — | — | — | ✓ |

---

## Quick Start

### Platform Support

- **macOS** - Fully supported
- **Linux** - Fully supported
- **Windows** - Not currently supported (WSL may work)

### Prerequisites

```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code
claude login

# Install jq (required for status tracking)
brew install jq          # macOS
sudo apt-get install jq  # Ubuntu/Debian

# Optional: Install Codex CLI for OpenAI agent support
npm install -g @openai/codex

# Optional: Install Gemini CLI for Google agent support
npm install -g @google/gemini-cli
gemini
```

### Install

#### VS Code (Marketplace)

Search for **"Lanes"** in the VS Code Extensions marketplace, or visit the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FilipeMarquesJesus.lanes).

**From Source:**

```bash
git clone https://github.com/FilipeJesus/lanes.git
cd lanes && npm install
npm run compile && npx vsce package
# Then install the .vsix via "Extensions: Install from VSIX..."
```

`npm run compile` will install `web-ui` dependencies automatically if they are not present yet. The `pre-commit` hook intentionally disables that auto-install so commits fail fast instead of stalling inside a git hook.

Or use the local install script: `./scripts/install-local-vscode.sh`

This script expects the VS Code `code` command to be available on your `PATH`.

#### JetBrains IDEs (From Source)

```bash
git clone https://github.com/FilipeJesus/lanes.git
cd lanes && npm install && npm run compile
cd jetbrains-ide-plugin
./gradlew buildPlugin
# Install the plugin from jetbrains-ide-plugin/build/distributions/
```

Supports IntelliJ IDEA, WebStorm, PyCharm, GoLand, and other JetBrains 2024.1+ IDEs.

#### CLI (From Source)

```bash
git clone https://github.com/FilipeJesus/lanes.git
cd lanes && npm install && npm run compile
npm link
lanes --help
```

---

## Usage

### VS Code / JetBrains

1. Open the **Lanes** sidebar (or tool window in JetBrains)
2. Fill in **Session Name** and optionally a **Starting Prompt**
3. Click **Create Session**
4. A terminal opens with Claude running in an isolated worktree

Click any session to resume it. Click the trash icon to delete (branch is preserved for merging).

### CLI

```bash
lanes create my-feature --prompt "Implement the login page"
lanes list
lanes open my-feature
lanes diff my-feature
lanes delete my-feature
```

### Daemon & Web UI

Lanes v2 introduces a machine-wide HTTP daemon and a browser-based dashboard for managing registered projects on the current machine.

**Architecture:** Lanes keeps a machine-wide project registry in `~/.lanes/projects.json` and a single local daemon process that serves registered projects by `projectId`. The web UI is served locally and connects to `127.0.0.1`, so remote access requires SSH tunneling or your own reverse proxy.

#### 1. Register projects with the machine-wide gateway

```bash
cd ~/projects/my-app
lanes daemon register .

cd ~/projects/my-api
lanes daemon register .
```

Registered projects are stored in `~/.lanes/projects.json`.

#### 2. Start the machine-wide daemon

```bash
cd ~/projects/my-app
lanes daemon start              # optional: first start can choose --port 9100
```

The daemon writes its PID, port, and auth token to `~/.lanes/daemon.pid`, `~/.lanes/daemon.port`, and `~/.lanes/daemon.token`. Starting it from a repo also auto-registers that repo in `~/.lanes/projects.json`. Once it is running, use `lanes daemon register .` in other repos you want the daemon to serve.

#### 3. Launch the web UI

```bash
lanes web
# → Serving at http://127.0.0.1:3847
```

This starts a local gateway that discovers registered projects and serves the browser dashboard. Open the URL on the same machine to see:

- **Dashboard** — All projects as cards with health indicators, session counts, and uptime
- **Project view** — Session list with real-time status updates via SSE; create, delete, pin/unpin sessions
- **Session detail** — Status, worktree info, workflow progress tracker, unified diff viewer, and AI insights
- **Workflow browser** — Browse built-in and custom workflow templates with step definitions

```bash
# Custom port
lanes web --port 4000

# Source checkout: run Vite on 5173 and the gateway on 3847 (or your custom port)
lanes web --dev

# API-only mode (no static UI, just the gateway endpoint)
lanes web --no-ui
```

#### 4. Daemon management

```bash
lanes daemon registered  # List all registered projects
lanes daemon status      # Check if the machine-wide daemon is running
lanes daemon stop        # Stop the machine-wide daemon
lanes daemon unregister .  # Remove the current project from the global registry
```

#### 5. VS Code daemon mode (optional)

You can route VS Code operations through the daemon instead of calling core services directly. This is useful if you want the web UI and VS Code to share the same session state source.

1. Open VS Code Settings
2. Search for `lanes.useDaemon`
3. Enable it (VS Code will prompt to reload)

When enabled, session create/delete/diff/insights/pin operations go through the daemon REST API. For now, this setup is best suited to single-root VS Code workspaces.

#### REST API

The daemon exposes a REST API at `http://127.0.0.1:<port>/api/v1/`. All endpoints except `/health` require a Bearer token from `~/.lanes/daemon.token`. Project-specific operations use routes under `/api/v1/projects/:projectId/...`.

```bash
TOKEN=$(cat ~/.lanes/daemon.token)
PORT=$(cat ~/.lanes/daemon.port)

# Health check (no auth required)
curl http://127.0.0.1:$PORT/api/v1/health

# List registered projects and capture one projectId
PROJECT_ID=$(
  curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:$PORT/api/v1/projects \
  | jq -r '.projects[0].projectId'
)

# List sessions for a project
curl -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:$PORT/api/v1/projects/$PROJECT_ID/sessions

# Create a session for a project
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionName":"my-feature","prompt":"Implement login"}' \
  http://127.0.0.1:$PORT/api/v1/projects/$PROJECT_ID/sessions

# Subscribe to real-time events (SSE) for a project
curl -N -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:$PORT/api/v1/projects/$PROJECT_ID/events
```

<details>
<summary>Full endpoint reference</summary>

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Health check (no auth) |
| GET | `/api/v1/projects` | List registered projects |
| GET | `/api/v1/projects/:projectId/discovery` | Project metadata, uptime, session count |
| GET | `/api/v1/projects/:projectId/sessions` | List sessions |
| POST | `/api/v1/projects/:projectId/sessions` | Create a session |
| DELETE | `/api/v1/projects/:projectId/sessions/:name` | Delete a session |
| GET | `/api/v1/projects/:projectId/sessions/:name/status` | Session status |
| POST | `/api/v1/projects/:projectId/sessions/:name/open` | Open or resume a session |
| POST | `/api/v1/projects/:projectId/sessions/:name/clear` | Clear session state |
| POST | `/api/v1/projects/:projectId/sessions/:name/pin` | Pin a session |
| DELETE | `/api/v1/projects/:projectId/sessions/:name/pin` | Unpin a session |
| GET | `/api/v1/projects/:projectId/sessions/:name/diff` | Unified diff (`?includeUncommitted`) |
| GET | `/api/v1/projects/:projectId/sessions/:name/diff/files` | Changed file list (`?includeUncommitted`) |
| GET | `/api/v1/projects/:projectId/sessions/:name/worktree` | Worktree info |
| GET | `/api/v1/projects/:projectId/sessions/:name/workflow` | Workflow state |
| GET | `/api/v1/projects/:projectId/sessions/:name/insights` | Session insights (`?includeAnalysis`) |
| GET | `/api/v1/projects/:projectId/events` | SSE event stream |
| GET | `/api/v1/projects/:projectId/agents` | List available agents |
| GET | `/api/v1/projects/:projectId/agents/:name` | Agent details |
| GET | `/api/v1/projects/:projectId/config` | All config values |
| GET | `/api/v1/projects/:projectId/config/:key` | Single config value |
| PUT | `/api/v1/projects/:projectId/config/:key` | Set a config value |
| GET | `/api/v1/projects/:projectId/git/branches` | List branches (`?includeRemote`) |
| POST | `/api/v1/projects/:projectId/git/repair` | Repair broken worktrees |
| GET | `/api/v1/projects/:projectId/workflows` | List workflow templates (`?includeBuiltin&includeCustom`) |
| POST | `/api/v1/projects/:projectId/workflows` | Create a workflow template |
| POST | `/api/v1/projects/:projectId/workflows/validate` | Validate workflow YAML |
| GET | `/api/v1/projects/:projectId/terminals` | List terminals (`?sessionName`) |
| POST | `/api/v1/projects/:projectId/terminals` | Create a terminal |
| POST | `/api/v1/projects/:projectId/terminals/:name/send` | Send input to a terminal |

</details>

---

## Gemini CLI Notes

- **Authentication**: Configure your Gemini API key (e.g., `GEMINI_API_KEY`) before launching Gemini CLI sessions.
- **MCP workflows**: Lanes writes MCP server config into `.gemini/settings.json` when workflows are enabled.
- **Resume behavior**: Lanes resumes Gemini sessions using `gemini --resume` without an explicit session ID, which picks the most recent session for that project. If you run multiple Gemini sessions in the same worktree, the latest one is resumed.
- **Status tracking**: Gemini CLI hooks update `working`/`waiting_for_user`/`idle` status via `.gemini/settings.json`.

---

## Commands

| Command | Description |
|---------|-------------|
| `Lanes: Create Session` | Create a new isolated session |
| `Lanes: Open Session` | Open/focus an existing session's terminal |
| `Lanes: Delete Session` | Remove a session's worktree and terminal |
| `Lanes: Clear Session` | Reset session state while preserving the worktree |
| `Lanes: Show Git Changes` | Open the diff viewer for a session |
| `Lanes: Create Terminal` | Create an additional terminal for a session |
| `Lanes: Search in Worktree` | Open VS Code search scoped to a session's worktree |
| `Lanes: Repair Broken Worktrees` | Fix broken worktrees after container rebuilds |
| `Lanes: Setup Status Hooks` | Configure Claude hooks for status indicators |

### CLI Commands

| Command | Description |
|---------|-------------|
| `lanes create <name>` | Create a new isolated session |
| `lanes list` | List all sessions |
| `lanes open <name>` | Open/resume a session |
| `lanes delete <name>` | Delete a session's worktree |
| `lanes clear <name>` | Reset session state, preserve worktree |
| `lanes diff <name>` | Show git diff for a session |
| `lanes repair` | Fix broken worktrees |
| `lanes insights <name>` | Show session insights |
| `lanes pin <name>` | Pin/protect a session |
| `lanes unpin <name>` | Unpin a session |
| `lanes status` | Show status of all sessions |
| `lanes workflow <name>` | Run a workflow template |
| `lanes config` | View/edit configuration |
| `lanes daemon start` | Start the machine-wide HTTP daemon and register the current project |
| `lanes daemon register [path]` | Register a project with the machine-wide gateway |
| `lanes daemon unregister [path]` | Remove a project from the machine-wide gateway |
| `lanes daemon registered` | List globally registered projects |
| `lanes daemon stop` | Stop the running daemon |
| `lanes daemon status` | Check daemon status (PID, port) |
| `lanes daemon logs` | Show daemon log info |
| `lanes web` | Start the web UI gateway + dashboard |
| `lanes uninstall` | Uninstall all globally installed Lanes CLI versions |

---

## Advanced

- **[Claude Harness & Workflows](docs/CLAUDE-HARNESS.md)** - Structured task management and MCP-based workflow guides for long-running sessions
- **[Website](https://lanes.pro)** - Full documentation and guides

---

## Roadmap

- [x] Session status indicators (idle, working, waiting)
- [x] Session resume functionality
- [x] Session templates for common workflows
- [x] Multi-agent support (Claude Code + Codex CLI)
- [x] File attachments in session form
- [x] Tmux terminal backend
- [x] Local settings propagation to worktrees
- [x] Additional agent integrations
- [x] JetBrains IDE plugin (beta)
- [x] Standalone CLI
- [x] HTTP daemon with REST API and SSE events
- [x] Browser web UI dashboard
- [ ] Windows support
- [ ] Multi-repo support

---

## Contributing

Contributions are welcome!

### Development Setup

```bash
git clone https://github.com/FilipeJesus/lanes.git
cd lanes
npm install
```

Press `F5` in VS Code to launch the Extension Development Host.

### Scripts

```bash
npm test          # Run the full test suite
npm run test:vscode # Run the VS Code test harness only
npm run lint      # Run ESLint
npm run compile   # Compile TypeScript
npm run watch     # Watch mode for development
```

The `pre-commit` hook uses a hook-safe VS Code test runner that reuses a locally installed VS Code instance instead of downloading one during the hook, and it avoids auto-installing missing `web-ui` dependencies during the hook.

### Pull Request Guidelines

1. Fork the repo and create a feature branch (`git checkout -b feature/amazing-feature`)
2. Make your changes and ensure tests pass
3. Commit with clear messages
4. Push and open a Pull Request

Please ensure your PR:
- Passes all existing tests (`npm test`)
- Includes tests for new functionality
- Follows the existing code style (`npm run lint`)

### Project Structure

| Directory | Purpose |
|-----------|---------|
| `src/core/` | Platform-agnostic business logic (services, agents, validation, workflows) |
| `src/core/codeAgents/` | Agent implementations (Claude, Codex, Cortex, Gemini, OpenCode) + factory |
| `src/core/services/` | Session handling, diff, insights, file operations |
| `src/core/interfaces/` | Platform abstractions (`IConfigProvider`, `IHandlerContext`, etc.) |
| `src/vscode/` | VS Code extension (commands, providers, adapters, services) |
| `src/cli/` | Standalone CLI (`lanes` command, Commander.js) |
| `src/daemon/` | HTTP daemon (server, router, auth, lifecycle, registry, gateway, client) |
| `src/mcp/` | MCP server for workflow tools |
| `src/jetbrains-ide-bridge/` | JetBrains IDE HTTP bridge |
| `web-ui/` | Browser-based dashboard (React 19 + Vite + TypeScript) |
| `jetbrains-ide-plugin/` | JetBrains IDE plugin (Kotlin/Gradle) |
| `src/test/` | Test suite (mirrors source structure) |

---

## License

MIT - see [LICENSE](LICENSE) for details.

---

## Support

Enjoying Lanes? Consider supporting its development with a voluntary donation.

[![Donate](https://img.shields.io/badge/Donate-PayPal-blue.svg)](https://www.paypal.com/donate/?business=JEYBHRR3E4PEU&no_recurring=0&item_name=Loving+Lanes?+I+am+too%21+Thank+you+so+much+for+supporting+it%27s+development.&currency_code=GBP)

---

## Links

- [Website](https://lanes.pro)
- [GitHub Repository](https://github.com/FilipeJesus/lanes)
- [Report Issues](https://github.com/FilipeJesus/lanes/issues)
- [Claude Code Documentation](https://claude.com/claude-code)
