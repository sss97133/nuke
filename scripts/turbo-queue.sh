#!/bin/bash
# TURBO QUEUE - Maximum throughput, smart duplicate handling
cd /Users/skylar/nuke

LOG="logs/turbo-queue.log"
mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

log "=== TURBO QUEUE START ==="

# Process loop
while true; do
  # Get batch of pending items (prefer BaT)
  BATCH=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&select=id,listing_url,listing_title,listing_year,listing_make,listing_model,listing_price&limit=20&order=priority.desc" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  COUNT=$(echo "$BATCH" | jq 'length' 2>/dev/null)
  [[ "$COUNT" -eq 0 || "$COUNT" == "null" ]] && { log "Empty, sleep 30s"; sleep 30; continue; }

  log "Processing $COUNT items..."

  echo "$BATCH" | jq -c '.[]' | while read -r item; do
    ID=$(echo "$item" | jq -r '.id')
    URL=$(echo "$item" | jq -r '.listing_url // empty')
    YEAR=$(echo "$item" | jq -r '.listing_year // empty')
    MAKE=$(echo "$item" | jq -r '.listing_make // empty')

    # Skip bad URLs
    [[ -z "$URL" || "$URL" == "null" ]] && {
      dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"skipped\"}'" 2>/dev/null
      continue
    }

    # Route by domain
    if [[ "$URL" == *"bringatrailer.com"* ]]; then
      RESULT=$(dotenvx run --quiet -- bash -c "curl -s -m 45 -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-simple-extract\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"url\":\"$URL\",\"save_to_db\":true}'" 2>/dev/null)
      VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // empty' 2>/dev/null)
      ERR=$(echo "$RESULT" | jq -r '.error // empty' 2>/dev/null)

      if [[ -n "$VID" ]]; then
        dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}'" 2>/dev/null
        log "✓ BaT $YEAR $MAKE"
      elif [[ "$ERR" == *"duplicate"* || "$ERR" == *"unique"* ]]; then
        dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"duplicate\"}'" 2>/dev/null
        log "= DUP $YEAR $MAKE"
      else
        dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"failed\"}'" 2>/dev/null
        log "✗ FAIL $YEAR $MAKE"
      fi
    else
      # Non-BaT: quick insert from queue data
      if [[ -n "$YEAR" && "$YEAR" != "null" ]]; then
        TITLE=$(echo "$item" | jq -r '.listing_title // empty' | sed 's/"/\\"/g')
        MODEL=$(echo "$item" | jq -r '.listing_model // empty' | sed 's/"/\\"/g')
        PRICE=$(echo "$item" | jq -r '.listing_price // 0')
        DOMAIN=$(echo "$URL" | awk -F'/' '{print $3}')

        VID=$(dotenvx run --quiet -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/rest/v1/vehicles\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -H \"Prefer: return=representation\" -d '{\"year\":$YEAR,\"make\":\"$MAKE\",\"model\":\"$MODEL\",\"bat_listing_title\":\"$TITLE\",\"sale_price\":$PRICE,\"discovery_url\":\"$URL\",\"discovery_source\":\"$DOMAIN\",\"listing_source\":\"queue_import\",\"profile_origin\":\"discovery\",\"is_public\":true,\"status\":\"active\"}'" 2>/dev/null | jq -r '.[0].id // .id // empty')

        if [[ -n "$VID" ]]; then
          dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}'" 2>/dev/null
          log "✓ $YEAR $MAKE"
        else
          dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"failed\"}'" 2>/dev/null
        fi
      else
        dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"status\":\"skipped\"}'" 2>/dev/null
      fi
    fi
  done

  sleep 1
done
