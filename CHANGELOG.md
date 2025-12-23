# Changelog

All notable changes to the Claude Lanes extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
