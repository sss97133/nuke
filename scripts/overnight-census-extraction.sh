#!/bin/bash
# Overnight Census + Extraction Runner
# Runs census every 2 hours, extraction continuously
# Duration: 8 hours

set -e
cd /Users/skylar/nuke
source .env 2>/dev/null || true

DURATION_HOURS=8
LOG_FILE="logs/overnight-$(date +%Y%m%d-%H%M%S).log"
START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION_HOURS * 3600))

mkdir -p logs

echo "=============================================" | tee -a "$LOG_FILE"
echo "OVERNIGHT CENSUS + EXTRACTION RUN" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "Duration: ${DURATION_HOURS} hours" | tee -a "$LOG_FILE"
echo "End time: $(date -r $END_TIME 2>/dev/null || date -d @$END_TIME)" | tee -a "$LOG_FILE"
echo "Log: $LOG_FILE" | tee -a "$LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"

# Function to run census for all sources with strategies
run_census() {
  echo "[$(date +%H:%M:%S)] Running census for all sources..." | tee -a "$LOG_FILE"

  # Use the edge function
  RESULT=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/source-census" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"source": "all"}' 2>&1)

  echo "$RESULT" | jq -r '.census_results | to_entries[] | "\(.key): \(.value.total // "failed")"' 2>/dev/null | tee -a "$LOG_FILE" || echo "Census call failed" | tee -a "$LOG_FILE"
  echo "" | tee -a "$LOG_FILE"
}

# Function to check completeness
check_completeness() {
  echo "[$(date +%H:%M:%S)] Checking source completeness..." | tee -a "$LOG_FILE"

  curl -s "$VITE_SUPABASE_URL/rest/v1/source_completeness?universe_total=not.is.null&select=slug,universe_total,vehicles_observed,completeness_pct,gap" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | \
    jq -r '.[] | "\(.slug): \(.completeness_pct)% complete (\(.vehicles_observed)/\(.universe_total), gap: \(.gap))"' 2>/dev/null | tee -a "$LOG_FILE"

  echo "" | tee -a "$LOG_FILE"
}

# Function to run extraction batch
run_extraction() {
  local source=$1
  local batch_size=${2:-50}

  echo "[$(date +%H:%M:%S)] Running extraction: $source (batch: $batch_size)..." | tee -a "$LOG_FILE"

  # Check for pending items
  PENDING=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&source=eq.$source&select=count" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: count=exact" -I 2>&1 | grep -i content-range | grep -oE '[0-9]+$')

  if [[ -n "$PENDING" && "$PENDING" -gt 0 ]]; then
    echo "  $source: $PENDING pending" | tee -a "$LOG_FILE"
    # Trigger extraction via process-import-queue
    curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/process-import-queue" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"batch_size\": $batch_size, \"source\": \"$source\"}" 2>&1 | \
      jq -r '"  Processed: \(.processed // 0), Success: \(.success // 0), Failed: \(.failed // 0)"' 2>/dev/null | tee -a "$LOG_FILE"
  else
    echo "  $source: no pending items" | tee -a "$LOG_FILE"
  fi
}

# Function to get queue status
queue_status() {
  echo "[$(date +%H:%M:%S)] Queue Status:" | tee -a "$LOG_FILE"

  curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?select=status,count" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Prefer: count=exact" 2>&1 | \
    jq -r 'group_by(.status) | .[] | "\(.[0].status): \(length)"' 2>/dev/null | tee -a "$LOG_FILE"

  echo "" | tee -a "$LOG_FILE"
}

# Main loop
LOOP=0
CENSUS_INTERVAL=7200  # 2 hours in seconds
LAST_CENSUS=0

while [[ $(date +%s) -lt $END_TIME ]]; do
  LOOP=$((LOOP + 1))
  CURRENT_TIME=$(date +%s)
  REMAINING=$(( (END_TIME - CURRENT_TIME) / 60 ))

  echo "" | tee -a "$LOG_FILE"
  echo "========== LOOP $LOOP | ${REMAINING}min remaining ==========" | tee -a "$LOG_FILE"

  # Run census every 2 hours
  if [[ $((CURRENT_TIME - LAST_CENSUS)) -ge $CENSUS_INTERVAL ]]; then
    run_census
    check_completeness
    LAST_CENSUS=$CURRENT_TIME
  fi

  # Check queue status
  queue_status

  # Run extraction batches for known sources
  for SOURCE in bat mecum pcarmarket hagerty; do
    run_extraction "$SOURCE" 25
    sleep 5
  done

  # Sleep between loops
  echo "[$(date +%H:%M:%S)] Sleeping 5 minutes..." | tee -a "$LOG_FILE"
  sleep 300
done

echo "" | tee -a "$LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"
echo "OVERNIGHT RUN COMPLETE" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"
echo "Total loops: $LOOP" | tee -a "$LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"

# Final completeness check
check_completeness
