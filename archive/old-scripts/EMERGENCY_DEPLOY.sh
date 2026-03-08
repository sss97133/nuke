#!/bin/bash
set -e
cd /Users/skylar/nuke

echo "🚀 EMERGENCY DEPLOYMENT"
echo "======================"

# 1. Add ALL files
echo "1. Adding all files..."
git add -A

# 2. Commit
echo "2. Committing..."
git commit -m "fix: emergency deploy - all changes" || echo "No changes to commit"

# 3. Push
echo "3. Pushing to GitHub..."
git push origin main

# 4. Build test
echo "4. Testing build..."
cd nuke_frontend
npm run build
cd ..

# 5. Deploy
echo "5. Deploying to Vercel..."
cd nuke_frontend
vercel --prod --force --yes

echo ""
echo "✅ DONE"
echo "Check: https://vercel.com/dashboard"

