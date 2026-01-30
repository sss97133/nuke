#!/bin/bash
cd /Users/skylar/nuke
WORKER_ID="${1:-1}"

eval "$(dotenvx run -- printenv 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

LOG="logs/bat-worker-$WORKER_ID.log"
echo "[$(date '+%H:%M:%S')] Worker $WORKER_ID started" >> "$LOG"

while true; do
  # Atomic claim: update one pending item to processing and return it
  CLAIMED=$(curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "{\"status\":\"processing\"}" 2>/dev/null)
  
  ID=$(echo "$CLAIMED" | jq -r '.[0].id // empty' 2>/dev/null)
  URL=$(echo "$CLAIMED" | jq -r '.[0].listing_url // empty' 2>/dev/null)
  
  [ -z "$ID" ] && { sleep 5; continue; }
  
  # Extract
  RESULT=$(curl -s -m 90 -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"url\":\"$URL\",\"save_to_db\":true}" 2>/dev/null)
  
  VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // empty' 2>/dev/null)
  ERR=$(echo "$RESULT" | jq -r '.error // empty' 2>/dev/null)
  
  if [ -n "$VID" ] && [ "$VID" != "null" ]; then
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}" > /dev/null
    echo "[$(date '+%H:%M:%S')] OK" >> "$LOG"
    
  elif [[ "$ERR" == *"vin"* ]] || [[ "$ERR" == *"unique"* ]]; then
    # Resale - extract and add to existing
    VIN=$(curl -s -m 60 -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
      -d "{\"url\":\"$URL\",\"save_to_db\":false}" 2>/dev/null | jq -r '.extracted.vin // empty')
    
    if [ -n "$VIN" ] && [ "$VIN" != "null" ]; then
      EXISTING=$(curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?vin=eq.$VIN&select=id&limit=1" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" | jq -r '.[0].id // empty')
      
      if [ -n "$EXISTING" ]; then
        curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
          -H "Content-Type: application/json" -d "{\"status\":\"complete\",\"vehicle_id\":\"$EXISTING\"}" > /dev/null
        echo "[$(date '+%H:%M:%S')] RESALE" >> "$LOG"
      else
        curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
          -H "Content-Type: application/json" -d "{\"status\":\"failed\"}" > /dev/null
      fi
    else
      curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Content-Type: application/json" -d "{\"status\":\"duplicate\"}" > /dev/null
    fi
  else
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"failed\"}" > /dev/null
  fi
done
