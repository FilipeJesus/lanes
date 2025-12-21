# Claude Lanes

**Manage multiple, isolated Claude Code sessions directly inside VS Code.**

Claude Lanes is a VS Code extension that helps you parallelize your AI coding workflows. It uses **Git Worktrees** to give every agent session its own isolated file system and **Dedicated Terminals** to manage their lifecycle.

No more context contamination. No more half-finished files clashing with each other.

![Claude Lanes in action](media/screenshot.png)

---

## Features

- **Instant Isolation** - Automatically creates a Git Worktree in a hidden `.worktrees/` folder for every new task
- **Form-Based Session Creation** - Create sessions with a name, starting prompt, and acceptance criteria
- **Dedicated Terminals** - Spawns a named terminal (e.g., `Claude: fix-login`) for each session, running `claude` automatically
- **Session Sidebar** - View all active sessions with real-time status indicators
- **Session Resume** - Automatically resumes Claude sessions using the `--resume` flag when reopening
- **Context Persistence** - Closing VS Code? No problem. The extension scans your worktrees and lets you resume sessions instantly
- **One-Click Cleanup** - Delete the worktree and kill the terminal process with a single click (keeps your git branch safe)

---

## How It Works

1. **Create** - Fill in the session form with a name, optional starting prompt, and acceptance criteria
2. **Isolate** - The extension runs `git worktree add .worktrees/<session-name> -b <session-name>`
3. **Launch** - It opens a new terminal tab, `cd`s into that folder, and starts `claude` with your prompt
4. **Code** - The agent works on files in that isolated folder. Changes are staged on the session's branch
5. **Resume** - Reopen any session and it automatically resumes where you left off

---

## Installation

### Prerequisites

You must have [Claude Code](https://claude.com/claude-code) installed and authenticated:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### From VS Code Marketplace

Search for **"Claude Lanes"** in the VS Code Extensions marketplace and click Install.

### From Source (Development)

1. Clone this repository and install dependencies:
   ```bash
   git clone https://github.com/FilipeJesus/claude-lanes.git
   cd claude-lanes
   npm install
   ```

2. Package the extension as a VSIX:
   ```bash
   npm run compile
   npx vsce package
   ```

3. Install the VSIX in VS Code:
   - Press `Ctrl+Shift+P` / `Cmd+Shift+P`
   - Run **Extensions: Install from VSIX...**
   - Select the generated `.vsix` file

---

## Usage

### Creating a Session

1. Open the **Claude Lanes** sidebar (robot icon in the Activity Bar)
2. Fill in the **New Session** form:
   - **Session Name** (required) - Used as the Git branch name (e.g., `fix-auth-bug`)
   - **Starting Prompt** (optional) - Describe the task for Claude to work on
   - **Acceptance Criteria** (optional) - Define what success looks like
3. Click **Create Session**
4. A terminal opens automatically with Claude running in the isolated worktree

### Resuming a Session

- Click any session in the sidebar to reopen its terminal
- The extension automatically uses `claude --resume <session-id>` to continue where you left off
- If the terminal is already open, it will be focused
- **Note:** If a Claude Lanes terminal is open but Claude has exited, the extension cannot restart it automatically. To fix this, close the terminal and click the session again in the sidebar.

### Deleting a Session

- Click the **trash icon** next to a session
- Confirm the deletion
- The worktree is removed and the terminal is killed
- Your git branch remains intact for later merging

### Session Status Indicators

The sidebar shows real-time visual status indicators for each session:

| Status | Icon | Description |
|--------|------|-------------|
| Waiting | Bell (yellow) | Claude is waiting for user input |
| Working | Sync (animated) | Claude is actively processing |
| Error | Error (red) | An error occurred |
| Idle | Git branch | Default/inactive state |

Status hooks are configured automatically when you create a new session.

For existing sessions (created before this feature), right-click and select **"Setup Status Hooks"**.

---

## Commands

| Command | Description |
|---------|-------------|
| `Claude Lanes: Create Session` | Create a new isolated session |
| `Claude Lanes: Open Session` | Open/focus an existing session's terminal |
| `Claude Lanes: Delete Session` | Remove a session's worktree and terminal |
| `Claude Lanes: Setup Status Hooks` | Configure Claude hooks for status indicators |

---

## Project Structure

When you create sessions, they are stored in a `.worktrees/` folder in your repository:

```
your-repo/
├── .worktrees/           # Hidden folder containing all session worktrees
│   ├── fix-auth-bug/     # Isolated worktree for this session
│   │   ├── .claude/      # Claude settings and hooks for this session
│   │   └── ...           # Full copy of your codebase
│   ├── refactor-api/     # Another isolated session
│   └── add-tests/        # Each has its own file state
├── src/                  # Your main codebase
└── ...
```

Each worktree is a complete, isolated copy of your repository on its own Git branch.

---

## Roadmap

- [x] Session status indicators (idle, working, waiting)
- [x] Session descriptions and metadata (starting prompt, acceptance criteria)
- [x] Session resume functionality
- [ ] Merge assistant (review and merge session branches)
- [ ] Session templates for common workflows
- [ ] Multi-repo support

---

## Contributing

Contributions are welcome! Here's how to get started:

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/FilipeJesus/claude-lanes.git
   cd claude-lanes
   npm install
   ```

2. Open in VS Code and press `F5` to launch the Extension Development Host

3. Make your changes and test them in the development host

### Running Tests

```bash
npm test          # Run full test suite
npm run lint      # Run ESLint
npm run compile   # Compile TypeScript
```

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure your PR:
- Passes all existing tests
- Includes tests for new functionality
- Follows the existing code style

---

## License

MIT - see [LICENSE](LICENSE) for details.

---

## Links

- [GitHub Repository](https://github.com/FilipeJesus/claude-lanes)
- [Report Issues](https://github.com/FilipeJesus/claude-lanes/issues)
- [Claude Code Documentation](https://claude.com/claude-code)