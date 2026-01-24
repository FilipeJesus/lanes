# Lanes Configuration Simplification - Migration Guide

## What Changed?

The `lanes.claudeSessionPath` and `lanes.claudeStatusPath` configuration settings have been removed. The configuration is now simplified to a single `lanes.useGlobalStorage` toggle.

## New Behavior

### When `lanes.useGlobalStorage` is enabled (default):
Session files are stored in VS Code's global storage. This is the **default and recommended** behavior.

**Storage location:** `globalStorageUri/<repo-identifier>/<session-name>/.claude-status` and `/.claude-session`

### When `lanes.useGlobalStorage` is disabled:
Session files are stored in a fixed location at the repository root:

**Storage location:** `.lanes/session_management/<session-name>/.claude-status` and `/.claude-session`

## Benefits

- **Simpler configuration:** No need to configure individual paths
- **Consistent structure:** All session files in one known location
- **Easier debugging:** Predictable file locations
- **Better organization:** Session files are separated from worktree content

## Migration Steps

If you previously had custom `claudeSessionPath` or `claudeStatusPath` settings:

1. **Open VS Code Settings** (search for "lanes")

2. **Note your current settings** if needed for reference (they will be removed automatically)

3. **Decide which mode to use:**
   - **Global storage (recommended):** Leave `lanes.useGlobalStorage` enabled (default)
   - **Non-global:** Disable `lanes.useGlobalStorage` to use `.lanes/session_management/`

4. **If you need to preserve existing session files:**

   **When switching from custom paths to non-global mode:**

   ```bash
   # For each session, move files to the new location
   mkdir -p .lanes/session_management/<session-name>
   mv <old-custom-path>/.claude-status .lanes/session_management/<session-name>/
   mv <old-custom-path>/.claude-session .lanes/session_management/<session-name>/
   ```

   **Example:** If you had `claudeSessionPath: ".sessions"` and `claudeStatusPath: ".sessions"`:

   ```bash
   # Move session files from .sessions/ to .lanes/session_management/
   for session_dir in .sessions/*; do
     session_name=$(basename "$session_dir")
     mkdir -p ".lanes/session_management/$session_name"
     mv "$session_dir/.claude-status" ".lanes/session_management/$session_name/" 2>/dev/null || true
     mv "$session_dir/.claude-session" ".lanes/session_management/$session_name/" 2>/dev/null || true
   done
   ```

   **When switching to global storage mode:**

   Session files will be automatically created in global storage for new sessions. Existing session files in the old location will remain but won't be used.

## Configuration Reference

### Before (Removed Settings)

```json
{
  "lanes.claudeSessionPath": ".sessions",        // REMOVED
  "lanes.claudeStatusPath": ".sessions",         // REMOVED
  "lanes.useGlobalStorage": true                  // KEPT
}
```

### After (Simplified)

```json
{
  "lanes.useGlobalStorage": true  // true = global storage (default), false = .lanes/session_management/
}
```

## File Structure Comparison

### Before (with custom paths)

```
repo-root/
├── .sessions/                    # User configured path
│   ├── feature-a/
│   │   ├── .claude-status
│   │   └── .claude-session
│   └── feature-b/
│       ├── .claude-status
│       └── .claude-session
└── .worktrees/
    ├── feature-a/
    └── feature-b/
```

### After (non-global mode)

```
repo-root/
├── .lanes/
│   └── session_management/     # Fixed location
│       ├── feature-a/
│       │   ├── .claude-status
│       │   └── .claude-session
│       └── feature-b/
│           ├── .claude-status
│           └── .claude-session
└── .worktrees/
    ├── feature-a/
    └── feature-b/
```

### After (global storage mode - default)

```
# Files are stored in VS Code's global storage (not in repo)
# Location varies by OS:
# - macOS: ~/Library/Application Support/Code/User/globalStorage/filipemarquesjesus.lanes/<repo-id>/<session-name>/
# - Windows: %APPDATA%\Code\User\globalStorage\filipemarquesjesus.lanes\<repo-id>\<session-name>\
# - Linux: ~/.config/Code/User/globalStorage/filipemarquesjesus.lanes/<repo-id>/<session-name>/
```

## Troubleshooting

### Q: I can't find my session files after updating
A: Check which mode you're using:
- **Global storage enabled:** Files are in VS Code's global storage (not in your repo)
- **Global storage disabled:** Files are in `.lanes/session_management/<session-name>/`

### Q: My old session files are still in the custom location
A: The extension now uses the new locations. You can either:
1. Move your old files to the new location (see Migration Steps above)
2. Or let the extension create fresh session files

### Q: Where did the configuration settings go?
A: The `lanes.claudeSessionPath` and `lanes.claudeStatusPath` settings have been removed. Use `lanes.useGlobalStorage` to control where files are stored.

## Support

If you encounter any issues with this change, please:
1. Check the [GitHub Issues](https://github.com/filipemarquesjesus/claude-orchestra/issues)
2. Or create a new issue with details about your configuration
