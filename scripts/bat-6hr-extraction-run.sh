#!/bin/bash
# BAT 6-Hour Parallel Extraction Run
# Runs URL discovery + extraction workers continuously for 6 hours
#
# Usage: ./scripts/bat-6hr-extraction-run.sh

set -e
cd /Users/skylar/nuke

# Load env
eval "$(dotenvx run -- printenv | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

SUPABASE_URL="${VITE_SUPABASE_URL}"
AUTH_HEADER="Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"

LOG_FILE="/tmp/bat-extraction-$(date +%Y%m%d-%H%M%S).log"
END_TIME=$(($(date +%s) + 6*60*60))  # 6 hours from now

echo "=== BAT 6-Hour Extraction Run ===" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Will run until: $(date -r $END_TIME)" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

# Stats tracking
TOTAL_DISCOVERED=0
TOTAL_EXTRACTED=0
CYCLES=0

discovery_page=1

while [ $(date +%s) -lt $END_TIME ]; do
  CYCLES=$((CYCLES + 1))
  echo "--- Cycle $CYCLES ($(date +%H:%M:%S)) ---" | tee -a "$LOG_FILE"

  # Run URL discovery (50 pages)
  echo "[Discovery] Starting from page $discovery_page..." | tee -a "$LOG_FILE"
  DISCOVERY_RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/bat-url-discovery" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"action\": \"discover\", \"pages\": 50, \"start_page\": $discovery_page}" 2>/dev/null)

  DISCOVERED=$(echo "$DISCOVERY_RESULT" | jq -r '.urls_queued // 0')
  NEXT_PAGE=$(echo "$DISCOVERY_RESULT" | jq -r '.next_page // 1')
  TOTAL_DISCOVERED=$((TOTAL_DISCOVERED + DISCOVERED))
  discovery_page=$NEXT_PAGE

  echo "[Discovery] Queued $DISCOVERED new URLs (total: $TOTAL_DISCOVERED)" | tee -a "$LOG_FILE"

  # Run 3 extraction workers in parallel
  echo "[Extraction] Running 3 parallel workers..." | tee -a "$LOG_FILE"

  for i in 1 2 3; do
    (
      EXTRACT_RESULT=$(curl -s -X POST "$SUPABASE_URL/functions/v1/bat-queue-worker" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{\"batch_size\": 10}" 2>/dev/null)
      EXTRACTED=$(echo "$EXTRACT_RESULT" | jq -r '.succeeded // 0')
      echo "[Worker $i] Extracted: $EXTRACTED" >> "$LOG_FILE"
    ) &
  done

  # Wait for workers
  wait

  # Get queue status
  QUEUE_STATUS=$(curl -s -X POST "$SUPABASE_URL/functions/v1/bat-url-discovery" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"action\": \"status\"}" 2>/dev/null)

  PENDING=$(echo "$QUEUE_STATUS" | jq -r '.pending_in_queue // 0')
  echo "[Status] Pending in queue: $PENDING" | tee -a "$LOG_FILE"

  # Delay between cycles (30 sec to avoid rate limits)
  echo "[Sleep] 30 seconds before next cycle..." | tee -a "$LOG_FILE"
  sleep 30

  # Every 10 cycles, log a summary
  if [ $((CYCLES % 10)) -eq 0 ]; then
    echo "" | tee -a "$LOG_FILE"
    echo "=== Summary after $CYCLES cycles ===" | tee -a "$LOG_FILE"
    echo "Total discovered: $TOTAL_DISCOVERED" | tee -a "$LOG_FILE"
    echo "Pending in queue: $PENDING" | tee -a "$LOG_FILE"
    echo "Time remaining: $(( (END_TIME - $(date +%s)) / 60 )) minutes" | tee -a "$LOG_FILE"
    echo "" | tee -a "$LOG_FILE"
  fi
done

echo "" | tee -a "$LOG_FILE"
echo "=== Extraction Run Complete ===" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "Total cycles: $CYCLES" | tee -a "$LOG_FILE"
echo "Total discovered: $TOTAL_DISCOVERED" | tee -a "$LOG_FILE"
