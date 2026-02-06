#!/bin/bash
# Aggressive BaT Extraction
# Runs until pending < 1000
cd /Users/skylar/nuke

echo "Starting aggressive BaT extraction at $(date)"

while true; do
  # Check pending count
  pending=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%bringatrailer%' AND status = 'pending';" 2>/dev/null | tr -d ' ')

  complete=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT COUNT(*) FROM bat_listings;" 2>/dev/null | tr -d ' ')

  echo "[$(date '+%H:%M:%S')] Pending: $pending | BaT Listings: $complete"

  if [ "$pending" -lt 1000 ]; then
    echo "Pending below 1000, slowing down..."
    sleep 30
  fi

  if [ "$pending" -lt 100 ]; then
    echo "Nearly complete! Checking for more..."
    sleep 60
    continue
  fi

  # Launch 20 parallel workers
  for i in {1..20}; do
    dotenvx run -- bash -c 'curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/bat-queue-worker" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"batch_size\": 50}"' 2>/dev/null &
  done

  # Wait for batch to complete
  wait

  # Brief pause before next round
  sleep 10
done
