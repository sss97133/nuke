#!/bin/bash

# IMAGE ANALYSIS SETUP SCRIPT
# Sets up all required API keys and configuration

set -e

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║              IMAGE ANALYSIS SYSTEM SETUP                                   ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Determine .env.local path
ENV_FILE="nuke_frontend/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}⚠${NC}  .env.local not found, creating from template..."
  if [ -f "nuke_frontend/.env.local.template" ]; then
    cp nuke_frontend/.env.local.template "$ENV_FILE"
    echo -e "${GREEN}✓${NC} Created $ENV_FILE"
  elif [ -f "nuke_frontend/.env.example" ]; then
    cp nuke_frontend/.env.example "$ENV_FILE"
    echo -e "${GREEN}✓${NC} Created $ENV_FILE"
  else
    touch "$ENV_FILE"
    echo -e "${GREEN}✓${NC} Created empty $ENV_FILE"
  fi
fi

echo -e "\n${BLUE}Checking current configuration...${NC}\n"

# Check what's already configured
HAS_URL=$(grep -c "^VITE_SUPABASE_URL=" "$ENV_FILE" || echo "0")
HAS_ANON=$(grep -c "^VITE_SUPABASE_ANON_KEY=" "$ENV_FILE" || echo "0")
HAS_SERVICE=$(grep -c "^SUPABASE_SERVICE_ROLE_KEY=" "$ENV_FILE" || echo "0")
HAS_OPENAI=$(grep -c "^VITE_OPENAI_API_KEY=" "$ENV_FILE" || echo "0")

echo "Current status:"
if [ "$HAS_URL" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} Supabase URL configured"
else
  echo -e "  ${RED}✗${NC} Supabase URL missing"
fi

if [ "$HAS_ANON" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} Supabase Anon Key configured"
else
  echo -e "  ${RED}✗${NC} Supabase Anon Key missing"
fi

if [ "$HAS_SERVICE" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} Supabase Service Role Key configured"
else
  echo -e "  ${RED}✗${NC} Supabase Service Role Key missing ${YELLOW}(REQUIRED for scripts)${NC}"
fi

if [ "$HAS_OPENAI" -gt 0 ]; then
  echo -e "  ${GREEN}✓${NC} OpenAI API Key configured"
else
  echo -e "  ${RED}✗${NC} OpenAI API Key missing ${YELLOW}(REQUIRED for image analysis)${NC}"
fi

# Offer to add missing keys
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo ""

if [ "$HAS_SERVICE" -eq 0 ]; then
  echo -e "${YELLOW}Add Supabase Service Role Key${NC}"
  echo "This key is required for batch processing scripts."
  echo "Get it from: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api"
  echo ""
  read -p "Paste your Service Role Key (or press Enter to skip): " SERVICE_KEY
  if [ ! -z "$SERVICE_KEY" ]; then
    echo "" >> "$ENV_FILE"
    echo "# Supabase Service Role Key (for scripts)" >> "$ENV_FILE"
    echo "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_KEY" >> "$ENV_FILE"
    echo -e "${GREEN}✓${NC} Added SUPABASE_SERVICE_ROLE_KEY"
  else
    echo -e "${YELLOW}⚠${NC}  Skipped - you can add it later to $ENV_FILE"
  fi
  echo ""
fi

if [ "$HAS_OPENAI" -eq 0 ]; then
  echo -e "${YELLOW}Add OpenAI API Key${NC}"
  echo "This key is required for AI image analysis."
  echo "Get it from: https://platform.openai.com/api-keys"
  echo ""
  read -p "Paste your OpenAI API Key (or press Enter to skip): " OPENAI_KEY
  if [ ! -z "$OPENAI_KEY" ]; then
    echo "" >> "$ENV_FILE"
    echo "# OpenAI API Key (for image analysis)" >> "$ENV_FILE"
    echo "VITE_OPENAI_API_KEY=$OPENAI_KEY" >> "$ENV_FILE"
    echo "OPENAI_API_KEY=$OPENAI_KEY" >> "$ENV_FILE"
    echo -e "${GREEN}✓${NC} Added OPENAI_API_KEY"
  else
    echo -e "${YELLOW}⚠${NC}  Skipped - you can add it later to $ENV_FILE"
  fi
  echo ""
fi

# Check Edge Function secrets
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "\n${BLUE}Checking Supabase Edge Function secrets...${NC}\n"

echo "The image analysis system also requires these secrets to be set in Supabase:"
echo ""
echo "  1. OPENAI_API_KEY       (for Appraiser Brain + SPID extraction)"
echo "  2. AWS_ACCESS_KEY_ID    (for Rekognition image labeling)"
echo "  3. AWS_SECRET_ACCESS_KEY (for Rekognition)"
echo "  4. SERVICE_ROLE_KEY     (for database access)"
echo ""

# Check if supabase CLI is available
if command -v supabase &> /dev/null; then
  echo -e "${GREEN}✓${NC} Supabase CLI is installed"
  echo ""
  echo "Checking configured secrets..."
  echo ""
  
  # List secrets
  supabase secrets list 2>&1 | grep -E "(OPENAI_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|SERVICE_ROLE_KEY)" || echo "No secrets found"
  
  echo ""
  echo -e "${YELLOW}To set Edge Function secrets, run:${NC}"
  echo "  supabase secrets set OPENAI_API_KEY=sk-proj-your-key"
  echo "  supabase secrets set AWS_ACCESS_KEY_ID=AKIA..."
  echo "  supabase secrets set AWS_SECRET_ACCESS_KEY=..."
  echo ""
else
  echo -e "${YELLOW}⚠${NC}  Supabase CLI not available"
  echo ""
  echo "To check/set Edge Function secrets:"
  echo "  1. Go to: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/functions"
  echo "  2. Add the secrets listed above"
  echo ""
fi

# Summary
echo -e "${BLUE}═══════════════════════════════════════════════════════════════════${NC}"
echo -e "\n${GREEN}Setup Complete!${NC}\n"

echo "Next steps:"
echo ""
echo "1. Verify configuration:"
echo "   ${BLUE}node scripts/image-analysis-diagnostic.js${NC}"
echo ""
echo "2. If all checks pass, start batch processing:"
echo "   ${BLUE}node scripts/batch-process-images.js${NC}"
echo ""
echo "3. Monitor progress in another terminal:"
echo "   ${BLUE}node scripts/image-analysis-monitor.js${NC}"
echo ""
echo "For detailed documentation, see:"
echo "   ${BLUE}docs/IMAGE_ANALYSIS_SYSTEM.md${NC}"
echo ""

