#!/bin/bash

# Add Claude API key to .env file
ENV_FILE="../nuke_frontend/.env"

echo ""
echo "🤖 Adding Claude API key to your .env file..."
echo ""

# Check if VITE_NUKE_CLAUDE_API already exists
if grep -q "VITE_NUKE_CLAUDE_API" "$ENV_FILE"; then
    echo "⚠️  VITE_NUKE_CLAUDE_API already exists in .env"
    echo "Please update it with your Claude API key:"
    echo ""
    grep "VITE_NUKE_CLAUDE_API" "$ENV_FILE"
    echo ""
else
    # Add Claude API configuration
    echo "" >> "$ENV_FILE"
    echo "# Claude API Key for Receipt Analysis and Tool Image Search" >> "$ENV_FILE"
    echo "# Get your key from: https://console.anthropic.com/" >> "$ENV_FILE"
    echo "VITE_NUKE_CLAUDE_API=sk-ant-api03-YOUR-CLAUDE-API-KEY-HERE" >> "$ENV_FILE"
    
    echo "✅ Added VITE_NUKE_CLAUDE_API to .env file"
    echo ""
    echo "⚠️  IMPORTANT: You need to replace the placeholder with your actual Claude API key!"
    echo ""
fi

echo "To get your Claude API key:"
echo "1. Go to https://console.anthropic.com/"
echo "2. Sign in or create an account"
echo "3. Navigate to API Keys section"
echo "4. Create a new API key"
echo "5. Copy the key (starts with sk-ant-api03-)"
echo "6. Replace the placeholder in your .env file"
echo ""
echo "Your .env file is at: $ENV_FILE"
