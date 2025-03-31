#!/bin/bash
# VehicleTimeline Component Test Runner
# This script implements the "test, fix, test all, commit" workflow
# from our vibe coding best practices.

# Colors for better readability
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}┌─────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│   Nuke Vehicle-Centric Testing Script   │${NC}"
echo -e "${BLUE}└─────────────────────────────────────────┘${NC}"

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

# Check if necessary tools are installed
if ! command_exists npm; then
  echo -e "${RED}Error: npm is not installed. Please install Node.js and npm.${NC}"
  exit 1
fi

# Parse command line arguments
COMPONENT=""
COMMIT_MSG=""
RUN_ALL=false
FIX_MODE=false

while [[ $# -gt 0 ]]; do
  key="$1"
  case $key in
    -c|--component)
      COMPONENT="$2"
      shift
      shift
      ;;
    -m|--message)
      COMMIT_MSG="$2"
      shift
      shift
      ;;
    -a|--all)
      RUN_ALL=true
      shift
      ;;
    -f|--fix)
      FIX_MODE=true
      shift
      ;;
    *)
      echo -e "${RED}Unknown option: $key${NC}"
      echo "Usage: $0 [-c|--component COMPONENT_NAME] [-m|--message COMMIT_MESSAGE] [-a|--all] [-f|--fix]"
      exit 1
      ;;
  esac
done

# Set default component if not specified
if [ -z "$COMPONENT" ] && [ "$RUN_ALL" = false ]; then
  COMPONENT="VehicleTimeline"
  echo -e "${YELLOW}No component specified, defaulting to VehicleTimeline${NC}"
fi

echo -e "${BLUE}Starting test workflow...${NC}"

# Run specific component tests first
if [ "$RUN_ALL" = false ]; then
  echo -e "${BLUE}Running tests for component: ${COMPONENT}${NC}"
  
  if [ "$FIX_MODE" = true ]; then
    echo -e "${YELLOW}Running in FIX mode - tests will run with watch enabled${NC}"
    npm test -- --watch "src/components/${COMPONENT}/__tests__"
  else
    npm test -- "src/components/${COMPONENT}/__tests__"
  fi
  
  TEST_RESULT=$?
  
  if [ $TEST_RESULT -ne 0 ]; then
    echo -e "${RED}❌ Component tests failed.${NC}"
    echo -e "${YELLOW}Fix the tests before proceeding or run with --fix flag.${NC}"
    exit 1
  else
    echo -e "${GREEN}✓ Component tests passed.${NC}"
  fi
fi

# Run all tests to ensure nothing was broken
echo -e "${BLUE}Running all tests to ensure nothing was broken...${NC}"
npm test

ALL_TEST_RESULT=$?

if [ $ALL_TEST_RESULT -ne 0 ]; then
  echo -e "${RED}❌ Full test suite failed.${NC}"
  echo -e "${YELLOW}Something was broken by your changes. Fix before committing.${NC}"
  exit 1
else
  echo -e "${GREEN}✓ All tests passed.${NC}"
fi

# If tests pass and we have a commit message, commit the changes
if [ -n "$COMMIT_MSG" ]; then
  echo -e "${BLUE}Committing changes...${NC}"
  git add .
  git commit -m "$COMMIT_MSG"
  echo -e "${GREEN}✓ Changes committed successfully.${NC}"
  
  # Ask if the user wants to push
  read -p "Do you want to push these changes to the remote repository? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]
  then
    git push
    echo -e "${GREEN}✓ Changes pushed successfully.${NC}"
  fi
else
  echo -e "${YELLOW}No commit message provided. Changes were not committed.${NC}"
  echo -e "${YELLOW}To commit, run again with: -m \"Your commit message\"${NC}"
fi

echo -e "${GREEN}Test workflow completed.${NC}"

# Usage examples
echo -e "${BLUE}┌─────────────────────────────────────────┐${NC}"
echo -e "${BLUE}│               Usage Examples            │${NC}"
echo -e "${BLUE}└─────────────────────────────────────────┘${NC}"
echo -e "${YELLOW}Test a specific component:${NC}"
echo -e "  ./scripts/run-tests.sh -c VehicleTimeline"
echo
echo -e "${YELLOW}Test and fix a component interactively:${NC}"
echo -e "  ./scripts/run-tests.sh -c VehicleTimeline -f"
echo
echo -e "${YELLOW}Run all tests:${NC}"
echo -e "  ./scripts/run-tests.sh -a"
echo
echo -e "${YELLOW}Test, and if successful, commit changes:${NC}"
echo -e "  ./scripts/run-tests.sh -c VehicleTimeline -m \"Add new timeline filtering feature\""
echo
