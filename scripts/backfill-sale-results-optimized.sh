#!/bin/bash
# Optimized sale_result backfill: pre-computes IDs, then inserts in batches
set -euo pipefail

SOURCE_FIELD="${1:?Usage: $0 <vehicle.source> <obs_source.slug> [batch_size]}"
SOURCE_SLUG="${2:?Usage: $0 <vehicle.source> <obs_source.slug> [batch_size]}"
BATCH_SIZE="${3:-500}"
SLEEP_SECS="0.3"

export PGPASSWORD="RbzKq32A0uhqvJMQ"
PG="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres"

echo "[$(date)] Optimized sale_result backfill: ${SOURCE_FIELD} -> ${SOURCE_SLUG}"

SOURCE_UUID=$($PG -t -A -c "SELECT id FROM observation_sources WHERE slug = '${SOURCE_SLUG}';")
echo "[$(date)] Source UUID: ${SOURCE_UUID}"

# Pre-compute IDs
echo "[$(date)] Fetching vehicle IDs..."
TMPFILE=$(mktemp /tmp/sale-results-${SOURCE_SLUG}-XXXXX.txt)
$PG -t -A -c "
  SELECT v.id FROM vehicles v
  WHERE v.source = '${SOURCE_FIELD}' AND v.deleted_at IS NULL
  AND v.sale_price IS NOT NULL AND v.sale_date IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM vehicle_observations vo
    WHERE vo.vehicle_id = v.id AND vo.source_id = '${SOURCE_UUID}'::uuid AND vo.kind = 'sale_result'
  )
  ORDER BY v.id;
" > "$TMPFILE"

TOTAL_NEEDED=$(wc -l < "$TMPFILE" | tr -d '[:space:]')
echo "[$(date)] Found ${TOTAL_NEEDED} vehicles needing sale_result observations"

TOTAL=0
OFFSET=0

while [ $OFFSET -lt $TOTAL_NEEDED ]; do
  IDS=$(sed -n "$((OFFSET + 1)),$((OFFSET + BATCH_SIZE))p" "$TMPFILE" | paste -sd "," -)
  [ -z "$IDS" ] && break
  ID_ARRAY=$(echo "$IDS" | sed "s/,/','/g")

  AFFECTED=$($PG -t -A -c "
    WITH inserted AS (
      INSERT INTO vehicle_observations (vehicle_id, source_id, kind, content_text, structured_data, observed_at, vehicle_match_confidence, confidence, confidence_score, source_url, source_identifier, extraction_method)
      SELECT
        v.id,
        '${SOURCE_UUID}'::uuid,
        'sale_result'::observation_kind,
        concat_ws(' | ', v.year, v.make, v.model, '\$' || v.sale_price::text, v.sale_status),
        jsonb_strip_nulls(jsonb_build_object(
          'sale_price', v.sale_price, 'sale_date', v.sale_date,
          'sale_status', v.sale_status,
          'bid_count', COALESCE(v.bat_bid_count, v.bid_count),
          'view_count', COALESCE(v.bat_view_count, v.view_count)
        )),
        v.sale_date::timestamptz,
        1.0, 'high'::confidence_level, 0.90,
        COALESCE(v.bat_auction_url, v.listing_url, v.discovery_url, v.platform_url),
        COALESCE(v.bat_auction_url, v.listing_url, v.discovery_url, v.platform_url, v.id::text),
        'backfill-sale-results'
      FROM vehicles v WHERE v.id IN ('${ID_ARRAY}')
      ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) FROM inserted;
  " 2>&1)

  AFFECTED=$(echo "$AFFECTED" | tr -d '[:space:]')
  [ -z "$AFFECTED" ] && AFFECTED=0
  TOTAL=$((TOTAL + AFFECTED))
  OFFSET=$((OFFSET + BATCH_SIZE))

  if [ $((TOTAL % 5000)) -lt $BATCH_SIZE ] || [ $OFFSET -ge $TOTAL_NEEDED ]; then
    echo "[$(date)] ${SOURCE_SLUG} sale_result: ${TOTAL}/${TOTAL_NEEDED} ($(( TOTAL * 100 / TOTAL_NEEDED ))%)"
  fi
  sleep $SLEEP_SECS
done

echo "[$(date)] Done. Sale results for ${SOURCE_SLUG}: ${TOTAL}"
rm -f "$TMPFILE"
