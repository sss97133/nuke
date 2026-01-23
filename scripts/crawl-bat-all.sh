#!/bin/bash
# Crawl and extract all BaT auctions
# Run with: dotenvx run -- ./scripts/crawl-bat-all.sh

set -e

echo "🚀 Starting BaT full crawl..."
START_TIME=$(date +%s)

# Step 1: Discover all URLs
echo "📡 Discovering active auctions..."
DISCOVERY=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/crawl-bat-active" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"extract": false}')

TOTAL_URLS=$(echo "$DISCOVERY" | jq -r '.discovered.total_unique')
echo "✅ Found $TOTAL_URLS active auctions"

# Step 2: Get the URLs list
echo "📋 Fetching URL list..."
URLS=$(for page in $(seq 1 30); do
  curl -s "https://bringatrailer.com/auctions/feed/?paged=$page" -A "Mozilla/5.0" 2>/dev/null | \
    grep -oE '<link>https://bringatrailer.com/listing/[^<]+' | sed 's/<link>//'
  sleep 0.2
done | sort -u)

URL_COUNT=$(echo "$URLS" | wc -l | tr -d ' ')
echo "✅ Got $URL_COUNT unique URLs"

# Step 3: Extract in parallel batches
echo "🔄 Starting extraction..."
EXTRACTED=0
FAILED=0
BATCH_SIZE=20
PARALLEL_JOBS=5

# Save URLs to temp file
TEMP_FILE=$(mktemp)
echo "$URLS" > "$TEMP_FILE"

extract_url() {
  local url=$1
  local result=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\": \"$url\", \"save_to_db\": true}" \
    --max-time 60 2>/dev/null)

  if echo "$result" | jq -e '.success' > /dev/null 2>&1; then
    echo "✓ $(echo "$result" | jq -r '.extracted.title // "Unknown"')"
    return 0
  else
    echo "✗ $url - $(echo "$result" | jq -r '.error // "Unknown error"')"
    return 1
  fi
}

export -f extract_url
export VITE_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

# Use xargs for parallel execution
cat "$TEMP_FILE" | xargs -P $PARALLEL_JOBS -I {} bash -c 'extract_url "{}"' 2>&1 | \
  while read line; do
    echo "$line"
    if [[ "$line" == "✓"* ]]; then
      ((EXTRACTED++)) || true
    else
      ((FAILED++)) || true
    fi
  done

rm "$TEMP_FILE"

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "🏁 Crawl complete!"
echo "   Duration: ${DURATION}s"
echo "   URLs found: $URL_COUNT"
echo ""
echo "Check database for results:"
echo "  dotenvx run -- bash -c 'curl -s \"\$VITE_SUPABASE_URL/rest/v1/external_listings?platform=eq.bat&select=listing_status\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" | jq \"group_by(.listing_status) | map({status: .[0].listing_status, count: length})\"'"
