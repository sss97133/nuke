#!/bin/bash
# Continuous BaT extraction loop
# Usage: ./scripts/extract-loop.sh [batch_size] [batches]

cd /Users/skylar/nuke
BATCH_SIZE=${1:-50}
BATCHES=${2:-20}

echo "Starting extraction loop: $BATCHES batches of $BATCH_SIZE"

total_success=0
total_fail=0

for batch in $(seq 1 $BATCHES); do
  urls=$(dotenvx run -- bash -c '
    PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "
    SELECT listing_url FROM import_queue 
    WHERE status = '\''pending'\'' 
    AND listing_url LIKE '\''%bringatrailer%'\''
    AND attempts < 3
    ORDER BY RANDOM()
    LIMIT '"$BATCH_SIZE"';
    "' 2>/dev/null | grep "http" | tr -d " ")
  
  if [ -z "$urls" ]; then
    echo "No more pending items"
    break
  fi
  
  success=0
  fail=0
  
  for url in $urls; do
    result=$(dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/complete-bat-import\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"url\": \"$url\"}' --max-time 45" 2>/dev/null)
    
    if echo "$result" | grep -q '"success":true'; then
      success=$((success + 1))
      dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c \"UPDATE import_queue SET status='complete', processed_at=NOW() WHERE listing_url='$url';\"" 2>/dev/null >/dev/null
    else
      fail=$((fail + 1))
      dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c \"UPDATE import_queue SET attempts=attempts+1 WHERE listing_url='$url';\"" 2>/dev/null >/dev/null
    fi
  done
  
  total_success=$((total_success + success))
  total_fail=$((total_fail + fail))
  pct=$((success * 100 / (success + fail)))
  
  echo "[Batch $batch/$BATCHES] +$success vehicles ($pct%) | Total: $total_success success, $total_fail failed"
done

echo ""
echo "=== EXTRACTION LOOP COMPLETE ==="
echo "Total Success: $total_success"
echo "Total Failed: $total_fail"
echo "Success Rate: $((total_success * 100 / (total_success + total_fail)))%"
