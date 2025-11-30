#!/bin/bash

# Trigger BAT Scrape via GitHub Actions
# Requires GitHub CLI (gh) to be installed and authenticated

cd "$(dirname "$0")/.."

if ! command -v gh &> /dev/null; then
  echo "❌ GitHub CLI (gh) not installed"
  echo "   Install: brew install gh"
  echo "   Then run: gh auth login"
  exit 1
fi

echo "🚀 Triggering BAT scrape via GitHub Actions..."
echo ""

# Get repo name from git remote
REPO=$(git remote get-url origin 2>/dev/null | sed 's/.*github.com[:/]\([^.]*\).*/\1/' || echo "")

if [ -z "$REPO" ]; then
  echo "❌ Could not determine GitHub repo"
  echo "   Make sure you're in a git repo with a GitHub remote"
  exit 1
fi

echo "📦 Repo: $REPO"
echo ""

# Trigger workflow
gh workflow run "BAT Scrape" --repo "$REPO"

if [ $? -eq 0 ]; then
  echo "✅ Workflow triggered!"
  echo ""
  echo "📊 View progress:"
  echo "   gh run watch --repo $REPO"
  echo ""
  echo "   Or visit: https://github.com/$REPO/actions"
else
  echo "❌ Failed to trigger workflow"
  exit 1
fi

