#!/usr/bin/env bash
# Batch migrate vehicle_events -> vehicle_observations
# 1000 rows per batch, 0.2s sleep between batches
set -euo pipefail

PGPASSWORD="RbzKq32A0uhqvJMQ"
export PGPASSWORD
PSQL="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres"

BATCH_SIZE=1000
TOTAL=0
BATCH=0

SQL="INSERT INTO vehicle_observations (
  vehicle_id, source_id, kind, source_url, observed_at,
  vehicle_match_confidence, structured_data,
  source_identifier, extraction_method, confidence
)
SELECT
  ve.vehicle_id,
  os.id,
  'listing'::observation_kind,
  ve.source_url,
  COALESCE(ve.started_at, ve.created_at, now()),
  1.0,
  jsonb_build_object(
    'event_type', ve.event_type,
    'event_status', ve.event_status,
    'comment_count', ve.comment_count,
    'bid_count', ve.bid_count,
    'view_count', ve.view_count,
    'watcher_count', ve.watcher_count,
    'final_price', ve.final_price,
    'current_price', ve.current_price,
    'starting_price', ve.starting_price,
    'reserve_price', ve.reserve_price,
    'buy_now_price', ve.buy_now_price,
    'source_platform', ve.source_platform,
    'source_listing_id', ve.source_listing_id,
    'seller_identifier', ve.seller_identifier,
    'buyer_identifier', ve.buyer_identifier,
    'ended_at', ve.ended_at,
    'sold_at', ve.sold_at,
    'vehicle_event_id', ve.id
  ),
  've-' || ve.id::text,
  'vehicle_events_migration',
  'high'::confidence_level
FROM vehicle_events ve
JOIN observation_sources os ON os.slug = (
  CASE ve.source_platform
    WHEN 'barrettjackson' THEN 'barrett-jackson'
    WHEN 'cars_and_bids' THEN 'cars-and-bids'
    WHEN 'collecting_cars' THEN 'collecting-cars'
    WHEN 'broad_arrow' THEN 'broad-arrow'
    WHEN 'deal_jacket_ocr' THEN 'deal-jacket-ocr'
    WHEN 'rmsothebys' THEN 'rm-sothebys'
    WHEN 'classic_com' THEN 'classic-com'
    WHEN 'Motorious' THEN 'motorious'
    WHEN 'Streetside Classics' THEN 'streetside-classics'
    WHEN 'ClassicCars.com' THEN 'classiccars-com'
    WHEN 'Velocity Restorations' THEN 'velocity-restorations'
    WHEN 'www.vanguardmotorsales.com' THEN 'vanguard-motor-sales'
    WHEN 'www.gatewayclassiccars.com' THEN 'gateway-classic-cars'
    WHEN 'www.oldcaronline.com' THEN 'oldcaronline'
    WHEN 'hagerty' THEN 'hagerty-marketplace'
    WHEN 'facebook-marketplace' THEN 'facebook_marketplace'
    WHEN 'craigslist' THEN 'craigslist_archive'
    WHEN 'owner_import' THEN 'owner-input'
    WHEN 'owner_submission' THEN 'owner-input'
    WHEN 'User Submission' THEN 'owner-input'
    WHEN 'user-submission' THEN 'owner-input'
    ELSE ve.source_platform
  END
)
WHERE NOT EXISTS (
  SELECT 1 FROM vehicle_observations vo
  WHERE vo.source_identifier = 've-' || ve.id::text
    AND vo.kind = 'listing'
)
LIMIT $BATCH_SIZE;"

while true; do
  BATCH=$((BATCH + 1))

  RESULT=$($PSQL -c "$SQL" 2>&1)

  # Extract row count from "INSERT 0 N" (macOS-compatible)
  ROWS=$(echo "$RESULT" | sed -n 's/^INSERT 0 \([0-9]*\)/\1/p')
  ROWS=${ROWS:-0}

  if [ "$ROWS" = "0" ]; then
    echo "[$(date +%H:%M:%S)] Batch $BATCH: 0 rows. Migration complete."
    break
  fi

  TOTAL=$((TOTAL + ROWS))

  if [ $((BATCH % 10)) -eq 0 ]; then
    echo "[$(date +%H:%M:%S)] Batch $BATCH: +$ROWS rows (total: $TOTAL)"
  fi

  # Check locks every 50 batches
  if [ $((BATCH % 50)) -eq 0 ]; then
    LOCKS=$($PSQL -t -c "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock';" 2>&1 | tr -d ' ')
    if [ "$LOCKS" != "0" ]; then
      echo "WARNING: $LOCKS lock waiters detected at batch $BATCH. Pausing 5s..."
      sleep 5
    fi
  fi

  sleep 0.2
done

echo "=== Migration Summary ==="
echo "Total observations created: $TOTAL"
echo "Total batches: $BATCH"

# Final count
FINAL=$($PSQL -t -c "SELECT count(*) FROM vehicle_observations WHERE extraction_method = 'vehicle_events_migration';" 2>&1)
echo "Verified observations with extraction_method='vehicle_events_migration': $FINAL"
