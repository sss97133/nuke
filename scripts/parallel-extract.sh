#!/bin/bash
# Parallel BaT extraction with configurable workers
# Usage: ./scripts/parallel-extract.sh [workers] [items_per_worker] [batches]

cd /Users/skylar/nuke
WORKERS=${1:-10}
ITEMS=${2:-20}
BATCHES=${3:-10}

echo "Starting parallel extraction: $WORKERS workers × $ITEMS items × $BATCHES batches"
echo "Total target: $((WORKERS * ITEMS * BATCHES)) items"
echo ""

total_success=0
total_fail=0

for batch in $(seq 1 $BATCHES); do
  batch_start=$(date +%s)

  for w in $(seq 1 $WORKERS); do
    (
      success=0
      fail=0
      for i in $(seq 1 $ITEMS); do
        url=$(dotenvx run -- bash -c '
          PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
          UPDATE import_queue SET status='\''processing'\'', locked_at=NOW(), locked_by='\''parallel-w'$w''\''
          WHERE id = (
            SELECT id FROM import_queue
            WHERE status = '\''pending'\'' AND attempts < 3 AND listing_url LIKE '\''%bringatrailer%'\''
            ORDER BY RANDOM() LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          RETURNING listing_url;
          "' 2>/dev/null | grep "http" | tr -d " ")

        if [ -z "$url" ]; then
          continue
        fi

        result=$(dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/complete-bat-import\" \
          -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
          -H \"Content-Type: application/json\" \
          -d '{\"url\": \"$url\"}' --max-time 60" 2>/dev/null)

        if echo "$result" | grep -q '"success":true'; then
          success=$((success + 1))
          dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c \"UPDATE import_queue SET status='complete', processed_at=NOW() WHERE listing_url='$url';\"" 2>/dev/null >/dev/null
        else
          fail=$((fail + 1))
          dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c \"UPDATE import_queue SET status='failed', attempts=attempts+1 WHERE listing_url='$url';\"" 2>/dev/null >/dev/null
        fi
      done
      echo "$success $fail"
    ) &
  done

  # Collect results
  results=$(wait)
  batch_end=$(date +%s)
  batch_time=$((batch_end - batch_start))

  # Get current stats
  stats=$(dotenvx run -- bash -c '
    PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
    SELECT
      (SELECT COUNT(*) FROM vehicles) || '\'' vehicles, '\'' ||
      (SELECT COUNT(*) FROM import_queue WHERE status = '\''pending'\'' AND attempts < 3) || '\'' pending'\'';
    "' 2>/dev/null | tr -d ' ')

  echo "[Batch $batch/$BATCHES] ${batch_time}s | $stats"
done

echo ""
echo "=== PARALLEL EXTRACTION COMPLETE ==="
