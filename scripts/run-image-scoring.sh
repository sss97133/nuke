#!/bin/bash
# Continuous image condition scoring runner
# Processes vehicles with images but no condition assessment

set -uo pipefail
cd /Users/skylar/nuke

MAX_ITERATIONS=${1:-200}
BATCH_SIZE=3
SLEEP_BETWEEN=5
LOG_FILE="/Users/skylar/nuke/logs/image-scoring-$(date +%Y%m%d-%H%M%S).log"

mkdir -p /Users/skylar/nuke/logs

# Load env vars directly
eval "$(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' 2>/dev/null)"

if [ -z "${VITE_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "ERROR: Could not load env vars" | tee "$LOG_FILE"
  exit 1
fi

echo "=== Image Scoring Runner ===" | tee "$LOG_FILE"
echo "Max iterations: $MAX_ITERATIONS | Batch: $BATCH_SIZE" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "---" | tee -a "$LOG_FILE"

TOTAL_SCORED=0
TOTAL_ERRORS=0
CONSECUTIVE_ZEROS=0

for (( i=1; i<=MAX_ITERATIONS; i++ )); do
  RESULT=$(curl -s -m 300 -X POST "$VITE_SUPABASE_URL/functions/v1/score-vehicle-condition" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"batch_size\": $BATCH_SIZE}" 2>/dev/null)

  # Parse with python3
  PARSED=$(echo "$RESULT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    n = d.get('vehicles_processed', 0)
    results = d.get('results', [])
    scored = sum(1 for r in results if r.get('overall_score', 0) > 0)
    failed = sum(1 for r in results if r.get('error'))
    avg_score = 0
    scores = [r['overall_score'] for r in results if r.get('overall_score', 0) > 0]
    if scores:
        avg_score = sum(scores) / len(scores)
    comps = sum(r.get('components_written', 0) for r in results)
    dur = sum(r.get('duration_seconds', 0) for r in results)
    msg = d.get('message', '')
    if msg and n == 0:
        print(f'0|0|0|0|0|{msg}')
    else:
        print(f'{scored}|{failed}|{avg_score:.0f}|{comps}|{dur:.0f}|ok')
except Exception as e:
    print(f'ERR|0|0|0|0|{str(e)[:100]}')
" 2>/dev/null)

  IFS='|' read -r SCORED FAILED AVG_SCORE COMPS DURATION MSG <<< "$PARSED"

  if [ "$SCORED" = "ERR" ]; then
    echo "[$i/$MAX_ITERATIONS] ERROR: $MSG" | tee -a "$LOG_FILE"
    CONSECUTIVE_ZEROS=$((CONSECUTIVE_ZEROS + 1))
    if [ $CONSECUTIVE_ZEROS -ge 3 ]; then
      echo "3 consecutive failures. Stopping." | tee -a "$LOG_FILE"
      break
    fi
    sleep 10
    continue
  fi

  if [ "$SCORED" = "0" ] && [ "$FAILED" = "0" ]; then
    CONSECUTIVE_ZEROS=$((CONSECUTIVE_ZEROS + 1))
    echo "[$i/$MAX_ITERATIONS] No vehicles to score ($MSG)" | tee -a "$LOG_FILE"
    if [ $CONSECUTIVE_ZEROS -ge 3 ]; then
      echo "No more vehicles to score. Stopping." | tee -a "$LOG_FILE"
      break
    fi
    sleep 10
    continue
  fi

  CONSECUTIVE_ZEROS=0
  TOTAL_SCORED=$((TOTAL_SCORED + SCORED))
  TOTAL_ERRORS=$((TOTAL_ERRORS + FAILED))

  echo "[$i/$MAX_ITERATIONS] +$SCORED scored ($FAILED err) | Avg: $AVG_SCORE/100 | Components: $COMPS | ${DURATION}s | Total: $TOTAL_SCORED" | tee -a "$LOG_FILE"

  sleep $SLEEP_BETWEEN
done

echo "---" | tee -a "$LOG_FILE"
echo "=== COMPLETE ===" | tee -a "$LOG_FILE"
echo "Total scored: $TOTAL_SCORED | Errors: $TOTAL_ERRORS" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
