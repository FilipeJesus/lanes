## [1.3.1](https://github.com/FilipeJesus/lanes/compare/v1.1.1...v1.3.1) (2026-02-16)

### Features

* add CI release workflows and conventional commit enforcement ([58828c8](https://github.com/FilipeJesus/lanes/commit/58828c8f8a2d86e2fa5844a2e7c2a9ea4fad3fb4))
* add Codex CLI support as second agent ([#118](https://github.com/FilipeJesus/lanes/issues/118)) ([400c4c2](https://github.com/FilipeJesus/lanes/commit/400c4c27e166a500e4cbc0fad4396e1a64a33efc))
* add Gemini CLI as a coding agent backend ([#128](https://github.com/FilipeJesus/lanes/issues/128)) ([b0dfc49](https://github.com/FilipeJesus/lanes/commit/b0dfc49c6bba6adb729488212d1e54b09e9cbed3))
* add Generate Insights for Claude sessions ([#127](https://github.com/FilipeJesus/lanes/issues/127)) ([eb1e30b](https://github.com/FilipeJesus/lanes/commit/eb1e30b1e9e30e96f30cc96e19578ea2e33df70a))
* add MCP workflow support for Codex CLI via config overrides ([#120](https://github.com/FilipeJesus/lanes/issues/120)) ([1c188ab](https://github.com/FilipeJesus/lanes/commit/1c188abcebe02614d1d86d7c31cf92bbe096fcf4))
* add OpenCode as a coding agent backend ([#136](https://github.com/FilipeJesus/lanes/issues/136)) ([04a663e](https://github.com/FilipeJesus/lanes/commit/04a663e8fca495d6474c424d93dcc1fd90c2a76f))
* add polling-based status tracking for hookless agents ([#142](https://github.com/FilipeJesus/lanes/issues/142)) ([1060a3f](https://github.com/FilipeJesus/lanes/commit/1060a3f218bb39e6549a082a9ebb8831bcd22808))
* add Snowflake Cortex Code as a coding agent ([#125](https://github.com/FilipeJesus/lanes/issues/125)) ([df223d8](https://github.com/FilipeJesus/lanes/commit/df223d8fcd1304df44102aeeada89e9b32c25df6))
* add tmux terminal backend with per-session mode persistence ([#117](https://github.com/FilipeJesus/lanes/issues/117)) ([9226682](https://github.com/FilipeJesus/lanes/commit/92266821bf42e0242804772a084d7207f1209f10))
* apply Terminal Noir design system to docs and blog pages ([#134](https://github.com/FilipeJesus/lanes/issues/134)) ([4bc8094](https://github.com/FilipeJesus/lanes/commit/4bc80945c2ad7b8c4d3b7504b8300cf0932d80c4))
* auto-prompt improvement with textarea shimmer ([#126](https://github.com/FilipeJesus/lanes/issues/126)) ([255983b](https://github.com/FilipeJesus/lanes/commit/255983b41169f232bdf396c3ed825225e3f3b221))
* auto-tag on release PR merge ([2c0579d](https://github.com/FilipeJesus/lanes/commit/2c0579da65cabb7853626d4c8365bf472e195915))
* deepen session insights with analysis engine and actionable recommendations ([#141](https://github.com/FilipeJesus/lanes/issues/141)) ([8ed16d7](https://github.com/FilipeJesus/lanes/commit/8ed16d7f2ee86edeed11686a9014d09b1aa6ff6f))
* defer agent CLI checks to session creation time ([#130](https://github.com/FilipeJesus/lanes/issues/130)) ([c405425](https://github.com/FilipeJesus/lanes/commit/c405425729b157a100a05accb026caedef4af59c))
* demo form automation and minor improvements ([#137](https://github.com/FilipeJesus/lanes/issues/137)) ([e615693](https://github.com/FilipeJesus/lanes/commit/e6156935fda3903bc237c125bf4b4193098af53e))
* replace agent dropdown with inline logo selector ([#121](https://github.com/FilipeJesus/lanes/issues/121)) ([b22c1c1](https://github.com/FilipeJesus/lanes/commit/b22c1c1362dffd42829819007478e296b394de3d))
* **sessions:** add pin/unpin sessions to keep important sessions at top ([#140](https://github.com/FilipeJesus/lanes/issues/140)) ([5554597](https://github.com/FilipeJesus/lanes/commit/55545970cd0c16c52c03abbeb19815a5738044b3))
* show VS Code notification alongside chime on session status change ([#139](https://github.com/FilipeJesus/lanes/issues/139)) ([78a4c1e](https://github.com/FilipeJesus/lanes/commit/78a4c1e2e22a28b0d0bd85ce3145cbb5cdd64c87))

### Bug Fixes

* include hyphens in TOML bare key regex for Codex MCP server names ([#122](https://github.com/FilipeJesus/lanes/issues/122)) ([ea78b51](https://github.com/FilipeJesus/lanes/commit/ea78b510e4fde795e04cdaf3d25f7d1ce90af982))
* prevent test failures during pre-commit hook execution ([#116](https://github.com/FilipeJesus/lanes/issues/116)) ([d206a7c](https://github.com/FilipeJesus/lanes/commit/d206a7c0462b72f55e32cee3fb6f75097d845ef6))
* remove colour from sparkle and paperclip icons ([#129](https://github.com/FilipeJesus/lanes/issues/129)) ([03b9a63](https://github.com/FilipeJesus/lanes/commit/03b9a638aff141d25f2dc1050942648523b2edb7))
* retain session form webview context when hidden ([088961a](https://github.com/FilipeJesus/lanes/commit/088961a4ad624e451044823c885a17e0aabf5f95))
* use absolute URL for demo video in README so it renders on GitHub ([d5c887a](https://github.com/FilipeJesus/lanes/commit/d5c887ac09d2b1e421c5d0e2a1c872f3af324ce9))
# Changelog

All notable changes to the Lanes extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-02-15

### Added
- OpenCode support as a coding agent backend (#136)
- Pin/unpin sessions to keep important sessions at the top of the sidebar (#140)
- VS Code notification alongside chime on session status change (#139)
- Session insights with analysis engine and actionable recommendations (#141)
- Polling-based status tracking for hookless agents (#142)
- Demo form automation and minor improvements (#137)
- Terminal Noir design system applied to docs and blog pages (#134)

### Changed
- Agent CLI availability checks deferred to session creation time instead of activation (#130)
- Agent metadata and logic moved into `CodeAgent` class hierarchy (#131)

### Fixed
- Remove colour from sparkle and paperclip icons for proper theme adaptation (#129)

### Docs
- Replace static screenshot with demo video on marketplace page (#138)

## [1.2.1] - 2026-02-11

### Added
- Gemini CLI support as a coding agent backend (#128)
- Snowflake Cortex Code support as a coding agent (#125)
- Generate Insights command — produces Markdown report with token usage, tool usage, skills, and MCP server calls from Claude session JSONL files (#127)
- Auto-prompt improvement — sparkles button sends prompt to the selected agent's CLI for AI-powered rewriting, with shimmer animation (#126)

### Changed
- `buildPromptImproveCommand` is now optional in base `CodeAgent` — agents that don't support prompt improvement return `null` (#126)

### Fixed
- Resolve correct agent when clearing Gemini/Codex sessions — previously used the global Claude agent, causing terminals not to be found (#128)

### Security
- Fix npm audit vulnerabilities — updated `@isaacs/brace-expansion`, `@modelcontextprotocol/sdk`, `hono`, and `lodash` to patched versions (#123)

## [1.2.0] - 2026-02-10

### Added
- Codex CLI support as a second agent alongside Claude Code (#118)
- Agent selection UI — inline logo selector in session creation form (#121)
- `lanes.defaultAgent` setting for configuring default agent
- Codex MCP workflow support via config overrides (#120)
- TOML settings format support for Codex configuration
- Tmux terminal backend — `lanes.terminalMode` setting (#117)
- File attachments — drag-and-drop upload in session form (#119)

### Changed
- `ClaudeSessionProvider` renamed to `AgentSessionProvider`
- Command IDs migrated from `claude-orchestra.*` to `lanes.*`
- Hookless agent support with polling-based session ID capture

### Fixed
- Include hyphens in TOML bare key regex for Codex MCP server names (#122)
- Prevent test failures during pre-commit hook execution (#116)

## [1.1.1] - 2026-02-09

### Features                                                                                                                                                                        
- Add file attachment support to session creation form (#114)                                                         
- Handle session clear across multiple VS Code windows (#113)
- Simplify session form — remove acceptance criteria, streamline permissions (#112)
- Add GSD-powered workflow template (#109)

### Fixes
- Use effectiveWorkflow for cleared session prompt generation (#110)
- Various concern fixes (#108)

### Refactors
- Remove MCP register_artefacts tool in favor of hook-based tracking (#111)

## [1.1.0] - 2026-01-26

### Added

- **Worktree Status Display** - Active sessions now show their Git worktree status (branch name, commit info) directly in the sidebar
- **Search in Worktree** - Quick search button for each session that opens VS Code search scoped to that session's worktree
- **Open Workflow State** - Inline button to open workflow-state.json for sessions with active workflows
- **Create Terminal** - Context menu option to create additional terminals for a session
- **Chime Sound Selection** - New setting to choose from multiple chime sounds when sessions complete
- **Local Settings Propagation** - Automatically propagate `.claude/settings.local.json` to new worktrees (configurable: copy/symlink/disabled)
- **Blog Section** - Added blog with development updates and project announcements
- **Local Install Script** - `scripts/install-local.sh` for quick local development installation
- **Session Clear Feature** - "Clear Session" command to reset session state while preserving the worktree
- **Resume Prompts** - Resume prompt guidance for cleared workflow sessions
- **Session Start Hook** - Workflow status synchronization on session start
- **Natural Speech Skill** - New natural-speech skill with refactored skill structure

### Changed

- **Improved Context Menu** - Reorganized session context menu with dynamic Enable/Disable Chime options
- **Session Restart → Session Clear** - Renamed restart functionality to "Clear Session" for better clarity
- **Artefact Tracking** - Improved artefact hook system with JSON context output and workflow definition snapshots
- **Workflow Resumption** - `workflow_status` MCP tool now automatically resumes workflows from persisted state
- **Context Management** - Enhanced workflow system with context management types for better agent coordination
- **Simplified Session Storage Configuration** - Removed `lanes.claudeSessionPath` and `lanes.claudeStatusPath` settings
- **Fixed Session Storage Path** - When global storage is disabled, session files now use fixed `.lanes/session_management/<session-name>/` path structure
- **Global Storage Setting Description** - Updated `lanes.useGlobalStorage` description to clarify non-global behavior
- **Blog Formatting** - Improved blog formatting and standardized navigation across website

### Fixed

- **Session ID Clearing** - Fixed session ID not being cleared when clearing session (prevents accidental --resume with old session)
- **Create Terminal Path** - Fixed Create Terminal to use correct worktreePath instead of resourceUri
- **Chime Context Key** - Fixed chime context key to update immediately after enable/disable
- **Artefact Hook JSON Path** - Corrected JSON path references and extracted artefact hook to separate script
- **Workflow Template Snapshot** - Removed problematic workflow definition snapshot that caused template loading issues

### Removed

- `lanes.claudeSessionPath` configuration setting
- `lanes.claudeStatusPath` configuration setting

### Migration

Users with custom `claudeSessionPath` or `claudeStatusPath` settings need to:
1. Note their current settings (will be automatically removed)
2. Decide which mode to use:
   - **Global storage (recommended):** Leave `lanes.useGlobalStorage` enabled (default)
   - **Non-global:** Disable `lanes.useGlobalStorage` to use `.lanes/session_management/`
3. Move existing session files to the new location if needed
4. See migration guide in `docs/plans/2026-01-21-simplify-config-migration-guide.md`

## [1.0.4] - 2026-01-15

### Added
- **Audio Chimes** click the bell icon on a session to enable chimes! Note that this is implemented in a less than ideal way, you will need to interact with the new session form when you first open vs code before you will be able to hear chimes. I hope to fix this in the future.

## [1.0.3] - 2026-01-14

### Fixed
- **Permission Modes** - Removed deprecated 'plan' and 'delegate' permission modes to align with Claude CLI changes
- **acceptEdits Flag** - Fixed to use `--permission-mode acceptEdits` instead of deprecated `--allowedTools` approach

### Added
- **Remote Branch Hint** - Session form now shows a hint about remote branch sourcing for better clarity

## [1.0.2] - 2026-01-12

### Added

- **Explicit Delegation Signals** - MCP workflow system now clearly indicates when the orchestrator should spawn a sub-agent to handle a step, preventing accidental work execution by the main agent

### Changed

- **Simplified Agent Configuration** - Removed `tools` and `cannot` fields from workflow system as they didn't actually restrict agent behavior
- **Improved Orchestrator Instructions** - Enhanced workflow instructions to better clarify agent roles, sub-agent spawning, and workflow advance behavior

## [1.0.1] - 2026-01-12

### Fixed
- Fixed issue in lanes' create lanes MCP endpoint which errored when claude tried to use a custom workflow for a lane


## [1.0.0] - 2026-01-11

Lanes 1.0 transforms the extension from a worktree manager into a full agentic orchestration platform.

### Added

- **MCP-based Agentic Workflow System** - Structured workflows via Model Context Protocol that guide Claude through planning → implementing → testing → reviewing phases
- **Custom Workflow Templates** - Create YAML workflow templates in `.lanes/workflows/` with agents, loops, and steps
- **Workflow Template Dropdown** - Session creation form now shows available workflows with refresh button
- **MCP Session Creation** - `session_create` endpoint allows programmatic session creation via MCP
- **Workflow Progress Display** - Session tree view shows current workflow step/task as child items
- **CodeAgent Abstraction** - Modular `CodeAgent` class for future AI agent extensibility (preparing for multi-agent support)
- **Built-in Workflow Templates** - Feature, bugfix, refactor, and default workflow templates in `workflows/` included as references
- **Ralph Loop Step Type** - Iterative refinement loops for workflows that repeat until completion criteria are met
- **Repair Broken Worktrees Command** - `Lanes: Repair Broken Worktrees` command to manually fix broken worktrees after container rebuilds
- **DevContainer Support** - Added devcontainer configuration with SSH agent forwarding for seamless Git authentication
- **GitHub Actions CI** - Automated PR checks workflow for continuous integration
- **Open VSX Registry Publishing** - Extension now published to Open VSX in addition to VS Code Marketplace
- **Comprehensive Documentation** - New `docs/docs.html` with full user documentation, workflow guides, and API reference
- **Source Branch Fetching** - Automatically fetch source branch before creating a session
- **Automatic Workflow Reminders** - Claude receives automatic reminders to call `workflow_advance` after each step

### Changed

- Built-in workflows are now template-only (not selectable in dropdown, copy to customize)
- Workflow and task info moved to child item in session tree view
- **Lanes folder moved from `.claude/lanes/` to `.lanes/`** - Custom workflows and pending sessions now stored in `.lanes/` at repository root
- Add comment button moved to left side of diff view for better ergonomics
- Agents and loops are now optional in workflow templates

### Removed

- Removed `features.json` integration from extension (deprecated in favor of workflow system)

### Migration

If you have existing custom workflows or data in `.claude/lanes/`, move them to the new location:
```bash
mv .claude/lanes .lanes
```

### Fixed

- Workflow path resolution for custom workflows
- Hidden built-in workflows from sidebar tree view
- Added explicit step boundaries to prevent skipping workflow steps
- Workflow dropdown now populates correctly after webview recreation
- Git integration tests now CI-friendly with proper configuration
- Use workspace `.claude` directory for pending sessions

## [0.10.4] - 2026-01-04

### Changed

- Updated Website link to point to 'lanes.pro'.

## [0.10.3] - 2026-01-04

### Changed

- Renamed extension to 'Claude Lanes', Kept the Lanes display name as you can't rename extensions in VS Code.

## [0.10.2] - 2026-01-04

### Changed

- Renamed extension to 'Lanes'

## [0.10.1] - 2026-01-04

### Changed

- New logo design with default, dark, and mono variants
- Sidebar icon now uses `currentColor` for proper theme adaptation
- Streamlined README for GitHub (moved detailed docs to separate files)
- Separate README for VS Code Marketplace (user-focused)
- Release script now swaps READMEs during packaging

### Added

- Light/dark mode toggle on website (lanes.pro)
- Claude Harness documentation moved to `docs/CLAUDE-HARNESS.md`
- Platform support section (macOS/Linux supported, Windows not yet)
- Dev Containers documentation in marketplace README

### Fixed

- Release script now publishes pre-built VSIX instead of rebuilding (ensures correct README)

### Removed

- Old icon files replaced with new logo variants

## [0.10.0] - 2026-01-04

### Added

- Previous Sessions view in sidebar - shows inactive sessions with saved prompts for easy restart
- Prompts now stored in VS Code global storage by default - keeps repository clean
- Claude Code settings (`--settings` flag) stored in extension storage for persistence across containers

### Documentation

- Added devcontainer storage persistence guide for Docker/container users

## [0.9.0] - 2026-01-03

### Added

- Source branch selector in session creation form - create sessions from any branch, not just HEAD
- Permission mode selector in session creation form - choose between default, plan, autoAcceptEdits, bypassPermissions, and more
- Base branch selector in Git Changes webview - compare against any branch, not just the configured default
- Untracked files now included in Git Changes diff view
- Broken worktree detection and automatic repair after container rebuilds
- Session form data retained when creation fails - no need to re-enter details

### Fixed

- Fixed broken `command` string in session form webview that prevented session creation

## [0.8.0] - 2026-01-01

### Added

- Global storage option for session tracking files - keeps `.claude-status` and `.claude-session` files outside worktrees
- Configurable worktrees folder location (`lanes.worktreesFolder`)
- Configurable prompts folder location (`lanes.promptsFolder`)
- Local settings file (`settings.local.json`) for hooks configuration with migration prompt from legacy format
- Session name sanitization for valid git branch names

### Changed

- Reorganized extension settings into logical sections (Session Management, File Locations, Git Integration, Integrations)
- Split test suite into 6 focused test files for better maintainability
- Improved Project Manager integration with file-based approach and proper path resolution

### Fixed

- Migration dialog no longer blocks new session creation
- Project Manager integration disabled in remote development contexts (Remote-SSH, Codespaces)

## [0.7.0] - 2025-12-31

### Added

- Project Manager integration - sessions automatically added/removed from VS Code Project Manager extension
- Worktree-aware session discovery - correctly detects sessions when working from a worktree
- "Open in New Window" command for sessions in the sidebar

### Changed

- Add `.worktrees` directory to `.gitignore`

## [0.6.0] - 2025-12-29

### Added

- Git Changes viewer for sessions - view diff against base branch directly from sidebar
- Code review comments feature in Git Changes viewer with clipboard export
- Configurable base branch setting (`lanes.baseBranch`) for Git diff comparison
- Option to include uncommitted changes in Git diff view

### Fixed

- Use addEventListener for CSP-compliant collapse functionality in webviews
- Reduce line padding in Git diff view for better readability

### Changed

- Exclude `.worktrees` directory from vsix package (reduces package size significantly)

## [0.5.1] - 2025-12-27

### Changed

- Use VS Code Git extension for git executable path with fallback to PATH
- Replace shell-based git commands with spawn-based execution for better security

### Added

- Git service module (`gitService.ts`) for centralized git operations
- Type definitions for VS Code Git Extension API

## [0.5.0] - 2025-12-27

### Changed

- Convert synchronous file operations to async for better performance
- Use atomic writes to prevent race conditions in settings file
- Convert recursive session creation to iterative approach
- Improve error handling with proper type safety

### Added

- `deactivate()` export for extension cleanup
- Proper `Disposable` implementation for `ClaudeSessionProvider`
- `jq` dependency documentation in README
- 26 new edge case tests for improved reliability:
  - Long session names (filesystem limits)
  - Session name validation edge cases
  - Session ID edge cases (injection prevention)
  - Claude status edge cases
  - Features.json edge cases
  - Path configuration edge cases
  - Concurrent operations

## [0.4.1] - 2025-12-23

### Changed

- Use `--prompt-file` flag instead of `-p` for passing prompts to Claude CLI

## [0.4.0] - 2025-12-23

### Fixed

- Store prompts in files to prevent terminal buffer overflow with large prompts

### Changed

- Ignore `.lanes` directory in git

## [0.3.4] - 2025-12-23

### Added

- Persist new session form data when switching tabs or collapsing view
- Handle existing branches when creating sessions (prompts to use existing or create new)

## [0.3.3] - 2025-12-22

### Added

- Custom extension icon for marketplace and extension views
- Custom sidebar icon (circuit tree design) that adapts to VS Code themes

## [0.3.1] - 2025-12-21

### Fixed

- Remove redundant activation events
- Add icons to tree views

## [0.3.0] - 2025-12-21

### Added

- Configurable paths for `.claude-session` and `.claude-status` files
- Configurable paths for `features.json` and `tests.json` files
- Claude Harness section in README documentation

## [0.2.1] - 2025-12-21

### Changed

- Updated README with current features and screenshot

## [0.2.0] - 2025-12-21

### Added

- Form-based session creation UI with webview panel
- Session resume functionality with `--resume` flag support
- Acceptance criteria field in session creation form

### Fixed

- Pass prompt directly to Claude CLI with `-p` flag
- Read session ID from stdin JSON instead of environment variable

## [0.1.0] - 2025-12-21

### Added

- Initial release
- Create isolated Claude Code sessions via Git worktrees
- Sidebar view for session management
- Dedicated terminal per session
- Session status indicators (waiting/working/error)
- Auto-configured hooks for status updates
- Keyboard shortcut for quick session creation (`Cmd+Shift+C` / `Ctrl+Shift+C`)
- Session persistence across VS Code restarts
- One-click session cleanup (removes worktree, keeps branch)
