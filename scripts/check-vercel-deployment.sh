#!/bin/bash

# Check Vercel deployment status

echo "🔍 Checking Vercel Deployment Status"
echo "===================================="
echo ""

cd "$(git rev-parse --show-toplevel)/nuke_frontend" 2>/dev/null || cd "$(git rev-parse --show-toplevel)"

# Check if Vercel CLI is available
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found"
    echo "   Install: npm install -g vercel"
    exit 1
fi

echo "✅ Vercel CLI installed"
echo ""

# Check authentication
if ! vercel whoami &> /dev/null; then
    echo "⚠️  Not authenticated with Vercel"
    echo "   Run: vercel login"
    echo ""
    echo "📊 Check deployments manually:"
    echo "   https://vercel.com/dashboard"
    exit 0
fi

USER=$(vercel whoami 2>&1)
echo "✅ Authenticated as: $USER"
echo ""

# Check if project is linked
if [ -f "nuke_frontend/.vercel/project.json" ]; then
    echo "✅ Project is linked"
    PROJECT_NAME=$(cat nuke_frontend/.vercel/project.json | grep -o '"name":"[^"]*' | cut -d'"' -f4)
    echo "   Project: $PROJECT_NAME"
    echo ""
elif [ -f ".vercel/project.json" ]; then
    echo "✅ Project is linked"
    PROJECT_NAME=$(cat .vercel/project.json | grep -o '"name":"[^"]*' | cut -d'"' -f4)
    echo "   Project: $PROJECT_NAME"
    echo ""
else
    echo "⚠️  Project not linked locally"
    echo "   Run: cd nuke_frontend && vercel link"
    echo ""
fi

# List recent deployments
echo "📋 Recent Deployments:"
echo ""

if [ -f "nuke_frontend/.vercel/project.json" ]; then
    cd nuke_frontend
    vercel ls --limit 5 2>&1 | head -20
elif [ -f ".vercel/project.json" ]; then
    vercel ls --limit 5 2>&1 | head -20
else
    echo "   (Project not linked - cannot list deployments)"
    echo ""
    echo "📊 Check deployments manually:"
    echo "   https://vercel.com/dashboard"
fi

echo ""
echo "🌐 Vercel Dashboard:"
echo "   https://vercel.com/dashboard"
echo ""
echo "📝 To check specific deployment:"
echo "   cd nuke_frontend && vercel inspect [deployment-url]"
echo ""

