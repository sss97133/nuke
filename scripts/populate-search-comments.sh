#!/bin/bash
# Phase 2: Aggregate comments into vehicle_search_index
# Strategy: Get distinct vehicle_ids from comments, batch-aggregate, update
set -e
cd /Users/skylar/nuke

CONN="postgresql://postgres.qkgaybvrernstplzjaam:RbzKq32A0uhqvJMQ@aws-0-us-west-1.pooler.supabase.com:6543/postgres"
BATCH=50
TOTAL=0
ROUND=0
OFFSET=0

echo "=== Aggregating comments into search index ==="
while true; do
  ROUND=$((ROUND + 1))

  # Get a batch of vehicle_ids that have comments and aren't processed yet
  RESULT=$(dotenvx run -- psql "$CONN" -t -A -c "
    SET statement_timeout = '90s';
    WITH vehicle_batch AS (
      SELECT DISTINCT c.vehicle_id
      FROM auction_comments c
      INNER JOIN vehicle_search_index si ON si.vehicle_id = c.vehicle_id AND si.has_comments = false
      WHERE c.vehicle_id IS NOT NULL
      LIMIT $BATCH
    ),
    comment_agg AS (
      SELECT
        c.vehicle_id,
        string_agg(
          left(c.comment_text, 400),
          ' | '
          ORDER BY
            CASE WHEN c.is_seller THEN 0 ELSE 1 END,
            coalesce(c.comment_likes, 0) DESC
        ) as agg_text,
        count(*) as cnt
      FROM auction_comments c
      INNER JOIN vehicle_batch vb ON vb.vehicle_id = c.vehicle_id
      WHERE c.word_count >= 15 OR c.is_seller = true
      GROUP BY c.vehicle_id
    )
    UPDATE vehicle_search_index si SET
      comment_text = left(ca.agg_text, 8000),
      has_comments = true,
      comment_count = ca.cnt
    FROM comment_agg ca
    WHERE si.vehicle_id = ca.vehicle_id;
  " 2>&1)

  COUNT=$(echo "$RESULT" | grep -o 'UPDATE [0-9]*' | awk '{print $2}')
  COUNT=${COUNT:-0}

  if [ "$COUNT" = "0" ]; then
    echo "No more vehicles with comments to process."
    break
  fi

  TOTAL=$((TOTAL + COUNT))
  echo "  Batch $ROUND: +$COUNT (total: $TOTAL)"

  if [ "$ROUND" -gt 20000 ]; then
    echo "Safety limit reached"
    break
  fi

  sleep 0.1
done

# Mark remaining vehicles as processed (no comments found)
echo ""
echo "Marking remaining vehicles as has_comments=true (no comments)..."
MARKED=0
while true; do
  RESULT=$(dotenvx run -- psql "$CONN" -t -A -c "
    SET statement_timeout = '60s';
    WITH to_mark AS (
      SELECT vehicle_id FROM vehicle_search_index
      WHERE has_comments = false
      LIMIT 5000
    )
    UPDATE vehicle_search_index si SET has_comments = true
    FROM to_mark tm WHERE si.vehicle_id = tm.vehicle_id;
  " 2>&1)

  COUNT=$(echo "$RESULT" | grep -o 'UPDATE [0-9]*' | awk '{print $2}')
  COUNT=${COUNT:-0}

  if [ "$COUNT" = "0" ]; then break; fi
  MARKED=$((MARKED + COUNT))
  echo "  Marked $MARKED vehicles as no-comments"
  sleep 0.05
done

echo ""
echo "=== Summary ==="
dotenvx run -- psql "$CONN" -c "
  SELECT
    count(*) as total_rows,
    count(*) FILTER (WHERE comment_text != '') as with_comment_text,
    count(*) FILTER (WHERE comment_count > 0) as with_comments,
    coalesce(sum(comment_count), 0) as total_comments_indexed,
    pg_size_pretty(pg_total_relation_size('vehicle_search_index')) as total_size
  FROM vehicle_search_index;
"
