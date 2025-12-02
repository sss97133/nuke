#!/bin/bash
set -e

echo "=========================================="
echo "DEPLOYMENT DIAGNOSTIC"
echo "=========================================="
echo ""

cd /Users/skylar/nuke

echo "1. GIT STATUS:"
git status --short
echo ""

echo "2. LATEST COMMIT:"
git log -1 --oneline
echo ""

echo "3. REMOTE STATUS:"
git log origin/main..HEAD --oneline 2>&1 | head -5 || echo "Up to date"
echo ""

echo "4. PUSHING TO GITHUB:"
git push origin main 2>&1
echo ""

echo "5. VERIFYING PUSH:"
git log origin/main -1 --oneline
echo ""

echo "6. BUILD TEST:"
cd nuke_frontend
npm run build 2>&1 | tail -5
echo ""

echo "7. VERCEL DEPLOY:"
vercel --prod --force --yes 2>&1
echo ""

echo "=========================================="
echo "DONE - Check output above for errors"
echo "=========================================="

