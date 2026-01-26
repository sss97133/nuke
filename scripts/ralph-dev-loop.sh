#!/bin/bash
#
# RALPH DEV LOOP - Extended autonomous development session
#
# Runs ralph with expanded tool permissions for:
# - Infrastructure hardening
# - UI consistency fixes
# - Data integrity checks
# - Button/flow audits
# - Type safety
#
# Usage:
#   ./scripts/ralph-dev-loop.sh              # Run with defaults
#   ./scripts/ralph-dev-loop.sh --hours 6    # Run for ~6 hours
#   ./scripts/ralph-dev-loop.sh --dry-run    # Show config without running
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RALPH_DIR="$PROJECT_DIR/.ralph"

# Defaults
MAX_HOURS=${MAX_HOURS:-6}
DRY_RUN=false

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --hours)
      MAX_HOURS="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown arg: $1"
      exit 1
      ;;
  esac
done

# Calculate iterations (~5 min per loop = 12 per hour)
MAX_ITERATIONS=$((MAX_HOURS * 12))

echo "=============================================="
echo "RALPH DEV LOOP"
echo "=============================================="
echo "Project: $PROJECT_DIR"
echo "Prompt: $RALPH_DIR/DEV_LOOP_PROMPT.md"
echo "Plan: $RALPH_DIR/dev_fix_plan.md"
echo "Progress: $RALPH_DIR/dev_progress.md"
echo "Max hours: $MAX_HOURS (~$MAX_ITERATIONS iterations)"
echo "=============================================="

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "DRY RUN - would execute:"
  echo "  cd $PROJECT_DIR"
  echo "  CLAUDE_ALLOWED_TOOLS=\"Read,Write,Edit,Glob,Grep,Bash,Task\" \\"
  echo "  PROMPT_FILE=.ralph/DEV_LOOP_PROMPT.md \\"
  echo "  ralph --max-iterations $MAX_ITERATIONS"
  exit 0
fi

# Check prerequisites
if ! command -v ralph &> /dev/null; then
  echo "ERROR: ralph command not found"
  echo "Install from ~/.ralph/ or check PATH"
  exit 1
fi

if ! command -v claude &> /dev/null; then
  echo "ERROR: claude CLI not found"
  exit 1
fi

# Verify files exist
if [[ ! -f "$RALPH_DIR/DEV_LOOP_PROMPT.md" ]]; then
  echo "ERROR: $RALPH_DIR/DEV_LOOP_PROMPT.md not found"
  exit 1
fi

if [[ ! -f "$RALPH_DIR/dev_fix_plan.md" ]]; then
  echo "ERROR: $RALPH_DIR/dev_fix_plan.md not found"
  exit 1
fi

# Create/clear activity log
echo "# Dev Loop Activity - $(date)" > "$RALPH_DIR/dev_activity.md"
echo "" >> "$RALPH_DIR/dev_activity.md"

cd "$PROJECT_DIR"

echo ""
echo "Starting ralph with expanded tools..."
echo "Tools: Read,Write,Edit,Glob,Grep,Bash,Task"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Run ralph with explicit args
# Note: ralph uses --calls for rate limiting, not max-iterations
# It runs continuously until stopped or circuit breaker trips
ralph \
  --prompt ".ralph/DEV_LOOP_PROMPT.md" \
  --allowed-tools "Read,Write,Edit,Glob,Grep,Bash,Task" \
  --timeout 10 \
  --verbose \
  2>&1 | tee -a "$RALPH_DIR/dev_activity.md"

echo ""
echo "=============================================="
echo "DEV LOOP COMPLETE"
echo "=============================================="
echo "Check progress: $RALPH_DIR/dev_progress.md"
echo "Check activity: $RALPH_DIR/dev_activity.md"
echo "=============================================="
