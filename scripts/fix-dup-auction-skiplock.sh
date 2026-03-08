#!/bin/bash
# Fix duplicate+active auction_status — SKIP LOCKED to avoid deadlocks with other agents
export PGPASSWORD="RbzKq32A0uhqvJMQ"
P="-h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A"

echo "=== Starting auction_status cleanup (SKIP LOCKED) ==="
i=0
while true; do
  remaining=$(psql $P -c "UPDATE vehicles SET auction_status = NULL WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active' LIMIT 2000 FOR UPDATE SKIP LOCKED); SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active';" 2>/dev/null)

  if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
    echo "$(date +%H:%M:%S) DONE — auction_status cleanup complete"
    break
  fi

  i=$((i + 1))
  if [ $((i % 10)) -eq 0 ]; then
    echo "$(date +%H:%M:%S) Remaining: $remaining (batch $i)"
  fi
  sleep 0.05
done

echo "=== Starting reserve_status cleanup ==="
while true; do
  remaining=$(psql $P -c "UPDATE vehicles SET reserve_status = NULL WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL LIMIT 2000 FOR UPDATE SKIP LOCKED); SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL;" 2>/dev/null)
  if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
    echo "$(date +%H:%M:%S) Reserve cleanup done"
    break
  fi
  echo "$(date +%H:%M:%S) Reserve remaining: $remaining"
  sleep 0.05
done

# Small targeted fixes
echo "=== Small fixes ==="
psql $P -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'merged' AND auction_status = 'active';" 2>/dev/null
echo "merged+active fixed"
psql $P -c "UPDATE vehicles SET reserve_status = 'reserve_met' WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';" 2>/dev/null
echo "sold+rnm fixed"
psql $P -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'rejected' AND auction_status = 'active';" 2>/dev/null
echo "rejected+active fixed"
psql $P -c "DROP INDEX IF EXISTS idx_tmp_dup_active_auction;" 2>/dev/null
echo "index dropped"

echo "=== Phase 5 COMPLETE ==="
