#!/bin/bash
cd /Users/skylar/nuke

# Load env once
eval "$(dotenvx run -- printenv 2>/dev/null | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

LOG="logs/bat-go-$(date '+%Y%m%d-%H%M%S').log"
mkdir -p logs

echo "[$(date '+%H:%M:%S')] === BAT GO ===" >> "$LOG"
echo "Stop: pkill -f bat-go" >> "$LOG"

count=0
while true; do
  ITEM=$(curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY")
  
  ID=$(echo "$ITEM" | jq -r '.[0].id // empty')
  URL=$(echo "$ITEM" | jq -r '.[0].listing_url // empty')
  
  [ -z "$ID" ] && { echo "[$(date '+%H:%M:%S')] DONE ($count)" >> "$LOG"; exit 0; }
  
  RESULT=$(curl -s -m 60 -X POST "$VITE_SUPABASE_URL/functions/v1/bat-simple-extract" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" \
    -d "{\"url\":\"$URL\",\"save_to_db\":true}")
  
  VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // empty')
  
  if [ -n "$VID" ] && [ "$VID" != "null" ]; then
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}" > /dev/null
  else
    curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "{\"status\":\"failed\"}" > /dev/null
  fi
  
  count=$((count + 1))
  [ $((count % 25)) -eq 0 ] && echo "[$(date '+%H:%M:%S')] $count done" >> "$LOG"
done
