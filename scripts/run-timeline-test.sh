#!/bin/bash
# Script to run the Vehicle Timeline tests with proper environment setup

# Set colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Vehicle Timeline Test Runner${NC}"
echo "========================================"

# Check if .env.test exists
if [ ! -f ".env.test" ]; then
  if [ -f ".env" ]; then
    echo -e "${YELLOW}No .env.test file found, copying from .env${NC}"
    cp .env .env.test
  else
    echo -e "${YELLOW}No .env.test or .env file found, creating from template${NC}"
    if [ -f ".env.test.template" ]; then
      cp .env.test.template .env.test
      echo -e "${RED}Please edit .env.test with your Supabase credentials${NC}"
      echo -e "${YELLOW}See TIMELINE_TESTING.md for more information${NC}"
      exit 1
    else
      echo -e "${RED}No template file found. Please create .env.test manually${NC}"
      exit 1
    fi
  fi
fi

# Source the environment variables
echo -e "${YELLOW}Loading environment variables from .env.test${NC}"
export $(grep -v '^#' .env.test | xargs)

# Verify required environment variables
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$VITE_SUPABASE_ANON_KEY" ] || [ -z "$VITE_SUPABASE_SERVICE_KEY" ]; then
  echo -e "${RED}Missing required environment variables${NC}"
  echo "Please ensure VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_SUPABASE_SERVICE_KEY are set in .env.test"
  exit 1
fi

echo -e "${GREEN}Environment variables loaded successfully${NC}"
echo "========================================"

# Run the verification script
echo -e "${YELLOW}Running environment verification${NC}"
node scripts/verify-env.js

# Run the asset fix script
echo -e "${YELLOW}Running production asset fix${NC}"
node scripts/fix-production-assets.js

# Run the actual test
echo -e "${YELLOW}Running vehicle timeline tests${NC}"
node --experimental-json-modules scripts/test-vehicle-timeline.js

# Check if the test was successful
if [ $? -eq 0 ]; then
  echo -e "${GREEN}All tests completed successfully!${NC}"
  echo -e "${YELLOW}You can now proceed with committing your changes and deploying to production.${NC}"
else
  echo -e "${RED}Tests failed. Please check the output above for more information.${NC}"
  exit 1
fi
