#!/bin/bash

# Force deployment script - ensures everything is committed and pushed

set -e

echo "🚀 Force Deployment Script"
echo "=========================="
echo ""

cd "$(git rev-parse --show-toplevel)"

# Check git status
echo "📋 Checking git status..."
git status --short

# Add all changes
echo ""
echo "📦 Staging all changes..."
git add -A

# Check if there are changes to commit
if [ -n "$(git status --porcelain)" ]; then
    echo "✅ Changes found, committing..."
    git commit -m "fix: ensure all changes deployed - $(date +%Y-%m-%d)"
else
    echo "ℹ️  No changes to commit"
fi

# Push to main
echo ""
echo "📤 Pushing to main branch..."
git push origin main

echo ""
echo "✅ Push complete!"
echo ""
echo "📊 Next steps:"
echo "   1. Check Vercel dashboard for deployment status"
echo "   2. Wait 2-5 minutes for build to complete"
echo "   3. Verify production site is updated"
echo ""

