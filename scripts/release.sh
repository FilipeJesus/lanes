#!/bin/bash
set -e

# Lanes Release Script
# Usage: ./scripts/release.sh [patch|minor|major]

VERSION_TYPE=${1:-patch}

if [[ ! "$VERSION_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: ./scripts/release.sh [patch|minor|major]"
  echo "  patch - Bug fixes (0.1.0 -> 0.1.1)"
  echo "  minor - New features (0.1.0 -> 0.2.0)"
  echo "  major - Breaking changes (0.1.0 -> 1.0.0)"
  exit 1
fi

echo "🚀 Starting $VERSION_TYPE release..."

# Ensure we're on main branch and up to date
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "⚠️  Warning: You're on branch '$BRANCH', not 'main'"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check for uncommitted changes
if [[ -n $(git status --porcelain) ]]; then
  echo "❌ Error: You have uncommitted changes. Please commit or stash them first."
  exit 1
fi

# Run tests
echo "🧪 Running tests..."
npm test

# Bump version in package.json
echo "📦 Bumping $VERSION_TYPE version..."
NEW_VERSION=$(npm version $VERSION_TYPE --no-git-tag-version)
echo "   New version: $NEW_VERSION"

# Prompt for changelog entry
echo ""
echo "📝 Please update CHANGELOG.md with the new version ($NEW_VERSION)"
echo "   Press Enter when done..."
read -r

# Build and package
echo "🔨 Building extension..."
npm run compile

echo "📦 Packaging extension..."
# Swap README for marketplace (user-focused version)
if [[ -f "README.marketplace.md" ]]; then
  echo "   Swapping README for marketplace version..."
  cp README.md README.github.md
  cp README.marketplace.md README.md
fi

npx vsce package

# Restore original README
if [[ -f "README.github.md" ]]; then
  echo "   Restoring GitHub README..."
  mv README.github.md README.md
fi

# Show what will be published
VSIX_FILE="claude-lanes-${NEW_VERSION#v}.vsix"
echo ""
echo "📋 Package contents:"
unzip -l "$VSIX_FILE" | head -20

# Confirm publish
echo ""
read -p "🚀 Ready to publish $NEW_VERSION to VS Code Marketplace? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Publish cancelled. You can manually publish with: npx vsce publish"
  exit 0
fi

# Publish the pre-built VSIX (don't rebuild, which would use wrong README)
echo "🚀 Publishing to VS Code Marketplace..."
npx vsce publish --packagePath "$VSIX_FILE"

# Publish to Open VSX Registry
echo ""
read -p "🌐 Publish to Open VSX Registry? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  if [[ -z "$OVSX_PAT" ]]; then
    echo "⚠️  Warning: OVSX_PAT environment variable not set"
    echo "   You can set it with: export OVSX_PAT=your-token"
    echo "   Skipping Open VSX publish..."
  else
    echo "🌐 Publishing to Open VSX Registry..."
    if npx ovsx publish "$VSIX_FILE" -p "$OVSX_PAT"; then
      echo "✅ Published to Open VSX Registry"
      echo "   Open VSX: https://open-vsx.org/extension/FilipeMarquesJesus/claude-lanes"
    else
      echo "⚠️  Warning: Open VSX publish failed (VS Code Marketplace publish was successful)"
    fi
  fi
else
  echo "⏭️  Skipping Open VSX publish"
fi

# Commit and tag
echo "📝 Committing version bump..."
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release $NEW_VERSION"
git tag "$NEW_VERSION"

# Push
read -p "📤 Push to remote? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  git push && git push --tags
  echo "✅ Pushed to remote"
fi

echo ""
echo "✅ Release $NEW_VERSION complete!"
echo "   VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=FilipeMarquesJesus.claude-lanes"
echo "   Open VSX Registry: https://open-vsx.org/extension/FilipeMarquesJesus/claude-lanes"
