#!/bin/bash
# FAST QUEUE WORKER - Parallel processing with smart routing
# Processes import_queue items based on source domain

cd /Users/skylar/nuke
LOG_FILE="logs/fast-queue-worker.log"
BATCH_SIZE=20
PARALLEL_WORKERS=5

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

mkdir -p logs
log "=== FAST QUEUE WORKER STARTING ==="
log "Batch size: $BATCH_SIZE, Workers: $PARALLEL_WORKERS"

process_batch() {
  # Fetch a batch of pending items
  local batch=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&select=id,listing_url,listing_title,listing_year,listing_make,listing_model,listing_price,thumbnail_url&limit='"$BATCH_SIZE"'&order=priority.desc,created_at.asc" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  local count=$(echo "$batch" | jq 'length' 2>/dev/null || echo "0")

  if [[ "$count" -eq 0 || "$count" == "null" ]]; then
    log "No pending items"
    return 1
  fi

  log "Processing batch of $count items..."

  # Process each item
  echo "$batch" | jq -c '.[]' | while read -r item; do
    local id=$(echo "$item" | jq -r '.id')
    local url=$(echo "$item" | jq -r '.listing_url')
    local domain=$(echo "$url" | awk -F'/' '{print $3}' | sed 's/:80$//')

    # Lock the item
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"status\": \"processing\", \"locked_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}'" 2>/dev/null

    local success=false
    local vehicle_id=""

    case "$domain" in
      bringatrailer.com|www.bringatrailer.com)
        # Use BaT extractor
        local result=$(dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-simple-extract\" \
          -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
          -H \"Content-Type: application/json\" \
          -d '{\"url\": \"$url\", \"save_to_db\": true}'" 2>/dev/null)
        vehicle_id=$(echo "$result" | jq -r '.extracted.vehicle_id // empty')
        [[ -n "$vehicle_id" ]] && success=true
        ;;

      www.bonhams.com)
        # Use Bonhams extractor
        local result=$(dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-bonhams\" \
          -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
          -H \"Content-Type: application/json\" \
          -d '{\"url\": \"$url\"}'" 2>/dev/null)
        vehicle_id=$(echo "$result" | jq -r '.vehicle_id // empty')
        [[ -n "$vehicle_id" ]] && success=true
        ;;

      carsandbids.com|www.carsandbids.com)
        # Use C&B extractor
        local result=$(dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-cars-and-bids-core\" \
          -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
          -H \"Content-Type: application/json\" \
          -d '{\"url\": \"$url\"}'" 2>/dev/null)
        vehicle_id=$(echo "$result" | jq -r '.vehicle_id // empty')
        [[ -n "$vehicle_id" ]] && success=true
        ;;

      *)
        # Create basic vehicle from queue data (fast path)
        local title=$(echo "$item" | jq -r '.listing_title // empty')
        local year=$(echo "$item" | jq -r '.listing_year // empty')
        local make=$(echo "$item" | jq -r '.listing_make // empty')
        local model=$(echo "$item" | jq -r '.listing_model // empty')
        local price=$(echo "$item" | jq -r '.listing_price // 0')
        local thumb=$(echo "$item" | jq -r '.thumbnail_url // empty')

        if [[ -n "$title" && -n "$year" ]]; then
          # Insert basic vehicle record
          local insert_result=$(dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/rest/v1/vehicles\" \
            -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
            -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
            -H \"Content-Type: application/json\" \
            -H \"Prefer: return=representation\" \
            -d '{
              \"year\": $year,
              \"make\": \"$make\",
              \"model\": \"$model\",
              \"bat_listing_title\": \"$title\",
              \"sale_price\": $price,
              \"discovery_url\": \"$url\",
              \"discovery_source\": \"$domain\",
              \"listing_source\": \"queue_import\",
              \"profile_origin\": \"discovery\",
              \"is_public\": true,
              \"status\": \"active\"
            }'" 2>/dev/null)
          vehicle_id=$(echo "$insert_result" | jq -r '.[0].id // .id // empty')
          [[ -n "$vehicle_id" ]] && success=true

          # Add thumbnail if available
          if [[ -n "$vehicle_id" && -n "$thumb" ]]; then
            dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/rest/v1/vehicle_images\" \
              -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
              -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
              -H \"Content-Type: application/json\" \
              -d '{\"vehicle_id\": \"$vehicle_id\", \"image_url\": \"$thumb\", \"position\": 0, \"source\": \"queue_import\", \"is_external\": true}'" 2>/dev/null
          fi
        fi
        ;;
    esac

    # Update queue status
    if [[ "$success" == true ]]; then
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"complete\", \"vehicle_id\": \"$vehicle_id\", \"processed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}'" 2>/dev/null
      log "  ✓ $domain -> $vehicle_id"
    else
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"error\", \"error_message\": \"Extraction failed\", \"attempts\": 1}'" 2>/dev/null
      log "  ✗ $domain failed"
    fi
  done

  return 0
}

# Main loop
loop_count=0
while true; do
  loop_count=$((loop_count + 1))
  log "=== Batch #$loop_count ==="

  if ! process_batch; then
    log "Queue empty or error, sleeping 30s..."
    sleep 30
  else
    sleep 2  # Brief pause between batches
  fi

  # Stats every 10 batches
  if [[ $((loop_count % 10)) -eq 0 ]]; then
    pending=$(dotenvx run --quiet -- bash -c 'curl -s -I "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&select=id" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Prefer: count=exact"' 2>/dev/null | grep -i content-range | grep -oE '[0-9]+$')
    log "=== STATS: $pending pending ==="
  fi
done
