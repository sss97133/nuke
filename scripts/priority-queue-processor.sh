#!/bin/bash
# PRIORITY QUEUE PROCESSOR
# Processes high-value sources first (BaT, Bonhams, C&B) with full extraction
# Then fast-inserts basic data for everything else

cd /Users/skylar/nuke
LOG_FILE="logs/priority-queue.log"
BATCH_SIZE=10

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

mkdir -p logs
log "=== PRIORITY QUEUE PROCESSOR STARTING ==="

# Reset stuck processing items
log "Resetting stuck processing items..."
dotenvx run --quiet -- bash -c 'curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.processing" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"status\": \"pending\", \"locked_at\": null, \"locked_by\": null}"' 2>/dev/null

process_bat() {
  log "Processing BaT items..."

  local batch=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=like.*bringatrailer.com*&select=id,listing_url&limit='"$BATCH_SIZE"'" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  local count=$(echo "$batch" | jq 'length' 2>/dev/null || echo "0")
  [[ "$count" -eq 0 ]] && return 1

  log "Found $count BaT items"

  echo "$batch" | jq -c '.[]' | while read -r item; do
    local id=$(echo "$item" | jq -r '.id')
    local url=$(echo "$item" | jq -r '.listing_url')

    # Mark processing
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"status\": \"processing\"}'" 2>/dev/null

    # Extract
    local result=$(dotenvx run --quiet -- bash -c "curl -s -m 60 -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-simple-extract\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"url\": \"$url\", \"save_to_db\": true}'" 2>/dev/null)

    local vehicle_id=$(echo "$result" | jq -r '.extracted.vehicle_id // empty' 2>/dev/null)

    if [[ -n "$vehicle_id" ]]; then
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"complete\", \"vehicle_id\": \"$vehicle_id\"}'" 2>/dev/null
      log "  ✓ BaT: $vehicle_id"
    else
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"failed\"}'" 2>/dev/null
      log "  ✗ BaT failed: $url"
    fi
  done

  return 0
}

process_basic() {
  log "Processing basic items (fast insert)..."

  # Get items with good data that aren't from sources with extractors
  local batch=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=not.like.*bringatrailer*&listing_url=not.like.*bonhams*&listing_url=not.like.*carsandbids*&select=id,listing_url,listing_title,listing_year,listing_make,listing_model,listing_price,thumbnail_url&limit='"$BATCH_SIZE"'" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  local count=$(echo "$batch" | jq 'length' 2>/dev/null || echo "0")
  [[ "$count" -eq 0 ]] && return 1

  log "Found $count basic items"

  echo "$batch" | jq -c '.[]' | while read -r item; do
    local id=$(echo "$item" | jq -r '.id')
    local url=$(echo "$item" | jq -r '.listing_url // empty')
    local title=$(echo "$item" | jq -r '.listing_title // empty')
    local year=$(echo "$item" | jq -r '.listing_year // empty')
    local make=$(echo "$item" | jq -r '.listing_make // empty')
    local model=$(echo "$item" | jq -r '.listing_model // empty')
    local price=$(echo "$item" | jq -r '.listing_price // 0')
    local domain=$(echo "$url" | awk -F'/' '{print $3}' 2>/dev/null)

    # Skip if missing essential data
    if [[ -z "$year" || -z "$title" ]]; then
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"skipped\"}'" 2>/dev/null
      continue
    fi

    # Insert vehicle
    local vehicle_result=$(dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/rest/v1/vehicles\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -H \"Prefer: return=representation\" \
      -d '{
        \"year\": $year,
        \"make\": \"$(echo "$make" | sed 's/"/\\"/g')\",
        \"model\": \"$(echo "$model" | sed 's/"/\\"/g')\",
        \"bat_listing_title\": \"$(echo "$title" | sed 's/"/\\"/g')\",
        \"sale_price\": $price,
        \"discovery_url\": \"$(echo "$url" | sed 's/"/\\"/g')\",
        \"discovery_source\": \"$domain\",
        \"listing_source\": \"queue_import\",
        \"profile_origin\": \"discovery\",
        \"is_public\": true,
        \"status\": \"active\"
      }'" 2>/dev/null)

    local vehicle_id=$(echo "$vehicle_result" | jq -r '.[0].id // .id // empty' 2>/dev/null)

    if [[ -n "$vehicle_id" ]]; then
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"complete\", \"vehicle_id\": \"$vehicle_id\"}'" 2>/dev/null
      log "  ✓ Basic: $year $make $model"
    else
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$id\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\": \"failed\"}'" 2>/dev/null
      log "  ✗ Basic failed"
    fi
  done

  return 0
}

# Main loop - prioritize BaT, then basic
loop_count=0
while true; do
  loop_count=$((loop_count + 1))
  log "=== Loop #$loop_count ==="

  # Try BaT first (highest value)
  if process_bat; then
    sleep 1
    continue
  fi

  # Then basic items (fast inserts)
  if process_basic; then
    sleep 1
    continue
  fi

  # Nothing to process
  log "Queue empty, sleeping 60s..."
  sleep 60
done
