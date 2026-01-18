#!/bin/bash

# Hook script that automatically registers files created via Write tool
# as artefacts in the current Lanes workflow.

set -euo pipefail

# Read hook input from stdin
INPUT=$(cat)
WORKTREE_PATH="$(echo "$INPUT" | jq -r '.cwd // empty')"

# Only register if we're in a Lanes worktree with an active workflow
if [ -n "$WORKTREE_PATH" ] && [ -f "$WORKTREE_PATH/workflow-state.json" ]; then
  # Check if current step has artefacts enabled
  WORKFLOW_INFO="$WORKTREE_PATH/.workflow-info.json"
  if [ -f "$WORKFLOW_INFO" ]; then
    ARTEFACTS_ENABLED="$(jq -r '.currentStepArtefacts // false' "$WORKFLOW_INFO")"
    if [ "$ARTEFACTS_ENABLED" != "true" ]; then
      exit 0  # Skip registration if artefacts not enabled
    fi
  fi

  # Extract the file path from Write tool output
  FILE_PATH="$(echo "$INPUT" | jq -r '.tool_response.filePath // empty')"

  if [ -n "$FILE_PATH" ] && [ -f "$FILE_PATH" ]; then
    # Add the file to artefacts array if not already present
    STATE_FILE="$WORKTREE_PATH/workflow-state.json"

    tmp=$(mktemp)
    jq --arg path "$FILE_PATH" '
      if .artefacts == null then .artefacts = [] end |
      if .artefacts | index($path) == null then .artefacts += [$path] else . end
    ' "$STATE_FILE" > "$tmp"
    mv "$tmp" "$STATE_FILE"
  fi
fi

exit 0
