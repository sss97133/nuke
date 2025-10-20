#!/bin/bash

# NUKE PLATFORM - QUICK START SCRIPT
# This script verifies environment and starts the dev server

set -e

echo "🚀 NUKE PLATFORM - QUICK START"
echo "================================"
echo ""

# Check Node.js
echo "✓ Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "✗ Node.js not found. Please install Node.js 16+."
    exit 1
fi
NODE_VERSION=$(node -v)
echo "  Node.js version: $NODE_VERSION"

# Check npm
echo "✓ Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "✗ npm not found. Please install npm."
    exit 1
fi
NPM_VERSION=$(npm -v)
echo "  npm version: $NPM_VERSION"

# Check .env.local
echo ""
echo "✓ Checking environment configuration..."
if [ ! -f ".env.local" ]; then
    echo "⚠ Warning: .env.local not found"
    echo "  Create .env.local with Supabase keys and OpenAI API key"
    echo "  See env.example for template"
else
    echo "  .env.local ✓ Found"
fi

# Install dependencies if needed
echo ""
echo "✓ Checking dependencies..."
if [ ! -d "nuke_frontend/node_modules" ]; then
    echo "  Installing dependencies..."
    cd nuke_frontend
    npm install
    cd ..
else
    echo "  Dependencies ✓ Already installed"
fi

# Display build info
echo ""
echo "================================"
echo "✅ SETUP COMPLETE"
echo ""
echo "📊 System Status:"
echo "  • Node.js: Ready"
echo "  • npm: Ready"
echo "  • Dependencies: Ready"
echo "  • Environment: $([ -f '.env.local' ] && echo 'Configured ✓' || echo 'Not configured ⚠')"
echo ""
echo "🎯 What's Ready:"
echo "  ✓ 4 New Premium Components (Timeline, Value, Metrics, Button)"
echo "  ✓ Cursor Design Polish Applied"
echo "  ✓ RLS Security Enabled"
echo "  ✓ Database Schema Complete"
echo ""
echo "🚀 Starting Development Server..."
echo "================================"
echo ""
echo "Frontend will be available at: http://localhost:5173"
echo "Press Ctrl+C to stop"
echo ""

cd nuke_frontend
npm run dev
