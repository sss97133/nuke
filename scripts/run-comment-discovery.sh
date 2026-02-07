#!/bin/bash
# Continuous comment discovery runner
# Processes vehicles with unanalyzed comments in batches of 20

set -uo pipefail
cd /Users/skylar/nuke

MAX_ITERATIONS=${1:-500}
BATCH_SIZE=20
MIN_COMMENTS=10
SLEEP_BETWEEN=3
LOG_FILE="/Users/skylar/nuke/logs/comment-discovery-$(date +%Y%m%d-%H%M%S).log"

mkdir -p /Users/skylar/nuke/logs

# Load env vars directly
eval "$(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' 2>/dev/null)"

if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: Could not load env vars" | tee "$LOG_FILE"
  exit 1
fi

echo "=== Comment Discovery Runner ===" | tee "$LOG_FILE"
echo "Max iterations: $MAX_ITERATIONS | Batch: $BATCH_SIZE | Min comments: $MIN_COMMENTS" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "URL: ${VITE_SUPABASE_URL:0:40}..." | tee -a "$LOG_FILE"
echo "---" | tee -a "$LOG_FILE"

TOTAL_DISCOVERED=0
TOTAL_ERRORS=0
CONSECUTIVE_ZEROS=0

for (( i=1; i<=MAX_ITERATIONS; i++ )); do
  RESULT=$(curl -s -m 90 -X POST "$VITE_SUPABASE_URL/functions/v1/batch-comment-discovery" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": $BATCH_SIZE, \"min_comments\": $MIN_COMMENTS}" 2>/dev/null)

  # Parse with python3
  PARSED=$(echo "$RESULT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f\"{d.get('discovered',0)}|{d.get('errors',0)}|{d.get('remaining','?')}|{d.get('elapsed_ms','?')}\")
except:
    print('ERR|0|?|?')
" 2>/dev/null)

  IFS='|' read -r DISCOVERED ERRORS REMAINING ELAPSED <<< "$PARSED"

  if [ "$DISCOVERED" = "ERR" ]; then
    echo "[$i/$MAX_ITERATIONS] ERROR: Bad response: ${RESULT:0:200}" | tee -a "$LOG_FILE"
    CONSECUTIVE_ZEROS=$((CONSECUTIVE_ZEROS + 1))
    if [ $CONSECUTIVE_ZEROS -ge 3 ]; then
      echo "3 consecutive failures. Stopping." | tee -a "$LOG_FILE"
      break
    fi
    sleep 5
    continue
  fi

  TOTAL_DISCOVERED=$((TOTAL_DISCOVERED + DISCOVERED))
  TOTAL_ERRORS=$((TOTAL_ERRORS + ERRORS))

  echo "[$i/$MAX_ITERATIONS] +$DISCOVERED ($ERRORS err) | Total: $TOTAL_DISCOVERED | Remaining: $REMAINING | ${ELAPSED}ms" | tee -a "$LOG_FILE"

  # Track consecutive zero-discovery batches (including error-only batches)
  if [ "$DISCOVERED" = "0" ]; then
    CONSECUTIVE_ZEROS=$((CONSECUTIVE_ZEROS + 1))
    if [ "$ERRORS" = "0" ] && [ $CONSECUTIVE_ZEROS -ge 5 ]; then
      echo "5 consecutive zero-discovery batches with no errors. Stopping." | tee -a "$LOG_FILE"
      break
    fi
    if [ $CONSECUTIVE_ZEROS -ge 10 ]; then
      echo "10 consecutive zero-discovery batches. Stopping." | tee -a "$LOG_FILE"
      break
    fi
    # Back off on zeros to let DB recover
    sleep 10
  else
    CONSECUTIVE_ZEROS=0
    sleep $SLEEP_BETWEEN
  fi
done

echo "---" | tee -a "$LOG_FILE"
echo "=== COMPLETE ===" | tee -a "$LOG_FILE"
echo "Total discovered: $TOTAL_DISCOVERED | Errors: $TOTAL_ERRORS" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
