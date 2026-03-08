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
- **Remote Web UI** - Browser-based dashboard for managing sessions across multiple projects via `lanes web`
- **HTTP Daemon** - REST API + SSE events for remote session management via `lanes daemon start`

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

Or use the local install script: `./scripts/install-local.sh`

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

### Web UI

```bash
# Start the web dashboard (opens http://127.0.0.1:3847)
lanes web

# Custom port
lanes web --port 4000

# API-only mode (no static UI served)
lanes web --no-ui
```

The web UI discovers all running daemons and provides a browser-based dashboard with:
- Multi-project overview with health monitoring
- Session management with real-time status updates via SSE
- Unified diff viewer and insights panel
- Workflow step progress tracker and template browser

**Note:** Start a daemon for each project first with `lanes daemon start`.

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
| `lanes daemon start` | Start HTTP daemon for the current project |
| `lanes daemon stop` | Stop the running daemon |
| `lanes daemon status` | Check daemon status |
| `lanes web` | Start the web UI dashboard |

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
- [x] Remote web UI dashboard
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
npm test          # Run tests
npm run lint      # Run ESLint
npm run compile   # Compile TypeScript
npm run watch     # Watch mode for development
```

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

| File | Purpose |
|------|---------|
| `src/extension.ts` | Main entry point, commands, terminal management |
| `src/AgentSessionProvider.ts` | Active sessions tree view |
| `src/PreviousSessionProvider.ts` | Previous sessions tree view |
| `src/SessionFormProvider.ts` | New session form webview |
| `src/GitChangesPanel.ts` | Git diff viewer panel |
| `src/gitService.ts` | Git operations (worktrees, branches) |
| `src/ProjectManagerService.ts` | Project Manager integration |
| `src/cli/` | Standalone CLI entry point and commands |
| `src/daemon/` | HTTP daemon server, gateway, registry, auth, lifecycle |
| `src/codeAgents/` | Agent abstraction (CodeAgent, ClaudeCodeAgent, CodexAgent, factory) |
| `src/services/TmuxService.ts` | Tmux terminal backend |
| `src/services/TerminalService.ts` | Terminal management abstraction |
| `src/services/SettingsFormatService.ts` | TOML/JSON settings format handling |
| `src/localSettings.ts` | Local settings propagation helper |
| `web-ui/` | Browser-based dashboard (React 19 + Vite + TypeScript) |
| `jetbrains-ide-plugin/` | JetBrains IDE plugin (Kotlin/Gradle) |
| `src/test/*.test.ts` | Test suite |
| `package.json` | Extension manifest |

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
