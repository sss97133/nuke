#!/bin/bash

# Check Vercel CLI setup and GitHub integration status

echo "🔍 Checking Vercel Setup"
echo "========================"
echo ""

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Install with: npm install -g vercel"
    exit 1
fi

echo "✅ Vercel CLI installed"
echo ""

# Check authentication
echo "🔐 Checking authentication..."
if vercel whoami &> /dev/null; then
    USER=$(vercel whoami 2>&1)
    echo "✅ Logged in as: $USER"
else
    echo "❌ Not authenticated. Run: vercel login"
    exit 1
fi

echo ""

# Check if project is linked
echo "🔗 Checking project link..."
if [ -f "nuke_frontend/.vercel/project.json" ]; then
    echo "✅ Project is linked"
    echo ""
    echo "Project info:"
    cat nuke_frontend/.vercel/project.json | python3 -m json.tool 2>/dev/null || cat nuke_frontend/.vercel/project.json
else
    echo "⚠️  Project not linked"
    echo ""
    echo "To link:"
    echo "  cd nuke_frontend"
    echo "  vercel link"
fi

echo ""

# Check GitHub integration
echo "📦 Checking GitHub integration..."
echo ""
echo "To check GitHub integration status:"
echo "  1. Go to: https://vercel.com/dashboard"
echo "  2. Select your project"
echo "  3. Go to Settings → Git"
echo "  4. Verify GitHub repo is connected"
echo ""

# List projects
echo "📋 Your Vercel projects:"
vercel project ls 2>&1 | head -20 || echo "  (Run 'vercel project ls' manually)"

echo ""
echo "✅ Setup check complete!"
echo ""
echo "Next steps:"
echo "  - If GitHub not connected: Connect in Vercel Dashboard"
echo "  - If connected: Push to main branch to trigger auto-deploy"

