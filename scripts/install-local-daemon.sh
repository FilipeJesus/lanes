#!/usr/bin/env bash
set -euo pipefail

# Lanes Daemon Local Install Script
# Usage: ./scripts/install-local-daemon.sh
#
# Builds the daemon bundle and exposes the global `lanes-daemon` binary
# via `npm link` so the daemon can be started outside the repo.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Building daemon bundle..."
cd "$PROJECT_ROOT"
npm run bundle:daemon

echo "Installing global binaries via npm link..."
npm link

if ! command -v lanes-daemon >/dev/null 2>&1; then
  echo "Error: lanes-daemon was not found on PATH after npm link." >&2
  exit 1
fi

echo
echo "Lanes daemon installed locally."
echo "Binary:"
echo "  $(command -v lanes-daemon)"
echo "Start it with:"
echo "  lanes-daemon"
