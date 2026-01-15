# Changelog

All notable changes to the Lanes extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
