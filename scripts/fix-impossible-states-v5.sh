#!/bin/bash
# Phase 5: Fix impossible states — clean batch approach
set -e

PGPASSWORD="RbzKq32A0uhqvJMQ"
export PGPASSWORD

PSQL="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A -q"

echo "=== Phase 5: Fixing impossible states ==="

# Fix 1: Clear auction_status on duplicate rows
echo "--- Fix 1: Clear auction_status on ~358K duplicate rows ---"
total=0
while true; do
  result=$($PSQL <<'SQL'
WITH batch AS (
  SELECT id FROM vehicles
  WHERE status = 'duplicate' AND auction_status = 'active'
  LIMIT 5000
)
UPDATE vehicles v SET auction_status = NULL
FROM batch b WHERE v.id = b.id;
SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND auction_status = 'active';
SQL
  )

  remaining=$(echo "$result" | tail -1 | tr -d '[:space:]')
  total=$((358650 - remaining))
  echo "  Cleared so far: $total | Remaining: $remaining"

  if [ "$remaining" = "0" ]; then
    break
  fi

  sleep 0.15
done
echo "Fix 1 complete: $total rows"

# Fix 2: Clear reserve_status on duplicates
echo "--- Fix 2: Clear reserve_status on duplicates ---"
while true; do
  result=$($PSQL <<'SQL'
WITH batch AS (
  SELECT id FROM vehicles
  WHERE status = 'duplicate' AND reserve_status IS NOT NULL
  LIMIT 5000
)
UPDATE vehicles v SET reserve_status = NULL
FROM batch b WHERE v.id = b.id;
SELECT COUNT(*) FROM vehicles WHERE status = 'duplicate' AND reserve_status IS NOT NULL;
SQL
  )
  remaining=$(echo "$result" | tail -1 | tr -d '[:space:]')
  echo "  Remaining: $remaining"
  if [ "$remaining" = "0" ]; then break; fi
  sleep 0.15
done
echo "Fix 2 complete"

# Fix 3-5: Small fixes
echo "--- Fixes 3-5: merged+active, sold+rnm, rejected+active ---"
$PSQL <<'SQL'
UPDATE vehicles SET auction_status = NULL WHERE status = 'merged' AND auction_status = 'active';
UPDATE vehicles SET reserve_status = 'reserve_met' WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met';
UPDATE vehicles SET auction_status = NULL WHERE status = 'rejected' AND auction_status = 'active';
DROP INDEX IF EXISTS idx_tmp_dup_active_auction;
SQL
echo "Fixes 3-5 complete"

# Final verification
echo "=== Final verification ==="
$PSQL <<'SQL'
SELECT
  'dup_with_auction: ' || COUNT(*) FILTER (WHERE status = 'duplicate' AND auction_status IS NOT NULL),
  'merged_active: ' || COUNT(*) FILTER (WHERE status = 'merged' AND auction_status = 'active'),
  'sold_rnm: ' || COUNT(*) FILTER (WHERE status = 'active' AND auction_status = 'sold' AND reserve_status = 'reserve_not_met'),
  'rejected_active: ' || COUNT(*) FILTER (WHERE status = 'rejected' AND auction_status = 'active')
FROM vehicles;
SQL

echo "=== Phase 5 complete ==="
