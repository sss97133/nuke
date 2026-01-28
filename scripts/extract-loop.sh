#!/bin/bash
# Simple extraction loop - runs continuously
cd /Users/skylar/nuke
source .env 2>/dev/null || true

LOG="logs/extract-loop-$(date +%Y%m%d-%H%M%S).log"
echo "Starting extraction loop at $(date)" | tee "$LOG"
echo "Log: $LOG"

BATCH=50
WORKERS=3

while true; do
  # Check pending count
  PENDING=$(PGPASSWORD='RbzKq32A0uhqvJMQ' psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT COUNT(*) FROM import_queue WHERE status = 'pending'" 2>/dev/null | tr -d ' ')

  if [[ "$PENDING" -eq 0 ]]; then
    echo "[$(date +%H:%M:%S)] No pending items. Sleeping 5min..." | tee -a "$LOG"
    sleep 300
    continue
  fi

  echo "[$(date +%H:%M:%S)] $PENDING pending. Running $WORKERS workers..." | tee -a "$LOG"

  # Run workers in parallel
  for i in $(seq 1 $WORKERS); do
    curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/process-import-queue" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"batch_size\": $BATCH}" >> "$LOG" 2>&1 &
  done

  wait
  sleep 10
done
