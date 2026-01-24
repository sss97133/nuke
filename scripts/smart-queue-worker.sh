#!/bin/bash
# Smart queue worker with URL dedup and proper routing
# Uses correct extractors for each platform

set -e
cd /Users/skylar/nuke

# Load env vars
eval "$(dotenvx run -- printenv | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

WORKER_ID="${1:-1}"
BATCH_SIZE="${2:-5}"
LOG_FILE="/Users/skylar/nuke/logs/smart-worker-${WORKER_ID}.log"
mkdir -p /Users/skylar/nuke/logs

log() {
  echo "[$(date '+%H:%M:%S')] [W$WORKER_ID] $1" | tee -a "$LOG_FILE"
}

process_item() {
  local item_id="$1"
  local url="$2"
  local platform="$3"
  local raw_data="${4:-{}}"

  # Check if URL already exists in vehicles table (dedup)
  local encoded_url=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$url', safe=''))" 2>/dev/null || echo "$url")
  local existing=$(curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?or=(discovery_url.eq.$encoded_url,listing_url.eq.$encoded_url)&select=id&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null)

  if echo "$existing" | jq -e '.[0].id' > /dev/null 2>&1; then
    log "SKIP: $url (already exists)"
    # Mark as duplicate
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$item_id" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"status": "duplicate"}' > /dev/null
    return 0
  fi

  # Route to correct extractor based on platform
  local endpoint=""
  local payload=""

  case "$platform" in
    classic.com)
      # Classic.com is an aggregator - record sighting, don't create profile
      endpoint="process-classic-com-sighting"
      payload="{\"url\": \"$url\", \"raw_data\": $raw_data}"
      ;;
    bringatrailer.com|bringatrailer)
      endpoint="bat-simple-extract"
      payload="{\"url\": \"$url\", \"save_to_db\": true}"
      ;;
    carsandbids.com|carsandbids)
      endpoint="extract-cars-and-bids-core"
      payload="{\"url\": \"$url\"}"
      ;;
    pcarmarket.com|pcarmarket)
      endpoint="import-pcarmarket-listing"
      payload="{\"listing_url\": \"$url\"}"
      ;;
    rmsothebys.com|rmsothebys)
      endpoint="extract-rm-sothebys"
      payload="{\"url\": \"$url\"}"
      ;;
    bonhams.com|bonhams)
      endpoint="extract-vehicle-data-ai"
      payload="{\"url\": \"$url\"}"
      ;;
    mecum.com|mecum)
      endpoint="extract-vehicle-data-ai"
      payload="{\"url\": \"$url\"}"
      ;;
    barrett-jackson.com)
      endpoint="extract-vehicle-data-ai"
      payload="{\"url\": \"$url\"}"
      ;;
    *)
      # Generic extraction via firecrawl + AI
      endpoint="extract-vehicle-data-ai"
      payload="{\"url\": \"$url\"}"
      ;;
  esac

  log "EXTRACT: $platform -> $endpoint"

  # Call extractor
  local result=$(curl -s -X POST "$VITE_SUPABASE_URL/functions/v1/$endpoint" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d "$payload" --max-time 120 2>/dev/null)

  # Check result
  if echo "$result" | jq -e '.success == true or .vehicle_id != null' > /dev/null 2>&1; then
    local vid=$(echo "$result" | jq -r '.vehicle_id // .extracted.vehicle_id // "unknown"')
    log "OK: $vid"
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$item_id" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"status": "complete"}' > /dev/null
  else
    local err=$(echo "$result" | jq -r '.error // "Unknown error"' | head -c 100)
    log "FAIL: $err"
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$item_id" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"status\": \"failed\", \"error_message\": \"$err\"}" > /dev/null
  fi
}

log "Starting smart queue worker (batch=$BATCH_SIZE)"

processed=0
while true; do
  # Get batch of pending items
  items=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&select=id,listing_url,raw_data&limit=$BATCH_SIZE&order=created_at" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null)

  count=$(echo "$items" | jq -r 'length')

  if [ "$count" = "0" ] || [ -z "$count" ]; then
    log "Queue empty, waiting..."
    sleep 30
    continue
  fi

  # Process each item
  for i in $(seq 0 $((count - 1))); do
    item_id=$(echo "$items" | jq -r ".[$i].id")
    url=$(echo "$items" | jq -r ".[$i].listing_url")
    raw_data=$(echo "$items" | jq -c ".[$i].raw_data // {}")
    # Extract source/platform from URL
    source=$(echo "$url" | sed -E 's|https?://([^/]+).*|\1|' | sed 's/www\.//')

    # Mark as processing
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$item_id" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"status": "processing"}' > /dev/null

    process_item "$item_id" "$url" "$source" "$raw_data"
    processed=$((processed + 1))
  done

  log "Processed batch ($processed total)"
done
