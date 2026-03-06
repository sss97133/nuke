#!/usr/bin/env bash
# Merge duplicate vehicle stubs into their canonical counterparts.
# These are rows where listing_url matches another vehicle's discovery_url,
# meaning the same vehicle exists twice — one enriched, one empty.
#
# Usage: dotenvx run -- bash scripts/merge-duplicate-stubs.sh
set -e

if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "Need SUPABASE_DB_PASSWORD (use dotenvx run --)" >&2; exit 1
fi

PSQL="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -q"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
BATCH=5000

for SOURCE in bat barrett-jackson cars_and_bids collecting_cars gooding; do
  echo ""
  echo "=== Merging duplicates: $SOURCE ==="
  total=0
  while true; do
    affected=$($PSQL -t -A -c "
      SET session_replication_role = replica;
      WITH dupes AS (
        SELECT v1.id as dupe_id, v2.id as canonical_id
        FROM vehicles v1
        JOIN vehicles v2 ON v2.discovery_url = v1.listing_url AND v2.id <> v1.id
        WHERE v1.sale_price IS NULL AND v1.discovery_url IS NULL
          AND v1.listing_url LIKE 'https://%'
          AND v1.auction_source = '$SOURCE'
          AND v1.status <> 'merged'
        LIMIT $BATCH
      )
      UPDATE vehicles SET status = 'merged', merged_into_vehicle_id = dupes.canonical_id
      FROM dupes WHERE vehicles.id = dupes.dupe_id
      RETURNING vehicles.id;
    " | wc -l | tr -d ' ')
    total=$((total + affected))
    echo "  Batch: $affected rows (total: $total)"
    [ "$affected" -eq 0 ] && break
    sleep 0.2
  done
  echo "  Done: $total $SOURCE duplicates merged"
done

echo ""
echo "=== SUMMARY ==="
$PSQL -c "
SELECT auction_source, count(*) as merged_count
FROM vehicles
WHERE status = 'merged' AND merged_into_vehicle_id IS NOT NULL
GROUP BY auction_source
ORDER BY merged_count DESC;
"
