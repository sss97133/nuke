#!/bin/bash
# Optimized backfill: pre-computes IDs needing observations, then inserts in batches
# This avoids the slow NOT EXISTS subquery on every batch
# Usage: ./scripts/backfill-observations-optimized.sh <vehicle.source> <obs_source.slug> [batch_size]

set -euo pipefail

SOURCE_FIELD="${1:?Usage: $0 <vehicle.source value> <observation_sources.slug>}"
SOURCE_SLUG="${2:?Usage: $0 <vehicle.source value> <observation_sources.slug>}"
BATCH_SIZE="${3:-500}"
SLEEP_SECS="0.3"

export PGPASSWORD="RbzKq32A0uhqvJMQ"
PG="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres"

echo "[$(date)] Optimized backfill: source='${SOURCE_FIELD}' -> slug='${SOURCE_SLUG}'"

# Step 1: Get the source UUID
SOURCE_UUID=$($PG -t -A -c "SELECT id FROM observation_sources WHERE slug = '${SOURCE_SLUG}';")
if [ -z "$SOURCE_UUID" ]; then
  echo "ERROR: observation_source slug '${SOURCE_SLUG}' not found"
  exit 1
fi
echo "[$(date)] Source UUID: ${SOURCE_UUID}"

# Step 2: Get all vehicle IDs that need observations into a temp file
echo "[$(date)] Fetching vehicle IDs that need observations..."
TMPFILE=$(mktemp /tmp/backfill-${SOURCE_SLUG}-XXXXX.txt)
$PG -t -A -c "
  SELECT v.id FROM vehicles v
  WHERE v.source = '${SOURCE_FIELD}' AND v.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_observations vo
    WHERE vo.vehicle_id = v.id AND vo.source_id = '${SOURCE_UUID}'::uuid AND vo.kind = 'listing'
  )
  ORDER BY v.id;
" > "$TMPFILE"

TOTAL_NEEDED=$(wc -l < "$TMPFILE" | tr -d '[:space:]')
echo "[$(date)] Found ${TOTAL_NEEDED} vehicles needing observations"

if [ "$TOTAL_NEEDED" = "0" ]; then
  echo "[$(date)] Nothing to do!"
  rm -f "$TMPFILE"
  exit 0
fi

# Step 3: Process in batches using the pre-computed ID list
TOTAL=0
OFFSET=0

while [ $OFFSET -lt $TOTAL_NEEDED ]; do
  # Get batch of IDs
  IDS=$(sed -n "$((OFFSET + 1)),$((OFFSET + BATCH_SIZE))p" "$TMPFILE" | paste -sd "," -)

  if [ -z "$IDS" ]; then
    break
  fi

  # Convert comma-separated UUIDs to array format for SQL
  ID_ARRAY=$(echo "$IDS" | sed "s/,/','/g")

  AFFECTED=$($PG -t -A -c "
    WITH inserted AS (
      INSERT INTO vehicle_observations (vehicle_id, source_id, kind, content_text, structured_data, observed_at, vehicle_match_confidence, confidence, confidence_score, source_url, source_identifier, extraction_method)
      SELECT
        v.id,
        '${SOURCE_UUID}'::uuid,
        'listing'::observation_kind,
        concat_ws(' | ', v.year, v.make, v.model, CASE WHEN v.sale_price IS NOT NULL THEN '\$' || v.sale_price::text END, COALESCE(v.bat_listing_title, v.listing_title)),
        jsonb_strip_nulls(jsonb_build_object(
          'year', v.year, 'make', v.make, 'model', v.model,
          'sale_price', v.sale_price, 'vin', v.vin, 'mileage', v.mileage,
          'color', v.color, 'interior_color', v.interior_color,
          'transmission', v.transmission, 'engine', v.engine_size,
          'sale_status', v.sale_status, 'sale_date', v.sale_date,
          'listing_title', COALESCE(v.bat_listing_title, v.listing_title),
          'bid_count', COALESCE(v.bat_bid_count, v.bid_count),
          'view_count', COALESCE(v.bat_view_count, v.view_count),
          'location', v.bat_location, 'seller', v.bat_seller
        )),
        COALESCE(v.sale_date::timestamptz, v.bat_sale_date::timestamptz, v.created_at, now()),
        1.0,
        'high'::confidence_level,
        0.85,
        COALESCE(v.bat_auction_url, v.listing_url, v.discovery_url, v.platform_url),
        COALESCE(v.bat_auction_url, v.listing_url, v.discovery_url, v.platform_url, v.id::text),
        'backfill-from-vehicles'
      FROM vehicles v
      WHERE v.id IN ('${ID_ARRAY}')
      ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) FROM inserted;
  " 2>&1)

  AFFECTED=$(echo "$AFFECTED" | tr -d '[:space:]')
  if [ -z "$AFFECTED" ]; then AFFECTED=0; fi

  TOTAL=$((TOTAL + AFFECTED))
  OFFSET=$((OFFSET + BATCH_SIZE))

  if [ $((TOTAL % 5000)) -lt $BATCH_SIZE ] || [ $OFFSET -ge $TOTAL_NEEDED ]; then
    echo "[$(date)] ${SOURCE_SLUG}: ${TOTAL}/${TOTAL_NEEDED} ($(( TOTAL * 100 / TOTAL_NEEDED ))%)"
  fi

  sleep $SLEEP_SECS
done

echo "[$(date)] Done. Total observations created for ${SOURCE_SLUG}: ${TOTAL}"
rm -f "$TMPFILE"
