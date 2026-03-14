#!/bin/bash
# Batch recalculate data_quality_score for all active vehicles
# Uses the compute_vehicle_quality_score formula inline
# Each batch is its own transaction to avoid connection kills

set -euo pipefail

# Load env
eval "$(cd /Users/skylar/nuke && dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

SUPABASE_URL="${VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
BATCH_SIZE=3000
CURSOR="00000000-0000-0000-0000-000000000000"
TOTAL=0
BATCH_NUM=0

echo "Starting quality score recalculation..."
echo "Batch size: $BATCH_SIZE"

while true; do
  BATCH_NUM=$((BATCH_NUM + 1))

  RESULT=$(curl -s -X POST "${SUPABASE_URL}/rest/v1/rpc/recalc_quality_one_batch" \
    -H "apikey: ${SERVICE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"start_id\": \"${CURSOR}\", \"batch_size\": ${BATCH_SIZE}}")

  # Parse result
  LAST_ID=$(echo "$RESULT" | jq -r '.[0].last_id // empty' 2>/dev/null || echo "")
  ROWS=$(echo "$RESULT" | jq -r '.[0].rows_updated // 0' 2>/dev/null || echo "0")

  if [ -z "$LAST_ID" ] || [ "$LAST_ID" = "null" ]; then
    echo "Batch $BATCH_NUM: No more rows. Done!"
    break
  fi

  TOTAL=$((TOTAL + ROWS))
  CURSOR="$LAST_ID"

  echo "Batch $BATCH_NUM: updated $ROWS rows (total: $TOTAL, cursor: ${CURSOR:0:8}...)"

  # Small delay between batches
  sleep 0.2
done

echo ""
echo "=== COMPLETE ==="
echo "Total batches: $BATCH_NUM"
echo "Total rows updated: $TOTAL"
