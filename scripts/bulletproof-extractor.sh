#!/bin/bash
# BULLETPROOF OVERNIGHT EXTRACTOR
# Simple infinite loop - no fancy stuff, just works

cd /Users/skylar/nuke

while true; do
  # Count active workers
  WORKERS=$(ps aux | grep "autonomous-bat-processor" | grep -v grep | wc -l | xargs)
  
  # If less than 8 workers, spawn more
  if [ "$WORKERS" -lt 8 ]; then
    echo "[$(date)] Only $WORKERS workers - spawning more..."
    for i in $(seq 1 $((8 - WORKERS))); do
      nohup dotenvx run -- bash scripts/autonomous-bat-processor.sh 100 > logs/worker-$(date +%s)-$i.log 2>&1 &
      sleep 2
    done
  fi
  
  # Log status every minute
  PENDING=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT COUNT(*) FROM import_queue WHERE status='pending';" 2>/dev/null | xargs)
  echo "[$(date)] Workers: $WORKERS | Pending: $PENDING"
  
  sleep 60
done
