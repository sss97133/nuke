#!/usr/bin/env bash
# Backfill missing BaT prices by calling extract-bat-core for each URL.
# Uses free direct HTTP fetch (no Firecrawl).
# Usage: dotenvx run -- bash scripts/backfill-bat-prices.sh
set -e

if [ -z "${VITE_SUPABASE_URL:-}" ]; then
  echo "Need VITE_SUPABASE_URL (use dotenvx run --)"; exit 1
fi

PSQL="psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -q -t -A"
export PGPASSWORD="$SUPABASE_DB_PASSWORD"

BATCH=50
CONCURRENCY=5
SLEEP=2
total_success=0
total_fail=0
round=0

echo "=== BaT Price Backfill ==="

while true; do
  round=$((round + 1))

  # Fetch a batch of URLs needing prices
  urls=$($PSQL -c "
    SELECT discovery_url FROM vehicles
    WHERE auction_source = 'bat'
      AND sale_price IS NULL
      AND status = 'active'
      AND discovery_url IS NOT NULL
      AND discovery_url LIKE '%bringatrailer.com/listing/%'
      AND (last_enrichment_attempt IS NULL OR last_enrichment_attempt < now() - interval '24 hours')
    ORDER BY created_at DESC
    LIMIT $BATCH
  ")

  if [ -z "$urls" ]; then
    echo "  No more candidates."
    break
  fi

  url_count=$(echo "$urls" | wc -l | tr -d ' ')
  batch_success=0
  batch_fail=0
  prices_found=0

  # Process in parallel groups
  while IFS= read -r url; do
    [ -z "$url" ] && continue

    # Fire off extract-bat-core
    result=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/extract-bat-core" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"url\": \"$url\"}" \
      --max-time 30 2>/dev/null)

    success=$(echo "$result" | jq -r '.success // .vehicle_id // "false"' 2>/dev/null)
    price=$(echo "$result" | jq -r '.sale_price // .extracted?.sale_price // empty' 2>/dev/null)

    if [ "$success" != "false" ] && [ "$success" != "null" ] && [ -n "$success" ]; then
      batch_success=$((batch_success + 1))
      [ -n "$price" ] && [ "$price" != "null" ] && prices_found=$((prices_found + 1))
    else
      batch_fail=$((batch_fail + 1))
    fi

    # Mark as attempted so we don't re-process
    $PSQL -c "UPDATE vehicles SET last_enrichment_attempt = now() WHERE discovery_url = '$url' AND sale_price IS NULL" >/dev/null 2>&1

  done <<< "$urls"

  total_success=$((total_success + batch_success))
  total_fail=$((total_fail + batch_fail))

  echo "  Round $round: $batch_success/$url_count success, $prices_found prices found (cumulative: $total_success success, $total_fail failed)"

  [ "$url_count" -lt "$BATCH" ] && break
  sleep "$SLEEP"
done

echo ""
echo "=== DONE: $total_success success, $total_fail failed ==="
