#!/bin/bash
cd /Users/skylar/nuke
eval "$(dotenvx run -- printenv 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

LOG="logs/bat-turbo.log"
> "$LOG"

echo "[$(date '+%H:%M:%S')] BAT TURBO - fast sequential" | tee -a "$LOG"

c=0
while true; do
  # Get and immediately mark as processing in one call
  ITEM=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url&limit=1&order=created_at" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY")
  
  ID=$(echo "$ITEM" | jq -r '.[0].id // empty')
  URL=$(echo "$ITEM" | jq -r '.[0].listing_url // empty')
  
  [ -z "$ID" ] && { echo "[$(date '+%H:%M:%S')] Done! $c processed" | tee -a "$LOG"; exit 0; }
  
  # Quick mark processing
  curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d '{"status":"processing"}' > /dev/null &
  
  # Extract (main work)
  R=$(curl -s -m 45 -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"url\":\"$URL\",\"save_to_db\":true}")
  
  VID=$(echo "$R" | jq -r '.extracted.vehicle_id // empty' 2>/dev/null)
  ERR=$(echo "$R" | jq -r '.error // empty' 2>/dev/null)
  
  if [ -n "$VID" ] && [ "$VID" != "null" ]; then
    S="complete"
  elif [[ "$ERR" == *"unique"* ]] || [[ "$ERR" == *"duplicate"* ]]; then
    S="duplicate"
  else
    S="failed"
  fi
  
  curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" -d "{\"status\":\"$S\"}" > /dev/null &
  
  c=$((c+1))
  [ $((c % 50)) -eq 0 ] && echo "[$(date '+%H:%M:%S')] $c done" | tee -a "$LOG"
done
