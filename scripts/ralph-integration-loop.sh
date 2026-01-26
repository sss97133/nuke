#!/bin/bash
#
# RALPH INTEGRATION LOOP - Frontend page/route integration
#
# Wires up existing components to pages and routes.
# Does NOT modify components - only creates pages and updates routing.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RALPH_DIR="$PROJECT_DIR/.ralph"

MAX_HOURS=${1:-4}
MAX_ITERATIONS=$((MAX_HOURS * 12))

echo "=============================================="
echo "RALPH INTEGRATION LOOP"
echo "=============================================="
echo "Project: $PROJECT_DIR"
echo "Prompt: $RALPH_DIR/FRONTEND_INTEGRATION_PROMPT.md"
echo "Plan: $RALPH_DIR/integration_plan.md"
echo "Progress: $RALPH_DIR/integration_progress.md"
echo "Max hours: $MAX_HOURS (~$MAX_ITERATIONS iterations)"
echo "=============================================="

# Verify files exist
if [[ ! -f "$RALPH_DIR/FRONTEND_INTEGRATION_PROMPT.md" ]]; then
  echo "ERROR: Prompt file not found"
  exit 1
fi

cd "$PROJECT_DIR"

# Create activity log
echo "# Integration Loop Activity - $(date)" > "$RALPH_DIR/integration_activity.md"

echo ""
echo "Starting ralph integration loop..."
echo "Focus: Pages, routes, navigation (NO component changes)"
echo ""
echo "Press Ctrl+C to stop"
echo ""

ralph \
  --prompt ".ralph/FRONTEND_INTEGRATION_PROMPT.md" \
  --allowed-tools "Read,Write,Edit,Glob,Grep,Bash" \
  --timeout 10 \
  --verbose \
  2>&1 | tee -a "$RALPH_DIR/integration_activity.md"

echo ""
echo "=============================================="
echo "INTEGRATION LOOP COMPLETE"
echo "=============================================="
