#!/bin/bash
# Backfill sale_result observations from vehicles with sale_price and sale_date
# Usage: ./scripts/backfill-sale-results.sh <vehicle.source> <obs_source.slug> [batch_size]

set -euo pipefail

SOURCE_FIELD="${1:?Usage: $0 <vehicle.source value> <observation_sources.slug>}"
SOURCE_SLUG="${2:?Usage: $0 <vehicle.source value> <observation_sources.slug>}"
BATCH_SIZE="${3:-1000}"
SLEEP_SECS="0.3"

export PGPASSWORD="RbzKq32A0uhqvJMQ"
PG="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres"

echo "[$(date)] Sale result backfill: source='${SOURCE_FIELD}' -> slug='${SOURCE_SLUG}'"

SOURCE_UUID=$($PG -t -A -c "SELECT id FROM observation_sources WHERE slug = '${SOURCE_SLUG}';")
if [ -z "$SOURCE_UUID" ]; then
  echo "ERROR: slug '${SOURCE_SLUG}' not found"
  exit 1
fi

TOTAL=0

while true; do
  AFFECTED=$($PG -t -A -c "
    WITH inserted AS (
      INSERT INTO vehicle_observations (vehicle_id, source_id, kind, content_text, structured_data, observed_at, vehicle_match_confidence, confidence, confidence_score, source_url, source_identifier, extraction_method)
      SELECT
        v.id,
        '${SOURCE_UUID}'::uuid,
        'sale_result'::observation_kind,
        concat_ws(' | ', v.year, v.make, v.model, '\$' || v.sale_price::text, v.sale_status),
        jsonb_strip_nulls(jsonb_build_object(
          'sale_price', v.sale_price,
          'sale_date', v.sale_date,
          'sale_status', v.sale_status,
          'bid_count', COALESCE(v.bat_bid_count, v.bid_count),
          'view_count', COALESCE(v.bat_view_count, v.view_count)
        )),
        v.sale_date::timestamptz,
        1.0,
        'high'::confidence_level,
        0.90,
        COALESCE(v.bat_auction_url, v.listing_url, v.discovery_url, v.platform_url),
        COALESCE(v.bat_auction_url, v.listing_url, v.discovery_url, v.platform_url, v.id::text),
        'backfill-sale-results'
      FROM vehicles v
      WHERE v.source = '${SOURCE_FIELD}' AND v.deleted_at IS NULL
        AND v.sale_price IS NOT NULL AND v.sale_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_observations vo
          WHERE vo.vehicle_id = v.id AND vo.source_id = '${SOURCE_UUID}'::uuid AND vo.kind = 'sale_result'
        )
      LIMIT ${BATCH_SIZE}
      ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) FROM inserted;
  " 2>&1)

  AFFECTED=$(echo "$AFFECTED" | tr -d '[:space:]')
  if [ "$AFFECTED" = "0" ] || [ -z "$AFFECTED" ]; then
    break
  fi

  TOTAL=$((TOTAL + AFFECTED))
  if [ $((TOTAL % 10000)) -lt $BATCH_SIZE ]; then
    echo "[$(date)] ${SOURCE_SLUG} sale_result: ${TOTAL}"
  fi

  sleep $SLEEP_SECS
done

echo "[$(date)] Done. Sale results for ${SOURCE_SLUG}: ${TOTAL}"
