#!/bin/bash
#
# Autonomous Facebook Marketplace Processor
# Processes pending FB Marketplace listings with extract-facebook-marketplace
#

set -euo pipefail

cd "$(dirname "$0")/.."

export $(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

BATCH_SIZE="${1:-50}"
SUPABASE_URL="${VITE_SUPABASE_URL}"
SUPABASE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
FUNCTION_URL="${SUPABASE_URL}/functions/v1/extract-facebook-marketplace"

echo "🚀 Autonomous FB Marketplace Processor"
echo "======================================"
echo "Batch size: $BATCH_SIZE"
echo ""

# Get pending FB listings
echo "📋 Fetching pending FB Marketplace listings..."
PENDING=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
  -h aws-0-us-west-1.pooler.supabase.com \
  -p 6543 \
  -U postgres.qkgaybvrernstplzjaam \
  -d postgres \
  -t -A -F'|' \
  -c "
SELECT
  id,
  listing_url,
  attempts
FROM import_queue
WHERE status = 'pending'
  AND (listing_url LIKE '%facebook.com%' OR listing_url LIKE '%fbmarketplace%')
  AND attempts < max_attempts
ORDER BY priority DESC, created_at
LIMIT $BATCH_SIZE;
" 2>/dev/null)

if [ -z "$PENDING" ]; then
  echo "✅ No pending FB Marketplace listings found"
  exit 0
fi

TOTAL=$(echo "$PENDING" | wc -l | xargs)
echo "Found $TOTAL pending FB Marketplace listings"
echo ""

# Process each listing
processed=0
succeeded=0
failed=0

echo "$PENDING" | while IFS='|' read -r queue_id url attempts; do
  processed=$((processed + 1))
  echo ""
  echo "[$processed/$TOTAL] Processing: $url"
  echo "  Queue ID: $queue_id"
  echo "  Attempts: $attempts"

  # Call extract-facebook-marketplace
  start_time=$(date +%s)
  response=$(curl -sf -X POST "$FUNCTION_URL" \
    -H "Authorization: Bearer $SUPABASE_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"$url\",
      \"queue_id\": \"$queue_id\"
    }" 2>&1 || echo '{"success": false, "error": "Request failed"}')

  duration=$(($(date +%s) - start_time))

  success=$(echo "$response" | jq -r '.success // false' 2>/dev/null)

  if [ "$success" = "true" ]; then
    year=$(echo "$response" | jq -r '.data.year // "N/A"' 2>/dev/null)
    make=$(echo "$response" | jq -r '.data.make // "N/A"' 2>/dev/null)
    model=$(echo "$response" | jq -r '.data.model // "N/A"' 2>/dev/null)
    images=$(echo "$response" | jq -r '.data.image_urls | length // 0' 2>/dev/null)
    echo "  ✅ Success (${duration}s): $year $make $model - $images images"
    succeeded=$((succeeded + 1))
  else
    error=$(echo "$response" | jq -r '.error // "Unknown error"' 2>/dev/null | head -c 100)
    echo "  ❌ Failed (${duration}s): $error"
    failed=$((failed + 1))
  fi

  # Rate limit
  sleep 1
done

echo ""
echo "===================================="
echo "📊 Batch Complete"
echo "===================================="
echo "  Processed: $processed"
echo "  Succeeded: $succeeded"
echo "  Failed: $failed"
echo ""
