#!/bin/bash
# Populate vehicle_search_index in batches
# Each batch is an independent INSERT within 120s timeout

set -e
cd /Users/skylar/nuke

CONN="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
BATCH=500
TOTAL=0
ROUND=0

echo "=== Phase 1: Vehicle fields ==="
while true; do
  ROUND=$((ROUND + 1))
  RESULT=$(dotenvx run -- psql "$CONN" -t -A -c "
    SET statement_timeout = '60s';
    WITH batch AS (
      SELECT id FROM vehicles v
      WHERE v.is_public = true AND v.make IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM vehicle_search_index s WHERE s.vehicle_id = v.id)
      LIMIT $BATCH
    )
    INSERT INTO vehicle_search_index (vehicle_id, vehicle_text, description_text, make, year)
    SELECT
      v.id,
      concat_ws(' ', v.year::text, v.make, v.model, v.vin, v.color, v.trim, v.transmission),
      left(coalesce(v.description, ''), 5000),
      v.make,
      v.year::smallint
    FROM vehicles v
    JOIN batch b ON b.id = v.id
    ON CONFLICT (vehicle_id) DO NOTHING;
  " 2>&1)

  # Check for INSERT count
  COUNT=$(echo "$RESULT" | grep -o 'INSERT [0-9]* [0-9]*' | awk '{print $3}' || echo "0")
  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    echo "Phase 1 done. Total vehicles: $TOTAL"
    break
  fi
  TOTAL=$((TOTAL + COUNT))
  echo "  Batch $ROUND: +$COUNT (total: $TOTAL)"
  sleep 0.1
done

echo ""
echo "=== Phase 2: Comment aggregation ==="
ROUND=0
COMMENT_TOTAL=0
while true; do
  ROUND=$((ROUND + 1))
  RESULT=$(dotenvx run -- psql "$CONN" -t -A -c "
    SET statement_timeout = '90s';
    WITH vehicles_needing_comments AS (
      SELECT vehicle_id FROM vehicle_search_index
      WHERE comment_text = '' AND has_comments = false
      LIMIT $BATCH
    ),
    comment_agg AS (
      SELECT
        c.vehicle_id,
        string_agg(left(c.comment_text, 500), ' ' ORDER BY c.comment_likes DESC NULLS LAST, c.expertise_score DESC NULLS LAST) as agg_text,
        count(*) as cnt
      FROM auction_comments c
      JOIN vehicles_needing_comments v ON v.vehicle_id = c.vehicle_id
      WHERE c.word_count >= 15 OR c.is_seller = true
      GROUP BY c.vehicle_id
    )
    UPDATE vehicle_search_index si SET
      comment_text = left(ca.agg_text, 10000),
      has_comments = true,
      comment_count = ca.cnt
    FROM comment_agg ca
    WHERE si.vehicle_id = ca.vehicle_id;
  " 2>&1)

  COUNT=$(echo "$RESULT" | grep -o 'UPDATE [0-9]*' | awk '{print $2}' || echo "0")

  # Also mark vehicles with no comments
  dotenvx run -- psql "$CONN" -t -A -c "
    SET statement_timeout = '30s';
    UPDATE vehicle_search_index SET has_comments = true
    WHERE has_comments = false
      AND vehicle_id NOT IN (SELECT DISTINCT vehicle_id FROM auction_comments WHERE vehicle_id IS NOT NULL LIMIT 10000)
    LIMIT $BATCH;
  " 2>&1 > /dev/null || true

  if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
    echo "Phase 2 done. Vehicles with comments: $COMMENT_TOTAL"
    break
  fi
  COMMENT_TOTAL=$((COMMENT_TOTAL + COUNT))
  echo "  Batch $ROUND: +$COUNT (total: $COMMENT_TOTAL)"
  sleep 0.1
done

echo ""
echo "=== Summary ==="
dotenvx run -- psql "$CONN" -c "
  SELECT
    count(*) as total_rows,
    count(*) FILTER (WHERE has_comments) as with_comments,
    count(*) FILTER (WHERE comment_text != '') as with_comment_text,
    pg_size_pretty(pg_total_relation_size('vehicle_search_index')) as total_size
  FROM vehicle_search_index;
"
