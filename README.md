<p align="center">
  <a href="https://claudelanes.com">
    <img src="media/claude-lanes-default-256px.png" alt="Claude Lanes Logo" width="128" />
  </a>
</p>

# Claude Lanes

**Manage multiple, isolated Claude Code sessions directly inside VS Code.**

Claude Lanes uses Git Worktrees to give every agent session its own isolated file system and dedicated terminal. No more context contamination. No more half-finished files clashing with each other.

![Claude Lanes in action](media/screenshot.png)

---

## Features

- **True Isolation** - Each session gets its own Git worktree and dedicated terminal
- **Session Resume** - Automatically resumes where you left off using `--resume`
- **Real-Time Status** - See which agents are working, waiting, or have errors
- **Built-in Diff Viewer** - Review all changes before merging back
- **One-Click Cleanup** - Delete the worktree when done, keep the branch for merging

Visit [our website](https://claudelanes.com) for more information.

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
```

### Install

Search for **"Claude Lanes"** in the VS Code Extensions marketplace, or visit the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=FilipeMarquesJesus.claude-lanes).

**From Source:**

```bash
git clone https://github.com/FilipeJesus/claude-lanes.git
cd claude-lanes && npm install
npm run compile && npx vsce package
# Then install the .vsix via "Extensions: Install from VSIX..."
```

---

## Usage

1. Open the **Claude Lanes** sidebar
2. Fill in **Session Name** and optionally a **Starting Prompt**
3. Click **Create Session**
4. A terminal opens with Claude running in an isolated worktree

Click any session to resume it. Click the trash icon to delete (branch is preserved for merging).

---

## Commands

| Command | Description |
|---------|-------------|
| `Claude Lanes: Create Session` | Create a new isolated session |
| `Claude Lanes: Open Session` | Open/focus an existing session's terminal |
| `Claude Lanes: Delete Session` | Remove a session's worktree and terminal |
| `Claude Lanes: Setup Status Hooks` | Configure Claude hooks for status indicators |

---

## Advanced

- **[Claude Harness](docs/CLAUDE-HARNESS.md)** - Structured task management for long-running sessions
- **[Website](https://claudelanes.com)** - Full documentation and guides

---

## Roadmap

- [x] Session status indicators (idle, working, waiting)
- [x] Session resume functionality
- [ ] Windows support
- [ ] Merge assistant (review and merge session branches)
- [ ] Session templates for common workflows
- [ ] Multi-repo support

---

## Contributing

Contributions are welcome!

### Development Setup

```bash
git clone https://github.com/FilipeJesus/claude-lanes.git
cd claude-lanes
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
| `src/ClaudeSessionProvider.ts` | Active sessions tree view |
| `src/PreviousSessionProvider.ts` | Previous sessions tree view |
| `src/SessionFormProvider.ts` | New session form webview |
| `src/GitChangesPanel.ts` | Git diff viewer panel |
| `src/gitService.ts` | Git operations (worktrees, branches) |
| `src/ProjectManagerService.ts` | Project Manager integration |
| `src/test/*.test.ts` | Test suite |
| `package.json` | Extension manifest |

---

## License

MIT - see [LICENSE](LICENSE) for details.

---

## Links

- [Website](https://claudelanes.com)
- [GitHub Repository](https://github.com/FilipeJesus/claude-lanes)
- [Report Issues](https://github.com/FilipeJesus/claude-lanes/issues)
- [Claude Code Documentation](https://claude.com/claude-code)
