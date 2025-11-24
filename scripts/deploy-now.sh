#!/bin/bash

# Emergency deployment script - ensures everything gets deployed

set -e

echo "🚀 EMERGENCY DEPLOYMENT"
echo "======================"
echo ""

cd "$(git rev-parse --show-toplevel)"

# Step 1: Check git status
echo "1️⃣ Checking git status..."
STATUS=$(git status --porcelain)
if [ -n "$STATUS" ]; then
    echo "   ⚠️  Uncommitted changes found:"
    echo "$STATUS" | head -10
    echo ""
    echo "   📦 Staging all changes..."
    git add -A
    
    echo "   💾 Committing..."
    git commit -m "fix: deploy all pending changes - $(date +%Y-%m-%d\ %H:%M:%S)"
    echo "   ✅ Committed"
else
    echo "   ✅ No uncommitted changes"
fi

# Step 2: Check if we're ahead of origin
echo ""
echo "2️⃣ Checking remote status..."
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "")

if [ -z "$REMOTE" ] || [ "$LOCAL" != "$REMOTE" ]; then
    echo "   📤 Pushing to origin/main..."
    git push origin main
    echo "   ✅ Pushed"
else
    echo "   ✅ Already up to date with origin/main"
fi

# Step 3: Verify build
echo ""
echo "3️⃣ Verifying build..."
cd nuke_frontend
if npm run build > /tmp/nuke-build.log 2>&1; then
    echo "   ✅ Build successful"
else
    echo "   ❌ Build failed - check /tmp/nuke-build.log"
    cat /tmp/nuke-build.log | tail -20
    exit 1
fi
cd ..

# Step 4: Summary
echo ""
echo "✅ DEPLOYMENT READY"
echo "==================="
echo ""
echo "📊 Status:"
echo "   - All changes committed: ✅"
echo "   - Pushed to GitHub: ✅"
echo "   - Build successful: ✅"
echo ""
echo "⏳ Next:"
echo "   1. Vercel should auto-deploy in 1-2 minutes"
echo "   2. Check: https://vercel.com/dashboard"
echo "   3. Or force deploy: cd nuke_frontend && vercel --prod --force"
echo ""

