#!/bin/bash
# Backfill vehicle_observations from existing vehicle data
# Uses individual transactions per batch to avoid statement timeout rollbacks
# Usage: ./scripts/backfill-observations.sh <source_vehicle_field> <observation_source_slug> [batch_size]

set -euo pipefail

SOURCE_FIELD="${1:?Usage: $0 <vehicle.source value> <observation_sources.slug>}"
SOURCE_SLUG="${2:?Usage: $0 <vehicle.source value> <observation_sources.slug>}"
BATCH_SIZE="${3:-1000}"
SLEEP_SECS="0.3"

export PGPASSWORD="RbzKq32A0uhqvJMQ"
PG_OPTS="-h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -A"

echo "[$(date)] Starting observation backfill: source='${SOURCE_FIELD}' -> slug='${SOURCE_SLUG}' batch=${BATCH_SIZE}"

TOTAL=0
ROUND=0

while true; do
  ROUND=$((ROUND + 1))

  AFFECTED=$(psql $PG_OPTS -c "
    WITH inserted AS (
      INSERT INTO vehicle_observations (vehicle_id, source_id, kind, content_text, structured_data, observed_at, vehicle_match_confidence, confidence, confidence_score, source_url, source_identifier, extraction_method)
      SELECT
        v.id,
        os.id,
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
      CROSS JOIN observation_sources os
      WHERE os.slug = '${SOURCE_SLUG}'
        AND v.source = '${SOURCE_FIELD}'
        AND v.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM vehicle_observations vo
          WHERE vo.vehicle_id = v.id AND vo.source_id = os.id AND vo.kind = 'listing'
        )
      LIMIT ${BATCH_SIZE}
      ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING
      RETURNING 1
    )
    SELECT count(*) FROM inserted;
  " 2>&1)

  # Strip whitespace
  AFFECTED=$(echo "$AFFECTED" | tr -d '[:space:]')

  if [ "$AFFECTED" = "0" ] || [ -z "$AFFECTED" ]; then
    echo "[$(date)] Done. Total observations created for ${SOURCE_SLUG}: ${TOTAL}"
    break
  fi

  TOTAL=$((TOTAL + AFFECTED))

  if [ $((TOTAL % 10000)) -lt $BATCH_SIZE ]; then
    echo "[$(date)] ${SOURCE_SLUG}: +${AFFECTED} (total: ${TOTAL})"
  fi

  sleep $SLEEP_SECS
done
