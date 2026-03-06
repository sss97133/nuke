#!/usr/bin/env bash
# Process all RM Sotheby's auctions in batches.
# Usage: dotenvx run -- bash scripts/backfill-rmsothebys.sh
set -e

if [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo "Need VITE_SUPABASE_URL (use dotenvx run --)"; exit 1
fi

BATCH=40
SLEEP=1
AUCTIONS=(PA26 AZ26 CC26 MI26 S0226 PA25 AZ25 MO25 MI25 MT25 PA24 AZ24 MO24 MT24)

for AUCTION in "${AUCTIONS[@]}"; do
  echo ""
  echo "=== Processing: $AUCTION ==="
  offset=0
  total_created=0
  total_updated=0
  total_errors=0

  while true; do
    result=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/extract-rmsothebys" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"action\": \"process\", \"auction\": \"$AUCTION\", \"save_to_db\": true, \"limit\": $BATCH, \"offset\": $offset}" \
      --max-time 120 2>/dev/null)

    if [ -z "$result" ]; then
      echo "  ERROR: empty response at offset=$offset"
      break
    fi

    success=$(echo "$result" | jq -r '.success // false')
    if [ "$success" != "true" ]; then
      echo "  ERROR: $(echo "$result" | jq -r '.error // "unknown"')"
      break
    fi

    processed=$(echo "$result" | jq -r '.processed // 0')
    created=$(echo "$result" | jq -r '.created // 0')
    updated=$(echo "$result" | jq -r '.updated // 0')
    errors=$(echo "$result" | jq -r '.errors // 0')
    total_lots=$(echo "$result" | jq -r '.total_lots // 0')

    total_created=$((total_created + created))
    total_updated=$((total_updated + updated))
    total_errors=$((total_errors + errors))

    echo "  Batch offset=$offset: +${created} created, ${updated} updated, ${errors} errors (${total_lots} total lots)"

    offset=$((offset + BATCH))
    if [ "$processed" -lt "$BATCH" ] || [ "$offset" -ge "$total_lots" ]; then
      break
    fi
    sleep "$SLEEP"
  done

  echo "  DONE $AUCTION: ${total_created} created, ${total_updated} updated, ${total_errors} errors"
done

echo ""
echo "=== ALL AUCTIONS COMPLETE ==="
