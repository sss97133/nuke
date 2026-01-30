#!/bin/bash
# OVERNIGHT BATCH PROCESSOR
# Runs structure-threads in a loop with error handling
# Stop: kill the process or create ~/nuke/.stop-overnight

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/overnight-batch.log"
STOP_FILE="$PROJECT_DIR/.stop-overnight"
BATCH_SIZE=50
PAUSE_BETWEEN_BATCHES=30  # seconds between batches
MAX_CONSECUTIVE_ERRORS=5

cd "$PROJECT_DIR"

# Clean up any previous stop file
rm -f "$STOP_FILE"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_connectivity() {
  # Quick connectivity check
  if ! curl -s -m 10 -o /dev/null -w "%{http_code}" "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/" | grep -q "401\|200"; then
    return 1
  fi
  return 0
}

log "=========================================="
log "OVERNIGHT BATCH PROCESSOR STARTED"
log "Batch size: $BATCH_SIZE"
log "Log file: $LOG_FILE"
log "To stop: touch $STOP_FILE"
log "=========================================="

consecutive_errors=0
total_batches=0
start_time=$(date +%s)

while true; do
  # Check for stop signal
  if [[ -f "$STOP_FILE" ]]; then
    log "Stop file detected. Shutting down gracefully."
    rm -f "$STOP_FILE"
    break
  fi

  # Check connectivity
  if ! check_connectivity; then
    log "WARNING: Connectivity issue detected. Waiting 60s..."
    sleep 60
    # Try flushing DNS
    dscacheutil -flushcache 2>/dev/null
    sleep 5
    if ! check_connectivity; then
      log "ERROR: Still no connectivity. Waiting 5 minutes..."
      sleep 300
      ((consecutive_errors++))
      if [[ $consecutive_errors -ge $MAX_CONSECUTIVE_ERRORS ]]; then
        log "FATAL: Too many consecutive errors. Stopping."
        break
      fi
      continue
    fi
  fi

  log "Starting batch #$((total_batches + 1))..."

  # Run the batch script (multi-server with failover)
  output=$(dotenvx run -- node scripts/batch-structure-threads-multi.js --limit=$BATCH_SIZE 2>&1)
  exit_code=$?

  if [[ $exit_code -eq 0 ]]; then
    # Extract stats from output
    processed=$(echo "$output" | grep "Threads processed:" | awk '{print $3}')
    vehicles=$(echo "$output" | grep "Vehicles created:" | awk '{print $3}')
    errors=$(echo "$output" | grep "Errors:" | awk '{print $2}')

    log "Batch complete: processed=$processed vehicles=$vehicles errors=$errors"

    ((total_batches++))
    consecutive_errors=0

    # If no threads were processed, we might be done
    if [[ "$processed" == "0" ]]; then
      log "No threads to process. Waiting 10 minutes before checking again..."
      sleep 600
    else
      log "Pausing $PAUSE_BETWEEN_BATCHES seconds before next batch..."
      sleep $PAUSE_BETWEEN_BATCHES
    fi
  else
    ((consecutive_errors++))
    log "ERROR: Batch failed with exit code $exit_code (consecutive: $consecutive_errors)"

    if [[ $consecutive_errors -ge $MAX_CONSECUTIVE_ERRORS ]]; then
      log "FATAL: Too many consecutive errors. Stopping."
      break
    fi

    log "Waiting 2 minutes before retry..."
    sleep 120
  fi
done

end_time=$(date +%s)
duration=$(( (end_time - start_time) / 60 ))

log "=========================================="
log "OVERNIGHT BATCH COMPLETE"
log "Total batches: $total_batches"
log "Runtime: $duration minutes"
log "=========================================="
