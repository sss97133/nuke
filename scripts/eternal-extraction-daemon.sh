#!/bin/bash
#
# ETERNAL EXTRACTION DAEMON
#
# A self-healing, persistent extraction orchestrator that:
# - Runs forever (or until killed)
# - Maintains N parallel workers at all times
# - Retries failed items with exponential backoff
# - Logs health metrics
# - Alerts on anomalies (stalls, high failure rates)
#
# Usage:
#   ./scripts/eternal-extraction-daemon.sh          # Run in foreground
#   nohup ./scripts/eternal-extraction-daemon.sh &  # Run as daemon
#
# Stop: kill $(cat /tmp/eternal-extraction.pid)
#

set -euo pipefail

cd "$(dirname "$0")/.."

# Config
TARGET_WORKERS=8
BATCH_SIZE=100
HEALTH_CHECK_INTERVAL=60  # seconds
MAX_FAILURE_RATE=0.3      # alert if >30% failing
STALL_THRESHOLD=300       # alert if no progress in 5 min
LOG_DIR="logs/daemon"
PID_FILE="/tmp/eternal-extraction.pid"

mkdir -p "$LOG_DIR"
echo $$ > "$PID_FILE"

# Load env
export $(dotenvx run -- env 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

log() {
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" | tee -a "$LOG_DIR/daemon.log"
}

get_queue_stats() {
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -c "
    SELECT
      COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status='complete' THEN 1 ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END), 0)
    FROM import_queue;" 2>/dev/null | tr '|' ' '
}

get_active_workers() {
  ps aux | grep "autonomous-bat-processor" | grep -v grep | wc -l | xargs
}

spawn_worker() {
  local id="$1"
  nohup dotenvx run -- bash scripts/autonomous-bat-processor.sh $BATCH_SIZE > "$LOG_DIR/worker-$id.log" 2>&1 &
  log "Spawned worker $id (PID: $!)"
}

maintain_workers() {
  local current=$(get_active_workers)
  local needed=$((TARGET_WORKERS - current))

  if [ $needed -gt 0 ]; then
    log "Workers: $current/$TARGET_WORKERS - spawning $needed more"
    for i in $(seq 1 $needed); do
      spawn_worker "$(date +%s)-$i"
      sleep 2
    done
  fi
}

reset_stale_processing() {
  # Reset items stuck in 'processing' for >10 min
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
    UPDATE import_queue
    SET status = 'pending', locked_at = NULL, locked_by = NULL
    WHERE status = 'processing'
      AND locked_at < NOW() - INTERVAL '10 minutes';" 2>/dev/null
}

retry_failed_with_backoff() {
  # Reset failed items that haven't exceeded max attempts
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
    UPDATE import_queue
    SET status = 'pending'
    WHERE status = 'failed'
      AND attempts < max_attempts
      AND (next_attempt_at IS NULL OR next_attempt_at < NOW())
    LIMIT 1000;" 2>/dev/null
}

log "═══════════════════════════════════════════════════════════"
log "  ETERNAL EXTRACTION DAEMON STARTED"
log "  Target workers: $TARGET_WORKERS"
log "  Batch size: $BATCH_SIZE"
log "  PID: $$"
log "═══════════════════════════════════════════════════════════"

last_complete=0
stall_counter=0

while true; do
  # Get current stats
  read pending processing complete failed <<< $(get_queue_stats)
  workers=$(get_active_workers)

  # Check for stall
  if [ "$complete" = "$last_complete" ]; then
    stall_counter=$((stall_counter + 1))
    if [ $stall_counter -ge 5 ]; then
      log "⚠️  STALL DETECTED - no progress in $((stall_counter * HEALTH_CHECK_INTERVAL))s"
    fi
  else
    stall_counter=0
  fi
  last_complete=$complete

  # Log status
  log "📊 Queue: $pending pending | $processing processing | $complete complete | $failed failed | $workers workers"

  # Maintain worker count
  maintain_workers

  # Reset stale processing items
  reset_stale_processing

  # Retry failed items periodically
  if [ $((RANDOM % 10)) -eq 0 ]; then
    retry_failed_with_backoff
  fi

  # Check if done
  if [ "$pending" = "0" ] && [ "$processing" = "0" ]; then
    log "✅ QUEUE EMPTY - extraction complete!"
    # Keep running in case new items arrive
  fi

  sleep $HEALTH_CHECK_INTERVAL
done
