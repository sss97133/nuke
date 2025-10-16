#!/bin/bash

# Nuke Simple Deploy Script
# Just run: ./deploy.sh

echo "🚀 Nuke Deployment Script"
echo "========================"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Save any uncommitted changes
echo -e "${YELLOW}📝 Checking for uncommitted changes...${NC}"
if [[ -n $(git status -s) ]]; then
    echo "Found uncommitted changes. Committing them..."
    git add -A
    read -p "Enter commit message (or press Enter for default): " commit_msg
    if [ -z "$commit_msg" ]; then
        commit_msg="chore: deploy to production"
    fi
    git commit -m "$commit_msg"
    echo -e "${GREEN}✅ Changes committed${NC}"
fi

# Step 2: Push to GitHub
echo -e "${YELLOW}📤 Pushing to GitHub...${NC}"
current_branch=$(git branch --show-current)
if git push origin $current_branch; then
    echo -e "${GREEN}✅ Pushed to GitHub${NC}"
else
    echo "⚠️  Push failed, but continuing with deployment..."
fi

# Step 3: Build the app
echo -e "${YELLOW}🔨 Building app...${NC}"
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed! Fix errors and try again."
    exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"

# Step 4: Deploy to Vercel
echo -e "${YELLOW}☁️  Deploying to Vercel...${NC}"
cd dist
vercel --prod --yes > deploy.log 2>&1

# Extract the production URL
PROD_URL=$(grep "Production:" deploy.log | grep -oE "https://[^ ]+")
cd ..

if [ -n "$PROD_URL" ]; then
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo ""
    echo "========================================="
    echo -e "🎉 ${GREEN}Your app is live at:${NC}"
    echo -e "${GREEN}$PROD_URL${NC}"
    echo "========================================="
    echo ""
    echo "📊 View deployment details:"
    echo "   vercel ls"
    echo ""
else
    echo "❌ Deployment failed. Check deploy.log for details."
    cat dist/deploy.log
    exit 1
fi

# Clean up
rm -f dist/deploy.log
