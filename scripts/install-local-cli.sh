#!/bin/bash
set -e

# Lanes CLI Local Install Script
# Usage: ./scripts/install-local-cli.sh
#
# Builds the CLI bundle and creates a global 'lanes' symlink
# so you can run 'lanes' from any directory.

echo "🔨 Building CLI..."
npm run compile

echo "🔗 Installing globally via npm link..."
npm link

echo ""
echo "✅ CLI installed! You can now run 'lanes' from anywhere."
echo "   Try: lanes --help"
