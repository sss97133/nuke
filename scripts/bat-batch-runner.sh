#!/bin/bash
# BAT Batch Runner - Small batches with quality inspection
# - Processes in batches of 50
# - Pauses between batches for inspection
# - Deduplicates URLs (skips already-extracted)
# - Handles re-sales: same VIN at different auctions = new auction_event (fun!)
#
# Usage: ./scripts/bat-batch-runner.sh [batch_size]

cd /Users/skylar/nuke

BATCH_SIZE="${1:-50}"
BATCH_NUM=0
LOG_FILE="logs/bat-batch-$(date '+%Y%m%d-%H%M%S').log"

mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG_FILE"; }

run_batch() {
  BATCH_NUM=$((BATCH_NUM + 1))
  log "=== BATCH $BATCH_NUM (size: $BATCH_SIZE) ==="

  local success=0
  local failed=0
  local skipped=0
  local resales=0

  # Get batch - order by created_at to process oldest first
  ITEMS=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url&limit='"$BATCH_SIZE"'&order=created_at.asc" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  COUNT=$(echo "$ITEMS" | jq 'length' 2>/dev/null)

  if [[ "$COUNT" -eq 0 || "$COUNT" == "null" || -z "$COUNT" ]]; then
    log "No pending items!"
    return 1
  fi

  log "Processing $COUNT items..."

  echo "$ITEMS" | jq -c '.[]' | while read -r item; do
    ID=$(echo "$item" | jq -r '.id')
    URL=$(echo "$item" | jq -r '.listing_url')

    # Check if URL already extracted (dedup)
    EXISTING=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?or=(bat_auction_url.eq.'"$URL"',discovery_url.eq.'"$URL"')&select=id,vin&limit=1" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

    EXISTING_ID=$(echo "$EXISTING" | jq -r '.[0].id // empty')

    if [[ -n "$EXISTING_ID" ]]; then
      # Mark as duplicate in queue
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\":\"duplicate\",\"vehicle_id\":\"$EXISTING_ID\"}'" 2>/dev/null > /dev/null
      log "SKIP: Already exists as $EXISTING_ID"
      continue
    fi

    # Mark processing
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"status\":\"processing\"}'" 2>/dev/null > /dev/null

    # Extract
    RESULT=$(dotenvx run --quiet -- bash -c "curl -s -m 90 -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-simple-extract\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" \
      -d '{\"url\":\"$URL\",\"save_to_db\":true}'" 2>/dev/null)

    VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // empty')
    VIN=$(echo "$RESULT" | jq -r '.extracted.vin // empty')
    YEAR=$(echo "$RESULT" | jq -r '.extracted.year // "?"')
    MAKE=$(echo "$RESULT" | jq -r '.extracted.make // "?"')
    PRICE=$(echo "$RESULT" | jq -r '.extracted.sale_price // 0')
    IMGS=$(echo "$RESULT" | jq -r '.extracted.image_urls | length // 0')
    ERR=$(echo "$RESULT" | jq -r '.error // empty')

    if [[ -n "$VID" && "$VID" != "null" ]]; then
      # Check if this VIN was sold before (re-sale detection)
      if [[ -n "$VIN" && "$VIN" != "null" && ${#VIN} -ge 6 ]]; then
        PREV_SALES=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?vin=eq.'"$VIN"'&id=neq.'"$VID"'&select=id,year,sale_price&limit=5" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
          -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)
        PREV_COUNT=$(echo "$PREV_SALES" | jq 'length' 2>/dev/null)

        if [[ "$PREV_COUNT" -gt 0 && "$PREV_COUNT" != "null" ]]; then
          log "RESALE: $YEAR $MAKE - VIN $VIN sold $((PREV_COUNT + 1)) times! \$${PRICE:-?}"
        else
          log "OK: $YEAR $MAKE | \$${PRICE:-?} | ${IMGS}imgs | VIN:${VIN:0:8}..."
        fi
      else
        log "OK: $YEAR $MAKE | \$${PRICE:-?} | ${IMGS}imgs"
      fi

      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}'" 2>/dev/null > /dev/null
    else
      SHORT_ERR=$(echo "$ERR" | head -c 50 | tr -d '\n\r')
      log "FAIL: $SHORT_ERR"
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
        -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
        -H \"Content-Type: application/json\" \
        -d '{\"status\":\"failed\"}'" 2>/dev/null > /dev/null
    fi

    sleep 1
  done

  return 0
}

show_stats() {
  log ""
  log "=== BATCH $BATCH_NUM COMPLETE - QUEUE STATUS ==="

  STATS=$(dotenvx run --quiet -- bash -c '
    for s in pending complete failed duplicate; do
      COUNT=$(curl -sI "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.'$s'&listing_url=ilike.*bringatrailer*&select=id" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Prefer: count=exact" 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r\n")
      echo "'$s': $COUNT"
    done
  ' 2>/dev/null)

  echo "$STATS" | while read line; do log "$line"; done
  log ""
}

# Main loop
while true; do
  run_batch
  RESULT=$?

  show_stats

  if [[ $RESULT -ne 0 ]]; then
    log "Queue empty. Done!"
    exit 0
  fi

  log ">>> Press ENTER to run next batch, or Ctrl+C to stop <<<"
  read -r
done
