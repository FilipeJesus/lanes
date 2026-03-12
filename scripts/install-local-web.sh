#!/bin/bash
set -e

# Lanes Web UI Local Install Script
# Usage: ./scripts/install-local-web.sh
#
# Installs web-ui dependencies, builds the web UI to out/web-ui/,
# and bundles the CLI + daemon so 'lanes web' can serve it.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📦 Installing web-ui dependencies..."
cd "$PROJECT_ROOT/web-ui"
npm install

echo "🔨 Building web UI..."
npm run build

echo "🔨 Building CLI + daemon..."
cd "$PROJECT_ROOT"
npm run compile

echo "🔗 Installing CLI globally via npm link..."
npm link

echo ""
echo "✅ Web UI installed!"
echo "   Start the daemon from a project: lanes daemon start"
echo "   Then launch the web UI:          lanes web"
echo "   Open http://127.0.0.1:3847 in your browser."
