#!/bin/bash
# BAT 3-Hour Background Extractor (Full Quality)
# Uses bat-simple-extract - the most complete BaT extractor
# Extracts: VIN, specs, images, timeline events, comments, org links
#
# Usage: ./scripts/bat-3hr-extractor.sh [batch_size]
# Default batch_size: 5 (conservative for full extraction)

cd /Users/skylar/nuke

DURATION_SECONDS=$((3 * 60 * 60))  # 3 hours
BATCH_SIZE="${1:-5}"
LOG_FILE="logs/bat-3hr-extractor-$(date '+%Y%m%d-%H%M%S').log"
START_TIME=$(date +%s)

mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

processed=0
success=0
failed=0
duplicates=0

log "=== BAT 3-HOUR FULL EXTRACTOR STARTED ==="
log "Extractor: bat-simple-extract (full data quality)"
log "Duration: 3 hours | Batch size: $BATCH_SIZE"
log "Log: $LOG_FILE"

# Get initial queue count
QUEUE_COUNT=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=count" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Prefer: count=exact"' 2>/dev/null | jq -r '.[0].count // 0')
log "Queue has $QUEUE_COUNT pending BAT items"

while true; do
  # Check if 3 hours elapsed
  CURRENT_TIME=$(date +%s)
  ELAPSED=$((CURRENT_TIME - START_TIME))
  REMAINING=$((DURATION_SECONDS - ELAPSED))

  if [ $ELAPSED -ge $DURATION_SECONDS ]; then
    log "=== 3 HOURS COMPLETE ==="
    log "Total processed: $processed"
    log "Success: $success | Failed: $failed | Duplicates: $duplicates"
    RATE=$(echo "scale=1; $processed * 60 / $ELAPSED" | bc 2>/dev/null || echo "?")
    log "Average rate: $RATE per minute"
    exit 0
  fi

  # Progress update every 50 items
  if [ $((processed % 50)) -eq 0 ] && [ $processed -gt 0 ]; then
    HOURS_LEFT=$((REMAINING / 3600))
    MINS_LEFT=$(((REMAINING % 3600) / 60))
    RATE=$(echo "scale=1; $processed * 60 / $ELAPSED" | bc 2>/dev/null || echo "?")
    log "--- PROGRESS: $processed done ($success ok, $failed fail, $duplicates dup) | ${HOURS_LEFT}h ${MINS_LEFT}m left | ${RATE}/min ---"
  fi

  # Get batch of pending BAT items only
  BATCH=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url,listing_year,listing_make,listing_model&limit='"$BATCH_SIZE"'&order=priority.desc.nullslast,created_at.asc" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  COUNT=$(echo "$BATCH" | jq 'length' 2>/dev/null)

  if [[ "$COUNT" -eq 0 || "$COUNT" == "null" || -z "$COUNT" ]]; then
    log "Queue empty, waiting 60s..."
    sleep 60
    continue
  fi

  # Process each item
  echo "$BATCH" | jq -c '.[]' | while read -r item; do
    ID=$(echo "$item" | jq -r '.id')
    URL=$(echo "$item" | jq -r '.listing_url')
    YEAR=$(echo "$item" | jq -r '.listing_year // "?"')
    MAKE=$(echo "$item" | jq -r '.listing_make // "?"')
    MODEL=$(echo "$item" | jq -r '.listing_model // ""' | head -c 15)

    # Mark as processing
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"status\":\"processing\"}'" 2>/dev/null > /dev/null

    # Call bat-simple-extract (full quality extractor)
    # - Extracts VIN, specs, images, timeline events
    # - Triggers comment extraction
    # - Links to BaT organization
    RESULT=$(dotenvx run --quiet -- bash -c "curl -s -m 90 -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-simple-extract\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"url\":\"$URL\",\"save_to_db\":true}'" 2>/dev/null)

    VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // .vehicle_id // empty' 2>/dev/null)
    ERR=$(echo "$RESULT" | jq -r '.error // empty' 2>/dev/null)
    VIN=$(echo "$RESULT" | jq -r '.extracted.vin // empty' 2>/dev/null)
    IMGS=$(echo "$RESULT" | jq -r '.extracted.image_urls | length // 0' 2>/dev/null)

    if [[ -n "$VID" && "$VID" != "null" ]]; then
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}'" 2>/dev/null > /dev/null
      VIN_INFO=""
      [[ -n "$VIN" && "$VIN" != "null" ]] && VIN_INFO=" VIN:${VIN:0:8}..."
      log "OK: $YEAR $MAKE $MODEL | ${IMGS}imgs$VIN_INFO"
      ((success++))
    elif [[ "$ERR" == *"duplicate"* || "$ERR" == *"unique"* || "$ERR" == *"already exists"* ]]; then
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\":\"duplicate\"}'" 2>/dev/null > /dev/null
      log "DUP: $YEAR $MAKE $MODEL"
      ((duplicates++))
    else
      SHORT_ERR=$(echo "$ERR" | head -c 60 | tr -d '\n\r')
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\":\"failed\",\"error_message\":\"${SHORT_ERR//\"/\\\"}\"}'" 2>/dev/null > /dev/null
      log "FAIL: $YEAR $MAKE $MODEL - $SHORT_ERR"
      ((failed++))
    fi
    ((processed++))

    # Small delay between items to be nice to BaT
    sleep 1
  done

  # Brief pause between batches
  sleep 2
done
