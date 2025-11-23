#!/bin/bash

# QUICK START: Image Analysis System
# This script guides you through the complete setup and launch

set -e

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║              IMAGE ANALYSIS - QUICK START                                  ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ENV_FILE="nuke_frontend/.env.local"

# Step 1: Check OpenAI key
echo -e "${BLUE}Step 1: Checking OpenAI API key...${NC}"
if grep -q "^VITE_OPENAI_API_KEY=sk-" "$ENV_FILE" 2>/dev/null; then
  echo -e "${GREEN}✓${NC} OpenAI key found in .env.local"
else
  echo -e "${YELLOW}⚠${NC}  OpenAI key not found"
  echo ""
  echo "You need to add your OpenAI API key to: $ENV_FILE"
  echo ""
  echo "Add these two lines:"
  echo "  VITE_OPENAI_API_KEY=sk-proj-your-key-here"
  echo "  OPENAI_API_KEY=sk-proj-your-key-here"
  echo ""
  echo "Get your key from: https://platform.openai.com/api-keys"
  echo ""
  read -p "Press Enter when you've added the key, or Ctrl+C to exit..."
fi

# Step 2: Run diagnostic
echo ""
echo -e "${BLUE}Step 2: Running diagnostic test...${NC}"
echo ""
node scripts/image-analysis-diagnostic.js

if [ $? -eq 0 ]; then
  echo ""
  echo -e "${GREEN}✓ Diagnostic passed!${NC}"
else
  echo ""
  echo -e "${YELLOW}⚠  Diagnostic found issues. Please fix them before continuing.${NC}"
  exit 1
fi

# Step 3: Offer to start processing
echo ""
echo -e "${BLUE}Step 3: Ready to start processing!${NC}"
echo ""
echo "This will process all unprocessed images (~2,741 images)"
echo "Expected time: ~90 minutes"
echo "Expected cost: ~\$30 (AWS + OpenAI)"
echo ""
read -p "Start batch processing now? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo -e "${GREEN}Starting batch processor...${NC}"
  echo ""
  echo "TIP: Open another terminal and run:"
  echo "  ${BLUE}node scripts/image-analysis-monitor.js${NC}"
  echo ""
  echo "To see real-time progress!"
  echo ""
  sleep 3
  
  node scripts/batch-process-images.js
else
  echo ""
  echo "To start processing later, run:"
  echo "  ${BLUE}node scripts/batch-process-images.js${NC}"
  echo ""
  echo "To monitor progress:"
  echo "  ${BLUE}node scripts/image-analysis-monitor.js${NC}"
  echo ""
fi

echo ""
echo -e "${GREEN}Done!${NC}"

