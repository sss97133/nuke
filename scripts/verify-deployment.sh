#!/bin/bash

# Verify deployment setup and environment variables

echo "🔍 Verifying Deployment Setup"
echo "=============================="
echo ""

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
    echo "❌ Not authenticated with Vercel"
    echo "   Run: vercel login"
    exit 1
fi

echo "✅ Authenticated with Vercel"
echo ""

# Check if project is linked
if [ ! -f "nuke_frontend/.vercel/project.json" ]; then
    echo "⚠️  Project not linked"
    echo "   Run: cd nuke_frontend && vercel link"
    echo ""
else
    echo "✅ Project is linked"
    echo ""
fi

# Check environment variables
echo "📋 Checking Environment Variables..."
echo ""

cd nuke_frontend

# Check for required variables
MISSING_VARS=()

if ! vercel env ls 2>&1 | grep -q "VITE_SUPABASE_URL"; then
    MISSING_VARS+=("VITE_SUPABASE_URL")
fi

if ! vercel env ls 2>&1 | grep -q "VITE_SUPABASE_ANON_KEY"; then
    MISSING_VARS+=("VITE_SUPABASE_ANON_KEY")
fi

if [ ${#MISSING_VARS[@]} -eq 0 ]; then
    echo "✅ Required environment variables are set"
    echo ""
    echo "Current environment variables:"
    vercel env ls 2>&1 | grep -E "(VITE_SUPABASE|Production|Preview)" || echo "  (Run 'vercel env ls' to see all)"
else
    echo "❌ Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "   - $var"
    done
    echo ""
    echo "To add:"
    echo "   vercel env add $var production"
    echo ""
    echo "Or use Vercel Dashboard:"
    echo "   https://vercel.com/dashboard → Your Project → Settings → Environment Variables"
    echo ""
fi

cd ..

# Check local build
echo "🔨 Testing Local Build..."
echo ""

cd nuke_frontend

if [ -f ".env.local" ]; then
    echo "✅ .env.local found"
    npm run build > /tmp/nuke-build.log 2>&1
    
    if [ $? -eq 0 ]; then
        echo "✅ Local build successful"
    else
        echo "❌ Local build failed"
        echo "   Check /tmp/nuke-build.log for details"
        echo "   Common issues:"
        echo "   - Missing environment variables in .env.local"
        echo "   - TypeScript errors"
        echo "   - Missing dependencies"
    fi
else
    echo "⚠️  .env.local not found"
    echo "   Create it with:"
    echo "   echo 'VITE_SUPABASE_URL=your-url' > .env.local"
    echo "   echo 'VITE_SUPABASE_ANON_KEY=your-key' >> .env.local"
fi

cd ..

echo ""
echo "📚 Documentation:"
echo "   - Environment Setup: docs/VERCEL_ENV_SETUP.md"
echo "   - Deployment Guide: docs/DEPLOYMENT_SETUP.md"
echo ""

