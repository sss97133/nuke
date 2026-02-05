#!/bin/bash
# Playwright Extraction Supervisor
# Monitors and auto-restarts the universal extractor
# Run with: nohup ./scripts/supervisor.sh >> logs/supervisor.log 2>&1 &

cd /Users/skylar/nuke

LOG_FILE="logs/supervisor.log"
EXTRACTOR_LOG="logs/playwright-universal.log"
WORKERS=${WORKERS:-6}
CHECK_INTERVAL=60  # seconds

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

start_extractor() {
  log "Starting universal extractor with $WORKERS workers..."
  WORKERS=$WORKERS nohup dotenvx run -- npx tsx scripts/playwright-universal.ts >> "$EXTRACTOR_LOG" 2>&1 &
  echo $! > /tmp/playwright-extractor.pid
  log "Started with PID $(cat /tmp/playwright-extractor.pid)"
}

is_running() {
  if [ -f /tmp/playwright-extractor.pid ]; then
    pid=$(cat /tmp/playwright-extractor.pid)
    if ps -p $pid > /dev/null 2>&1; then
      return 0
    fi
  fi
  # Also check by process name
  if pgrep -f "playwright-universal" > /dev/null; then
    return 0
  fi
  return 1
}

check_health() {
  # Check if log has been updated in last 5 minutes
  if [ -f "$EXTRACTOR_LOG" ]; then
    last_mod=$(stat -f %m "$EXTRACTOR_LOG" 2>/dev/null || stat -c %Y "$EXTRACTOR_LOG" 2>/dev/null)
    now=$(date +%s)
    diff=$((now - last_mod))
    if [ $diff -gt 300 ]; then
      log "WARNING: Log stale for ${diff}s"
      return 1
    fi
  fi
  return 0
}

clear_stale_locks() {
  log "Clearing stale locks..."
  dotenvx run -- bash -c 'PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "UPDATE import_queue SET status = '\''pending'\'', locked_at = NULL, locked_by = NULL WHERE status = '\''processing'\'' AND locked_at < NOW() - INTERVAL '\''10 minutes'\''"' 2>/dev/null
}

cleanup() {
  log "Supervisor shutting down..."
  if [ -f /tmp/playwright-extractor.pid ]; then
    kill $(cat /tmp/playwright-extractor.pid) 2>/dev/null
  fi
  exit 0
}

trap cleanup SIGINT SIGTERM

log "=== Supervisor started ==="

# Initial start
if ! is_running; then
  start_extractor
  sleep 10
fi

# Main loop
while true; do
  if ! is_running; then
    log "Extractor not running - restarting..."
    clear_stale_locks
    sleep 5
    start_extractor
    sleep 30
  elif ! check_health; then
    log "Extractor unhealthy - restarting..."
    pkill -f "playwright-universal" 2>/dev/null
    sleep 5
    clear_stale_locks
    start_extractor
    sleep 30
  fi

  sleep $CHECK_INTERVAL
done
