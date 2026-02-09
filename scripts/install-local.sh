#!/bin/bash
set -e

# Lanes Local Install Script
# Usage: ./scripts/install-local.sh

echo "🔨 Building extension..."
npm run compile

echo "📦 Packaging extension..."
npx vsce package

# Get the version from package.json to find the correct .vsix file
VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="lanes-${VERSION}.vsix"

echo "🔧 Installing extension locally..."
code --install-extension "$VSIX_FILE"

echo ""
echo "✅ Extension installed locally!"
echo "   Reload VS Code to use the updated version (Cmd+Shift+P → 'Developer: Reload Window')"
