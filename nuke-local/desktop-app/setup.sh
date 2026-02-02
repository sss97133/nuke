#!/bin/bash
# Nuke Intake - Setup Script
# Run this to prepare the development environment

set -e

echo "🚀 Setting up Nuke Intake..."

# Check for Rust
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust not found. Install from https://rustup.rs/"
    exit 1
fi
echo "✅ Rust found"

# Check for Node
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Install from https://nodejs.org/"
    exit 1
fi
echo "✅ Node.js found: $(node --version)"

# Check for Ollama
if ! command -v ollama &> /dev/null; then
    echo "⚠️  Ollama not found. Install from https://ollama.ai/download"
    echo "   The app will still build, but won't process documents without it."
else
    echo "✅ Ollama found"

    # Check for vision model
    if ollama list | grep -q "llava"; then
        echo "✅ llava model found"
    else
        echo "📥 Pulling llava model (this may take a few minutes)..."
        ollama pull llava
    fi
fi

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Install Tauri CLI if needed
if ! npm list @tauri-apps/cli &> /dev/null; then
    echo "📦 Installing Tauri CLI..."
    npm install -D @tauri-apps/cli
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start Ollama if not running: ollama serve"
echo "  2. Run development server: npm run tauri:dev"
echo "  3. Build for distribution: npm run tauri:build"
