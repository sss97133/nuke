#!/bin/bash
# Fix duplicate+active auction_status in 5000-row batches
export PGPASSWORD="RbzKq32A0uhqvJMQ"
PSQL_ARGS="-h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A"

total=0
while true; do
  remaining=$(psql $PSQL_ARGS -c "UPDATE vehicles SET auction_status = NULL WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active' LIMIT 5000); SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active';" 2>/dev/null)

  if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
    echo "$(date +%H:%M:%S) DONE — total cleared: $total"
    break
  fi

  cleared=$((347650 - remaining))
  total=$cleared
  echo "$(date +%H:%M:%S) Remaining: $remaining"
  sleep 0.1
done

# Fix reserve_status on duplicates
echo "--- Fixing reserve_status on duplicates ---"
while true; do
  remaining=$(psql $PSQL_ARGS -c "UPDATE vehicles SET reserve_status = NULL WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL LIMIT 5000); SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL;" 2>/dev/null)
  if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
    echo "Reserve status fix done"
    break
  fi
  echo "$(date +%H:%M:%S) Reserve remaining: $remaining"
  sleep 0.1
done

# Small fixes
psql $PSQL_ARGS -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'merged' AND auction_status = 'active';" 2>/dev/null
psql $PSQL_ARGS -c "UPDATE vehicles SET reserve_status = 'reserve_met' WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';" 2>/dev/null
psql $PSQL_ARGS -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'rejected' AND auction_status = 'active';" 2>/dev/null
psql $PSQL_ARGS -c "DROP INDEX IF EXISTS idx_tmp_dup_active_auction;" 2>/dev/null

echo "=== All Phase 5 fixes complete ==="
