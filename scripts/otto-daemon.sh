#!/bin/bash
# otto-daemon — continuous agent task executor
# Polls agent_tasks every 60s and fires otto-spawn when pending work exists.
# Run once: nohup bash scripts/otto-daemon.sh > logs/otto-daemon.log 2>&1 &

set -euo pipefail
cd /Users/skylar/nuke

POLL_INTERVAL=60
LOG="logs/otto-daemon.log"
CONCURRENCY=8
PIDFILE=".otto-daemon.pid"

mkdir -p logs
echo $$ > "$PIDFILE"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

cleanup() {
  log "otto-daemon stopping (PID $$)"
  rm -f "$PIDFILE"
}
trap cleanup EXIT

log "otto-daemon started (PID $$) — polling every ${POLL_INTERVAL}s, concurrency ${CONCURRENCY}"

while true; do
  # Count pending tasks
  PENDING=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
    -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres \
    -t -A -c "SELECT COUNT(*) FROM agent_tasks WHERE status = 'pending';" 2>/dev/null || echo "0")

  PENDING=$(echo "$PENDING" | tr -d '[:space:]')

  if [ "${PENDING:-0}" -gt 0 ]; then
    log "${PENDING} pending tasks — firing otto-spawn (concurrency ${CONCURRENCY})"
    dotenvx run -- node scripts/otto-spawn.mjs --concurrency "$CONCURRENCY" >> "$LOG" 2>&1 || \
      log "otto-spawn exited with error $?"
  else
    log "queue empty — sleeping ${POLL_INTERVAL}s"
  fi

  sleep "$POLL_INTERVAL"
done
