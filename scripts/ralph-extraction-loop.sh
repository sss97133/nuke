#!/bin/bash
#
# RALPH WIGGUM - EXTRACTION FACTORY LOOP
#
# RLM (Recursive Loop Model) for autonomous extraction:
# 1. External state in files (not memory)
# 2. ONE step per loop iteration
# 3. Shell wrapper calls Claude repeatedly
# 4. Circuit breakers for errors/completion
# 5. Rate limiting to preserve quota
#
# Usage:
#   ./scripts/ralph-extraction-loop.sh                    # Run extraction loop
#   ./scripts/ralph-extraction-loop.sh --hours 4          # Run for 4 hours
#   ./scripts/ralph-extraction-loop.sh --status           # Check status
#   ./scripts/ralph-extraction-loop.sh --investigate      # Run failure analysis
#

set -euo pipefail

# Configuration
RALPH_DIR="/Users/skylar/nuke/.ralph"
PROMPT_FILE="$RALPH_DIR/EXTRACTION_FACTORY_PROMPT.md"
PLAN_FILE="$RALPH_DIR/extraction_plan.md"
PROGRESS_FILE="$RALPH_DIR/extraction_progress.md"
ACTIVITY_LOG="$RALPH_DIR/extraction_activity.md"
METRICS_FILE="$RALPH_DIR/extraction_metrics.json"

MAX_ITERATIONS=${MAX_ITERATIONS:-200}
SLEEP_BETWEEN=${SLEEP_BETWEEN:-30}  # seconds between loops
MAX_CONSECUTIVE_ERRORS=5
MAX_CONSECUTIVE_BLOCKS=3
RATE_LIMIT_DELAY=60  # Extra delay after errors

cd /Users/skylar/nuke

# Counters
LOOP_COUNT=0
ERROR_COUNT=0
BLOCK_COUNT=0
SUCCESS_COUNT=0

log() {
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $*" | tee -a "$ACTIVITY_LOG"
}

save_metrics() {
  local pending=$(dotenvx run -- bash -c 'curl -sS -I "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id&status=eq.pending" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r\n "' 2>/dev/null || echo "0")
  local total=$(dotenvx run -- bash -c 'curl -sS -I "$VITE_SUPABASE_URL/rest/v1/vehicles?select=id" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact" -H "Range: 0-0" 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r\n "' 2>/dev/null || echo "0")

  echo "{
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"loop\": $LOOP_COUNT,
    \"total_vehicles\": ${total:-0},
    \"pending_vehicles\": ${pending:-0},
    \"success_count\": $SUCCESS_COUNT,
    \"error_count\": $ERROR_COUNT
  }" > "$METRICS_FILE"
}

show_status() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════╗"
  echo "║  RALPH EXTRACTION FACTORY STATUS                           ║"
  echo "╚════════════════════════════════════════════════════════════╝"
  echo ""

  if [[ -f "$METRICS_FILE" ]]; then
    cat "$METRICS_FILE" | jq -r '
      "Last Loop: \(.loop)",
      "Timestamp: \(.timestamp)",
      "Total Vehicles: \(.total_vehicles)",
      "Pending: \(.pending_vehicles)",
      "Success/Error: \(.success_count)/\(.error_count)"
    '
  fi

  echo ""
  echo "Plan file: $PLAN_FILE"
  echo "Progress: $PROGRESS_FILE"

  echo ""
  echo "Uncompleted tasks:"
  grep "^\- \[ \]" "$PLAN_FILE" 2>/dev/null | head -10 || echo "  None found"

  echo ""
}

run_investigation() {
  log "═══════════════════════════════════════════════════════════"
  log "FAILURE INVESTIGATION MODE"
  log "═══════════════════════════════════════════════════════════"

  local prompt="You are Ralph Wiggum in INVESTIGATION mode.

Read these files:
- .ralph/EXTRACTION_FACTORY_PROMPT.md (your mission)
- .ralph/extraction_plan.md (current tasks)
- .ralph/extraction_progress.md (history)
- .ralph/extraction_activity.md (recent logs)

TASK: Investigate recent failures or quality issues.

1. Look for error patterns in the activity log
2. Identify the root cause (site changed? selector wrong? rate limited?)
3. Propose a fix
4. Update the plan with investigation findings
5. Write analysis to progress.md

Output your RALPH_STATUS block when done."

  claude --print "$prompt" 2>&1 | tee -a "$ACTIVITY_LOG"
}

run_loop_iteration() {
  local iteration=$1

  log ""
  log "═══════════════════════════════════════════════════════════"
  log "LOOP $iteration - $(date)"
  log "═══════════════════════════════════════════════════════════"

  local prompt="You are Ralph Wiggum. Loop iteration $iteration.

Read these files for context:
- .ralph/EXTRACTION_FACTORY_PROMPT.md (your mission and methodology)
- .ralph/extraction_plan.md (current tasks - find first unchecked [ ])
- .ralph/extraction_progress.md (what's been done)

DO ONE TASK from extraction_plan.md:
1. Find the first unchecked [ ] task
2. Execute ONLY that task
3. Write results to extraction_progress.md
4. Mark the task [x] in extraction_plan.md (or add notes if blocked)
5. Output your RALPH_STATUS block and exit

REMEMBER:
- ONE step per loop
- Validate data after extraction (query DB)
- If something fails, investigate don't give up
- BaT is gold standard for quality
- Images are required for completeness"

  # Run Claude and capture output
  local output
  output=$(claude --print "$prompt" 2>&1) || true
  echo "$output" >> "$ACTIVITY_LOG"

  # Parse exit status from output
  if echo "$output" | grep -q "EXIT.*done\|mission_complete"; then
    log ">>> MISSION COMPLETE"
    return 2  # Signal completion
  elif echo "$output" | grep -q "EXIT.*blocked"; then
    log ">>> BLOCKED - will investigate"
    BLOCK_COUNT=$((BLOCK_COUNT + 1))
    return 1
  elif echo "$output" | grep -q "EXIT.*step_complete\|TASK_COMPLETED"; then
    log ">>> Step complete"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    BLOCK_COUNT=0
    ERROR_COUNT=0
    return 0
  elif echo "$output" | grep -q "EXIT.*investigating"; then
    log ">>> Investigating issue"
    return 0
  else
    log ">>> Unknown exit status"
    ERROR_COUNT=$((ERROR_COUNT + 1))
    return 1
  fi
}

run_main_loop() {
  log "════════════════════════════════════════════════════════════"
  log "RALPH EXTRACTION FACTORY STARTING"
  log "════════════════════════════════════════════════════════════"
  log "Max iterations: $MAX_ITERATIONS"
  log "Sleep between: ${SLEEP_BETWEEN}s"
  log "Prompt: $PROMPT_FILE"
  log "Plan: $PLAN_FILE"
  log "════════════════════════════════════════════════════════════"

  while [[ $LOOP_COUNT -lt $MAX_ITERATIONS ]]; do
    LOOP_COUNT=$((LOOP_COUNT + 1))

    # Run iteration
    local status=0
    run_loop_iteration "$LOOP_COUNT" || status=$?

    # Save metrics periodically
    if [[ $((LOOP_COUNT % 5)) -eq 0 ]]; then
      save_metrics
    fi

    # Check circuit breakers
    if [[ $status -eq 2 ]]; then
      log ">>> Mission complete! Stopping loop."
      break
    fi

    if [[ $ERROR_COUNT -ge $MAX_CONSECUTIVE_ERRORS ]]; then
      log ">>> Too many errors ($ERROR_COUNT). Running investigation..."
      run_investigation
      ERROR_COUNT=0
      sleep $RATE_LIMIT_DELAY
    fi

    if [[ $BLOCK_COUNT -ge $MAX_CONSECUTIVE_BLOCKS ]]; then
      log ">>> Too many blocks ($BLOCK_COUNT). Running investigation..."
      run_investigation
      BLOCK_COUNT=0
      sleep $RATE_LIMIT_DELAY
    fi

    # Rate limiting
    log ">>> Sleeping ${SLEEP_BETWEEN}s..."
    sleep $SLEEP_BETWEEN
  done

  # Final metrics
  save_metrics

  log ""
  log "════════════════════════════════════════════════════════════"
  log "RALPH EXTRACTION FACTORY COMPLETE"
  log "════════════════════════════════════════════════════════════"
  log "Total loops: $LOOP_COUNT"
  log "Successes: $SUCCESS_COUNT"
  log "Check progress: $PROGRESS_FILE"
  log "════════════════════════════════════════════════════════════"
}

# CLI
case "${1:-}" in
  --status)
    show_status
    ;;
  --investigate)
    run_investigation
    ;;
  --hours)
    hours=${2:-4}
    MAX_ITERATIONS=$((hours * 12))  # ~5 min per iteration
    run_main_loop
    ;;
  --help)
    echo "Ralph Extraction Factory Loop"
    echo ""
    echo "Usage:"
    echo "  $0                    Run extraction loop"
    echo "  $0 --hours N          Run for N hours"
    echo "  $0 --status           Check current status"
    echo "  $0 --investigate      Run failure analysis"
    echo ""
    ;;
  *)
    run_main_loop
    ;;
esac
