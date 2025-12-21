# 🤖 Claude Orchestra

**Manage multiple, isolated Claude Code sessions directly inside VS Code.**

Claude Orchestra is a VS Code extension that helps you parallelize your AI coding workflows. It uses **Git Worktrees** to give every agent session its own isolated file system and **Dedicated Terminals** to manage their lifecycle.

No more context contamination. No more half-finished files clashing with each other.

---

## ✨ Features

* **⚡ Instant Isolation:** Automatically creates a Git Worktree in a hidden `.worktrees/` folder for every new task.
* **🖥️ Dedicated Terminals:** Spawns a named terminal (e.g., `Claude: fix-login`) for each session, running `claude` automatically.
* **🗂️ Session Sidebar:** View all active sessions in a dedicated "Claude Sessions" sidebar view.
* **🔄 Context Persistence:** Closing VS Code? No problem. The extension scans your worktrees and lets you resume sessions instantly.
* **🧹 One-Click Cleanup:** Delete the worktree and kill the terminal process with a single click (keeps your git branch safe).

---

## 🚀 How It Works

1.  **Create:** You click **+** and name your session (e.g., `refactor-api`).
2.  **Orchestrate:** The extension runs `git worktree add .worktrees/refactor-api -b refactor-api`.
3.  **Launch:** It opens a new terminal tab, `cd`s into that folder, and starts `claude`.
4.  **Code:** The agent works on files in that isolated folder. Changes are staged on the `refactor-api` branch.

---

## 📦 Installation (Local / DevContainer)

Since this extension is designed for private/internal use, you install it via VSIX.

### Prerequisite
You must have the Anthropic `claude` CLI installed and authenticated in your environment (or DevContainer).
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### Build & Install

1. Clone this repository and install dependencies:
   ```bash
   git clone https://github.com/your-username/claude-orchestra.git
   cd claude-orchestra
   npm install
   ```

2. Package the extension as a VSIX:
   ```bash
   npm run compile
   npx vsce package
   ```

3. Install the VSIX in VS Code:
   - Open VS Code
   - Press `Ctrl+Shift+P` / `Cmd+Shift+P`
   - Run **Extensions: Install from VSIX...**
   - Select the generated `.vsix` file

---

## 🎮 Usage

### Creating a Session
1. Open the **Claude Sessions** sidebar (robot icon in the Activity Bar)
2. Click the **+** button
3. Enter a session name (e.g., `fix-auth-bug`)
4. A terminal opens automatically with `claude` running in the isolated worktree

### Resuming a Session
- Click any session in the sidebar to reopen its terminal
- The extension reuses existing terminals if already open

### Deleting a Session
- Click the **trash icon** next to a session
- Confirm the deletion
- The worktree is removed and the terminal is killed
- Your git branch remains intact for later merging

### Session Status Indicators

The sidebar shows visual status indicators for each session:

| Status | Icon | Description |
|--------|------|-------------|
| Waiting | Bell (yellow) | Claude is waiting for user input |
| Working | Sync (animated) | Claude is actively processing |
| Error | Error (red) | An error occurred |
| Idle | Git branch | Default/inactive state |

**New sessions** get status hooks configured automatically when created.

**For existing sessions** (created before this feature), right-click and select **"Setup Status Hooks"**.

---

## 🔧 Commands

| Command | Description |
|---------|-------------|
| `Claude Orchestra: Create Session` | Create a new isolated session |
| `Claude Orchestra: Open Session` | Open/focus an existing session's terminal |
| `Claude Orchestra: Delete Session` | Remove a session's worktree and terminal |
| `Claude Orchestra: Setup Status Hooks` | Configure Claude hooks for status indicators |

---

## 📁 Project Structure

```
your-repo/
├── .worktrees/           # Hidden folder containing all session worktrees
│   ├── fix-auth-bug/     # Isolated worktree for this session
│   ├── refactor-api/     # Another isolated session
│   └── add-tests/        # Each has its own file state
├── src/                  # Your main codebase
└── ...
```

---

## 🛣️ Roadmap

- [x] Session status indicators (idle, working, waiting)
- [ ] Session descriptions and metadata
- [ ] Merge assistant (review and merge session branches)
- [ ] Session templates for common workflows
- [ ] Multi-repo support

---

## 🤝 Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.

---

## 📄 License

MIT