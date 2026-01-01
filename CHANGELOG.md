# Changelog

All notable changes to the Claude Lanes extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
- Configurable base branch setting (`claudeLanes.baseBranch`) for Git diff comparison
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

- Ignore `.claude/lanes` directory in git

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
