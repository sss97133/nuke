#!/bin/bash
# BAT Extractor with Resale Handling
# - VIN exists? Add auction event + photos to existing vehicle
# - New VIN? Create vehicle as normal
cd /Users/skylar/nuke

eval "$(dotenvx run -- printenv 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

LOG="logs/bat-resale-$(date '+%Y%m%d-%H%M%S').log"
mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

log "=== BAT RESALE HANDLER ==="
log "Stop: pkill -f bat-resale"

count=0
new=0
resale=0
fail=0

while true; do
  ITEM=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY")
  
  ID=$(echo "$ITEM" | jq -r '.[0].id // empty')
  URL=$(echo "$ITEM" | jq -r '.[0].listing_url // empty')
  
  [ -z "$ID" ] && { log "=== DONE === New:$new Resale:$resale Fail:$fail"; exit 0; }
  
  # First check if URL already processed
  URL_EXISTS=$(curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?bat_auction_url=eq.$URL&select=id&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].id // empty')
  
  if [ -n "$URL_EXISTS" ]; then
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"duplicate\",\"vehicle_id\":\"$URL_EXISTS\"}" > /dev/null
    count=$((count+1))
    continue
  fi
  
  # Try normal extraction first
  RESULT=$(curl -s -m 90 -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"url\":\"$URL\",\"save_to_db\":true}" 2>/dev/null)
  
  VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // empty' 2>/dev/null)
  ERR=$(echo "$RESULT" | jq -r '.error // empty' 2>/dev/null)
  
  if [ -n "$VID" ] && [ "$VID" != "null" ]; then
    # New vehicle created successfully
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}" > /dev/null
    
    YEAR=$(echo "$RESULT" | jq -r '.extracted.year // "?"' 2>/dev/null)
    MAKE=$(echo "$RESULT" | jq -r '.extracted.make // "?"' 2>/dev/null)
    PRICE=$(echo "$RESULT" | jq -r '.extracted.sale_price // 0' 2>/dev/null)
    log "NEW: $YEAR $MAKE | \$$PRICE"
    new=$((new+1))
    
  elif [[ "$ERR" == *"vin"* ]] || [[ "$ERR" == *"unique"* ]] || [[ "$ERR" == *"duplicate"* ]]; then
    # VIN duplicate - this is a RESALE! Extract data and add to existing vehicle
    
    # Extract without saving (get the data)
    EXTRACT=$(curl -s -m 90 -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
      -d "{\"url\":\"$URL\",\"save_to_db\":false}" 2>/dev/null)
    
    VIN=$(echo "$EXTRACT" | jq -r '.extracted.vin // empty' 2>/dev/null)
    YEAR=$(echo "$EXTRACT" | jq -r '.extracted.year // empty' 2>/dev/null)
    MAKE=$(echo "$EXTRACT" | jq -r '.extracted.make // empty' 2>/dev/null)
    PRICE=$(echo "$EXTRACT" | jq -r '.extracted.sale_price // empty' 2>/dev/null)
    AUCTION_DATE=$(echo "$EXTRACT" | jq -r '.extracted.auction_end_date // empty' 2>/dev/null)
    LOT=$(echo "$EXTRACT" | jq -r '.extracted.lot_number // empty' 2>/dev/null)
    SELLER=$(echo "$EXTRACT" | jq -r '.extracted.seller_username // empty' 2>/dev/null)
    BUYER=$(echo "$EXTRACT" | jq -r '.extracted.buyer_username // empty' 2>/dev/null)
    IMGS=$(echo "$EXTRACT" | jq -r '.extracted.image_urls // []' 2>/dev/null)
    
    if [ -n "$VIN" ] && [ "$VIN" != "null" ]; then
      # Find existing vehicle
      EXISTING=$(curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?vin=eq.$VIN&select=id&limit=1" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY")
      EXISTING_ID=$(echo "$EXISTING" | jq -r '.[0].id // empty')
      
      if [ -n "$EXISTING_ID" ]; then
        # Add timeline event for this auction
        curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/timeline_events" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
          -H "Content-Type: application/json" \
          -d "{\"vehicle_id\":\"$EXISTING_ID\",\"event_type\":\"auction_sold\",\"event_date\":\"$AUCTION_DATE\",\"title\":\"Sold on BaT for \$$PRICE (Lot #$LOT)\",\"description\":\"Sold by @$SELLER to @$BUYER\",\"source\":\"bat_resale_import\",\"metadata\":{\"lot_number\":\"$LOT\",\"sale_price\":$PRICE,\"auction_url\":\"$URL\"}}" > /dev/null 2>&1
        
        # Add images with source attribution
        IMG_COUNT=$(echo "$IMGS" | jq 'length' 2>/dev/null)
        if [ "$IMG_COUNT" -gt 0 ] 2>/dev/null; then
          echo "$IMGS" | jq -c '.[]' 2>/dev/null | head -50 | while read -r img_url; do
            img_url=$(echo "$img_url" | tr -d '"')
            curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/vehicle_images" \
              -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
              -H "Content-Type: application/json" \
              -d "{\"vehicle_id\":\"$EXISTING_ID\",\"image_url\":\"$img_url\",\"source\":\"bat_resale_$LOT\",\"is_external\":true}" > /dev/null 2>&1
          done
        fi
        
        # Mark complete
        curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
          -H "Content-Type: application/json" -d "{\"status\":\"complete\",\"vehicle_id\":\"$EXISTING_ID\"}" > /dev/null
        
        log "RESALE: $YEAR $MAKE | \$$PRICE | VIN:${VIN:0:8}... (added to $EXISTING_ID)"
        resale=$((resale+1))
      else
        # VIN not found? Weird edge case
        curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
          -H "Content-Type: application/json" -d "{\"status\":\"failed\"}" > /dev/null
        fail=$((fail+1))
      fi
    else
      # No VIN in extraction
      curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" -d "{\"status\":\"failed\"}" > /dev/null
      fail=$((fail+1))
    fi
  else
    # Other failure
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"failed\"}" > /dev/null
    log "FAIL: $(echo "$ERR" | head -c 40)"
    fail=$((fail+1))
  fi
  
  count=$((count+1))
  [ $((count % 25)) -eq 0 ] && log "Progress: $count (New:$new Resale:$resale Fail:$fail)"
done
