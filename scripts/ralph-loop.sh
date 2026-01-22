#!/bin/bash
#
# RALPH WIGGUM AUTONOMOUS LOOP
#
# Runs Claude Code in a loop, each iteration doing one small task.
# Designed for 5+ hours of autonomous work.
#
# Usage: ./scripts/ralph-loop.sh [max_iterations]
#

set -e

MAX_ITERATIONS=${1:-75}
LOOP_COUNT=0
SLEEP_BETWEEN=10  # seconds between loops

RALPH_DIR="/Users/skylar/nuke/.ralph"
PROMPT_FILE="$RALPH_DIR/PROMPT.md"
PLAN_FILE="$RALPH_DIR/fix_plan.md"
PROGRESS_FILE="$RALPH_DIR/progress.md"

echo "=============================================="
echo "RALPH WIGGUM AUTONOMOUS LOOP"
echo "=============================================="
echo "Max iterations: $MAX_ITERATIONS"
echo "Prompt: $PROMPT_FILE"
echo "Plan: $PLAN_FILE"
echo "Progress: $PROGRESS_FILE"
echo "=============================================="

cd /Users/skylar/nuke

while [ $LOOP_COUNT -lt $MAX_ITERATIONS ]; do
    LOOP_COUNT=$((LOOP_COUNT + 1))
    echo ""
    echo ">>> LOOP $LOOP_COUNT / $MAX_ITERATIONS - $(date)"
    echo ""
    
    # Build the prompt for this iteration
    ITERATION_PROMPT="You are Ralph Wiggum. This is loop iteration $LOOP_COUNT.

Read these files for context:
- .ralph/PROMPT.md (your identity and mission)
- .ralph/fix_plan.md (current tasks)
- .ralph/progress.md (what's been done)

DO ONE TASK from fix_plan.md:
1. Find the first unchecked [ ] task
2. Execute ONLY that task
3. Write results to progress.md
4. Mark the task [x] in fix_plan.md
5. Output your RALPH_STATUS block and exit

Remember: ONE task per loop. Small steps. Persist everything to files."

    # Run Claude Code with the prompt
    # Using --print to avoid interactive mode
    claude --print "$ITERATION_PROMPT" 2>&1 | tee -a "$RALPH_DIR/activity.md"
    
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -ne 0 ]; then
        echo ">>> Loop $LOOP_COUNT exited with error code $EXIT_CODE"
        echo ">>> Continuing to next iteration..."
    fi
    
    # Check if mission complete (look for EXIT_REASON: mission_complete in output)
    if grep -q "EXIT_REASON: mission_complete" "$RALPH_DIR/activity.md" 2>/dev/null; then
        echo ""
        echo ">>> MISSION COMPLETE at loop $LOOP_COUNT"
        break
    fi
    
    # Check if blocked (too many consecutive blocks = stop)
    RECENT_BLOCKS=$(tail -20 "$RALPH_DIR/activity.md" 2>/dev/null | grep -c "EXIT_REASON: blocked" || true)
    if [ "$RECENT_BLOCKS" -gt 3 ]; then
        echo ""
        echo ">>> TOO MANY CONSECUTIVE BLOCKS - stopping loop"
        echo ">>> Check progress.md for blocker details"
        break
    fi
    
    echo ">>> Sleeping $SLEEP_BETWEEN seconds before next loop..."
    sleep $SLEEP_BETWEEN
done

echo ""
echo "=============================================="
echo "RALPH WIGGUM LOOP COMPLETE"
echo "=============================================="
echo "Total iterations: $LOOP_COUNT"
echo "Check progress at: $PROGRESS_FILE"
echo "=============================================="
