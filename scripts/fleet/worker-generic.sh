#!/bin/bash
# worker-generic.sh — Generic Queue Processor
# Runs process-import-queue in a loop for non-domain-specific URLs

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [GENERIC-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/process-import-queue\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

log "Starting generic queue processor"

BATCH=0
IDLE_COUNT=0
MAX_IDLE=10

while [ "$(date +%s)" -lt "$END_TIME" ]; do
  BATCH=$((BATCH + 1))

  # Run 3 parallel batches
  RESULTS=""
  for i in 1 2 3; do
    RESULT=$(call_fn '{"batch_size": 10}')
    PROCESSED=$(echo "$RESULT" | jq -r '.processed // 0' 2>/dev/null)
    RESULTS="$RESULTS $PROCESSED"
  done

  TOTAL_PROCESSED=0
  for p in $RESULTS; do
    TOTAL_PROCESSED=$((TOTAL_PROCESSED + p))
  done

  log "Batch $BATCH: processed $TOTAL_PROCESSED (3 parallel x 10)"

  if [ "$TOTAL_PROCESSED" -eq 0 ]; then
    IDLE_COUNT=$((IDLE_COUNT + 1))
    if [ "$IDLE_COUNT" -ge "$MAX_IDLE" ]; then
      log "Idle for $IDLE_COUNT cycles, pausing for 5 minutes..."
      sleep 300
      IDLE_COUNT=0
    else
      sleep 30
    fi
  else
    IDLE_COUNT=0
    sleep 10
  fi
done

log "Generic worker complete."
