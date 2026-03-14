#!/bin/bash
# Batch recalculate data_quality_score for all active vehicles via psql
# Each batch is its own transaction, uses FOR UPDATE SKIP LOCKED to avoid deadlocks

set -euo pipefail

PGPASSWORD="RbzKq32A0uhqvJMQ"
PGHOST="aws-0-us-west-1.pooler.supabase.com"
PGPORT="6543"
PGUSER="postgres.qkgaybvrernstplzjaam"
PGDB="postgres"

BATCH_SIZE=2000
TOTAL=0
BATCH_NUM=0
CURSOR="00000000-0000-0000-0000-000000000000"

export PGPASSWORD

echo "Starting quality score recalculation..."
echo "Batch size: $BATCH_SIZE"
echo ""

while true; do
  BATCH_NUM=$((BATCH_NUM + 1))

  RESULT=$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -t -A -c "
    WITH batch AS (
      SELECT id FROM vehicles
      WHERE status = 'active' AND id > '${CURSOR}'::uuid
      ORDER BY id
      LIMIT ${BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    ),
    updated AS (
      UPDATE vehicles v SET data_quality_score = LEAST(100, GREATEST(0,
        CASE WHEN coalesce(v.image_count,0) >= 10 THEN 25 WHEN coalesce(v.image_count,0) >= 5 THEN 20 WHEN coalesce(v.image_count,0) >= 1 THEN 10 ELSE 0 END
        + CASE WHEN v.year IS NOT NULL AND v.year >= 1885 AND v.year <= 2028 THEN 8 ELSE 0 END
        + CASE WHEN v.make IS NOT NULL AND trim(v.make) <> '' AND length(trim(v.make)) <= 50 THEN 8 ELSE 0 END
        + CASE WHEN v.model IS NOT NULL AND trim(v.model) <> '' THEN CASE WHEN length(trim(v.model)) <= 80 THEN 9 ELSE 3 END ELSE 0 END
        + CASE WHEN coalesce(v.observation_count,0) >= 10 THEN 20 WHEN coalesce(v.observation_count,0) >= 5 THEN 15 WHEN coalesce(v.observation_count,0) >= 1 THEN 10 ELSE 0 END
        + CASE WHEN v.sale_price IS NOT NULL AND v.sale_price >= 100 THEN 15 WHEN v.asking_price IS NOT NULL AND v.asking_price > 0 THEN 15 WHEN v.current_value IS NOT NULL AND v.current_value > 0 THEN 15 WHEN v.nuke_estimate IS NOT NULL AND v.nuke_estimate > 0 THEN 15 ELSE 0 END
        + CASE WHEN v.vin IS NOT NULL AND length(trim(v.vin)) >= 11 THEN CASE WHEN v.year IS NULL OR v.year < 1981 THEN 15 WHEN length(trim(v.vin)) = 17 THEN 15 ELSE 5 END ELSE 0 END
      ))
      FROM batch WHERE v.id = batch.id
      RETURNING v.id
    )
    SELECT count(*) || '|' || coalesce((SELECT id::text FROM batch ORDER BY id DESC LIMIT 1), 'DONE') FROM updated;
  " 2>&1)

  # Parse
  ROWS=$(echo "$RESULT" | cut -d'|' -f1 | tr -d ' ')
  LAST_ID=$(echo "$RESULT" | cut -d'|' -f2 | tr -d ' ')

  if [ -z "$ROWS" ] || [ "$ROWS" = "0" ] || [ "$LAST_ID" = "DONE" ]; then
    echo "Batch $BATCH_NUM: No more rows. Done!"
    break
  fi

  TOTAL=$((TOTAL + ROWS))
  CURSOR="$LAST_ID"

  # Print progress every 10 batches
  if [ $((BATCH_NUM % 10)) -eq 0 ] || [ "$BATCH_NUM" -le 3 ]; then
    echo "Batch $BATCH_NUM: updated $ROWS rows (total: $TOTAL, cursor: ${CURSOR:0:8}...)"
  fi

  sleep 0.15
done

echo ""
echo "=== COMPLETE ==="
echo "Total batches: $BATCH_NUM"
echo "Total rows updated: $TOTAL"
