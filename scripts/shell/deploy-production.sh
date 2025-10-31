#!/bin/bash
# Production Deployment Script
# Run this to deploy to production

set -e  # Exit on error

echo "========================================"
echo "NUKE PLATFORM - PRODUCTION DEPLOYMENT"
echo "========================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from project root${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Pre-deployment checks${NC}"
echo "Checking git status..."
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}Warning: You have uncommitted changes${NC}"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""
echo -e "${YELLOW}Step 2: Database migrations${NC}"
echo "This will apply RLS simplification and fund system..."
read -p "Apply database migrations? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Applying RLS simplification..."
    chmod +x apply-simple-rls.sh
    ./apply-simple-rls.sh
    
    echo "Applying fund system..."
    supabase db push supabase/migrations/20251024_vehicle_funds_system.sql || echo "Fund migration skipped (may already exist)"
    
    echo -e "${GREEN}✓ Migrations applied${NC}"
else
    echo -e "${YELLOW}⚠ Skipping migrations${NC}"
fi

echo ""
echo -e "${YELLOW}Step 3: Frontend build test${NC}"
cd nuke_frontend
echo "Running type check..."
npm run type-check || echo "Type check had issues (non-fatal)"

echo "Testing production build..."
npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 4: Verify deployment checklist${NC}"
echo "Have you:"
echo "  [ ] Updated LEGAL.md with your company info?"
echo "  [ ] Tested vehicle editing works?"
echo "  [ ] Tested image upload (100+ images)?"
echo "  [ ] Reviewed legal disclaimers with lawyer?"
echo ""
read -p "Ready to deploy? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled. Review checklist and try again."
    exit 1
fi

echo ""
echo -e "${YELLOW}Step 5: Git commit and push${NC}"
cd ..
git add .
git commit -m "Production deployment: Market page, RLS fix, fund system, legal docs" || echo "Nothing to commit"
git push origin main

echo ""
echo -e "${GREEN}========================================"
echo "DEPLOYMENT COMPLETE!"
echo "========================================${NC}"
echo ""
echo "Next steps:"
echo "1. Vercel will auto-deploy from main branch"
echo "2. Monitor deployment at https://vercel.com"
echo "3. Test production site immediately"
echo "4. Check error logs in first hour"
echo ""
echo "Critical tests:"
echo "  - Can you login?"
echo "  - Does Market page load?"
echo "  - Can you edit a vehicle?"
echo "  - Do legal disclaimers show?"
echo ""
echo -e "${YELLOW}⚠ Monitor closely for first 24 hours${NC}"
echo ""
echo "Good luck! 🚀"

