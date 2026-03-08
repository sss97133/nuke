#!/bin/bash
# Phase 5: Fix impossible states via individual batched UPDATE calls
# Uses transaction-mode pooler-safe approach: each UPDATE is its own transaction

PSQL_CMD="PGPASSWORD=RbzKq32A0uhqvJMQ psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A"

total=0
batch_size=5000

echo "=== Phase 5: Fixing impossible states ==="
echo "--- Fix 1: Clear auction_status on 358K duplicate rows ---"

while true; do
  affected=$(eval $PSQL_CMD -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND auction_status = 'active'
      LIMIT $batch_size
    )
    UPDATE vehicles v SET auction_status = NULL
    FROM batch b WHERE v.id = b.id
    RETURNING v.id;
  " 2>/dev/null | wc -l | tr -d ' ')

  if [ "$affected" -eq 0 ] 2>/dev/null; then
    break
  fi

  total=$((total + affected))

  if [ $((total % 20000)) -eq 0 ]; then
    echo "Progress: $total dup auction_status cleared"
  fi

  sleep 0.1
done

echo "Fix 1 complete: $total duplicate+active_auction cleared"

# Fix 2: Clear reserve_status on duplicates
echo "--- Fix 2: Clear reserve_status on duplicates ---"
total2=0
while true; do
  affected=$(eval $PSQL_CMD -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE status = 'duplicate' AND reserve_status IS NOT NULL
      LIMIT $batch_size
    )
    UPDATE vehicles v SET reserve_status = NULL
    FROM batch b WHERE v.id = b.id
    RETURNING v.id;
  " 2>/dev/null | wc -l | tr -d ' ')

  if [ "$affected" -eq 0 ] 2>/dev/null; then
    break
  fi
  total2=$((total2 + affected))
  if [ $((total2 % 20000)) -eq 0 ]; then
    echo "Progress: $total2 dup reserve_status cleared"
  fi
  sleep 0.1
done
echo "Fix 2 complete: $total2 duplicate reserve_status cleared"

# Fix 3: merged + active auction
echo "--- Fix 3: Clear auction_status on merged rows ---"
eval $PSQL_CMD -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'merged' AND auction_status = 'active';"

# Fix 4: sold + reserve_not_met
echo "--- Fix 4: Fix sold + reserve_not_met ---"
eval $PSQL_CMD -c "UPDATE vehicles SET reserve_status = 'reserve_met' WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';"

# Fix 5: rejected + active auction
echo "--- Fix 5: Clear auction_status on rejected rows ---"
eval $PSQL_CMD -c "UPDATE vehicles SET auction_status = NULL WHERE status = 'rejected' AND auction_status = 'active';"

# Drop temp index
eval $PSQL_CMD -c "DROP INDEX IF EXISTS idx_tmp_dup_active_auction;"

# Final verification
echo "=== Final verification ==="
eval $PSQL_CMD -c "
SELECT
  COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status IS NOT NULL) as dup_with_auction,
  COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active') as merged_active,
  COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met') as sold_rnm,
  COUNT(*) FILTER (WHERE status = 'rejected' AND auction_status = 'active') as rejected_active
FROM vehicles;
"

echo "=== Phase 5 complete ==="
