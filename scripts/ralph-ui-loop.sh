#!/bin/bash
#
# RALPH WIGGUM UI FIX LOOP
#
# Runs Claude Code in a loop, each iteration:
# 1. Doing ONE small UI fix
# 2. Deploying to Vercel
# 3. Verifying the deployment
#
# Designed for 5+ hours of autonomous UI work.
#
# Usage: ./scripts/ralph-ui-loop.sh [max_iterations]
#

set -e

MAX_ITERATIONS=${1:-75}
LOOP_COUNT=0
SLEEP_BETWEEN=15  # seconds between loops (longer for deploy verification)

RALPH_DIR="/Users/skylar/nuke/.ralph"
PROMPT_FILE="$RALPH_DIR/UI_PROMPT.md"
PLAN_FILE="$RALPH_DIR/ui_fix_plan.md"
PROGRESS_FILE="$RALPH_DIR/ui_progress.md"
ACTIVITY_FILE="$RALPH_DIR/ui_activity.md"

echo "=============================================="
echo "RALPH WIGGUM UI FIX LOOP"
echo "=============================================="
echo "\"I'm helping... with the UI!\""
echo ""
echo "Max iterations: $MAX_ITERATIONS"
echo "Prompt: $PROMPT_FILE"
echo "Plan: $PLAN_FILE"
echo "Progress: $PROGRESS_FILE"
echo "=============================================="

cd /Users/skylar/nuke

# Ensure activity file exists
touch "$ACTIVITY_FILE"

while [ $LOOP_COUNT -lt $MAX_ITERATIONS ]; do
    LOOP_COUNT=$((LOOP_COUNT + 1))
    echo ""
    echo ">>> UI LOOP $LOOP_COUNT / $MAX_ITERATIONS - $(date)"
    echo ""

    # Build the prompt for this iteration
    ITERATION_PROMPT="You are Ralph Wiggum doing UI fixes. This is loop iteration $LOOP_COUNT.

Read these files for context:
- .ralph/UI_PROMPT.md (your identity, design standards, vehicle state model)
- .ralph/ui_fix_plan.md (current UI tasks)
- .ralph/ui_progress.md (what's been done)

DO ONE TASK from ui_fix_plan.md:
1. Find the first unchecked [ ] task
2. Execute ONLY that task
3. Run 'npm run build' in nuke_frontend to verify no errors
4. If build succeeds, deploy: 'cd nuke_frontend && vercel --prod'
5. Write results to ui_progress.md (include file path, what changed, deploy status)
6. Mark the task [x] in ui_fix_plan.md
7. Output your RALPH_UI_STATUS block and exit

Remember: ONE task per loop. Build. Deploy. Verify. Persist everything to files.

IMPORTANT: Follow the design standards in UI_PROMPT.md for consistent typography and patterns."

    # Run Claude Code with the prompt
    # Using --print to avoid interactive mode
    claude --print "$ITERATION_PROMPT" 2>&1 | tee -a "$ACTIVITY_FILE"

    EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo ">>> Loop $LOOP_COUNT exited with error code $EXIT_CODE"
        echo ">>> Continuing to next iteration..."
    fi

    # Check if mission complete
    if grep -q "EXIT_REASON: mission_complete" "$ACTIVITY_FILE" 2>/dev/null; then
        echo ""
        echo ">>> UI MISSION COMPLETE at loop $LOOP_COUNT"
        break
    fi

    # Check if blocked (too many consecutive blocks = stop)
    RECENT_BLOCKS=$(tail -30 "$ACTIVITY_FILE" 2>/dev/null | grep -c "EXIT_REASON: blocked" || true)
    if [ "$RECENT_BLOCKS" -gt 3 ]; then
        echo ""
        echo ">>> TOO MANY CONSECUTIVE BLOCKS - stopping loop"
        echo ">>> Check ui_progress.md for blocker details"
        break
    fi

    # Check for build failures
    RECENT_BUILD_FAILS=$(tail -30 "$ACTIVITY_FILE" 2>/dev/null | grep -c "npm run build.*failed\|Build failed\|DEPLOYED: no" || true)
    if [ "$RECENT_BUILD_FAILS" -gt 3 ]; then
        echo ""
        echo ">>> TOO MANY BUILD FAILURES - stopping loop"
        echo ">>> Check ui_activity.md for error details"
        break
    fi

    echo ">>> Sleeping $SLEEP_BETWEEN seconds before next loop..."
    sleep $SLEEP_BETWEEN
done

echo ""
echo "=============================================="
echo "RALPH WIGGUM UI LOOP COMPLETE"
echo "=============================================="
echo "Total iterations: $LOOP_COUNT"
echo "Check progress at: $PROGRESS_FILE"
echo "Check activity at: $ACTIVITY_FILE"
echo "=============================================="
