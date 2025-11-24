#!/bin/bash

# Setup script for Vercel + GitHub integration
# This helps you configure automatic deployments

echo "🚀 Vercel + GitHub Deployment Setup"
echo "===================================="
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "📦 Installing Vercel CLI..."
    npm install -g vercel@latest
fi

echo "✅ Vercel CLI installed"
echo ""

# Check if logged in
echo "🔐 Checking Vercel authentication..."
if vercel whoami &> /dev/null; then
    echo "✅ Already logged in to Vercel"
    USER=$(vercel whoami)
    echo "   Logged in as: $USER"
else
    echo "⚠️  Not logged in. Run: vercel login"
    echo ""
    read -p "Do you want to login now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        vercel login
    fi
fi

echo ""
echo "🔑 Getting Vercel Token..."
echo ""
echo "To set up GitHub Actions, you need a Vercel token:"
echo ""
echo "1. Go to: https://vercel.com/account/tokens"
echo "2. Create a new token"
echo "3. Copy the token"
echo "4. Add it to GitHub Secrets:"
echo "   - Go to: https://github.com/sss97133/nuke/settings/secrets/actions"
echo "   - Click 'New repository secret'"
echo "   - Name: VERCEL_TOKEN"
echo "   - Value: [paste your token]"
echo ""

# Check if project is linked
echo "🔗 Checking Vercel project link..."
if [ -f "nuke_frontend/.vercel/project.json" ]; then
    echo "✅ Project is linked to Vercel"
    cat nuke_frontend/.vercel/project.json
else
    echo "⚠️  Project not linked. Run: cd nuke_frontend && vercel link"
    echo ""
    read -p "Do you want to link now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd nuke_frontend
        vercel link
        cd ..
    fi
fi

echo ""
echo "📋 Next Steps:"
echo "=============="
echo ""
echo "Option 1: Vercel GitHub Integration (Recommended)"
echo "  → Go to: https://vercel.com/dashboard"
echo "  → Add New Project → Select GitHub repo"
echo "  → Vercel will auto-deploy on every push to main"
echo ""
echo "Option 2: GitHub Actions (Already configured)"
echo "  → Add VERCEL_TOKEN to GitHub Secrets"
echo "  → Push to main → Auto-deploys via GitHub Actions"
echo ""
echo "📚 Full documentation: docs/DEPLOYMENT_SETUP.md"
echo ""

