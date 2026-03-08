#!/bin/bash
# Fix duplicate+active auction_status — 2000-row batches to stay within 2min timeout
export PGPASSWORD="RbzKq32A0uhqvJMQ"
P="-h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A"

echo "=== Starting auction_status cleanup ==="
i=0
while true; do
  remaining=$(psql $P -c "UPDATE vehicles SET auction_status = NULL WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active' LIMIT 2000); SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active';" 2>/dev/null)

  if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
    echo "$(date +%H:%M:%S) DONE"
    break
  fi

  i=$((i + 1))
  if [ $((i % 5)) -eq 0 ]; then
    echo "$(date +%H:%M:%S) Remaining: $remaining (batch $i)"
  fi
  sleep 0.05
done

echo "=== Starting reserve_status cleanup ==="
while true; do
  remaining=$(psql $P -c "UPDATE vehicles SET reserve_status = NULL WHERE id IN (SELECT id FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL LIMIT 2000); SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL;" 2>/dev/null)
  if [ -z "$remaining" ] || [ "$remaining" = "0" ]; then
    echo "Reserve done"
    break
  fi
  echo "$(date +%H:%M:%S) Reserve remaining: $remaining"
  sleep 0.05
done

psql $P -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'merged' AND auction_status = 'active';" 2>/dev/null
psql $P -c "UPDATE vehicles SET reserve_status = 'reserve_met' WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';" 2>/dev/null
psql $P -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'rejected' AND auction_status = 'active';" 2>/dev/null
psql $P -c "DROP INDEX IF EXISTS idx_tmp_dup_active_auction;" 2>/dev/null

echo "=== All Phase 5 fixes complete ==="
psql $P -c "SELECT COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status IS NOT NULL) as dup_auction, COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active, COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as sold_rnm FROM vehicles;" 2>/dev/null
