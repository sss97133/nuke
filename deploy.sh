#!/bin/bash

# 🚀 Nuke Platform Quick Deploy Script
# Usage: ./deploy.sh [message]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Nuke Platform Deployment Pipeline${NC}"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d "nuke_frontend" ]; then
    echo -e "${RED}❌ Error: Run this script from the nuke root directory${NC}"
    exit 1
fi

# Get commit message
COMMIT_MSG=${1:-"feat: deploy updates"}

echo -e "${YELLOW}📋 Pre-deployment checks...${NC}"

# 1. Check if there are changes to commit
if git diff --quiet && git diff --cached --quiet; then
    echo -e "${YELLOW}⚠️  No changes to deploy${NC}"
    exit 0
fi

# 2. Test build locally
echo -e "${YELLOW}🔨 Testing build locally...${NC}"
cd nuke_frontend
npm run build
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed! Fix errors before deploying${NC}"
    exit 1
fi
cd ..

echo -e "${GREEN}✅ Build successful${NC}"

# 3. Commit and push
echo -e "${YELLOW}📝 Committing changes...${NC}"
git add .
git commit -m "$COMMIT_MSG"

echo -e "${YELLOW}🚀 Pushing to GitHub...${NC}"
git push origin main

echo -e "${GREEN}✅ Deployment initiated!${NC}"
echo ""
echo -e "${BLUE}📊 Monitor deployment:${NC}"
echo "   https://vercel.com/nzero/nuke_frontend/deployments"
echo ""
echo -e "${BLUE}🌐 Production URL:${NC}"
echo "   https://nukefrontend.vercel.app"
echo ""
echo -e "${BLUE}🔍 Check logs:${NC}"
echo "   vercel logs https://nukefrontend.vercel.app"
echo ""
echo -e "${GREEN}🎉 Deployment pipeline complete!${NC}"
