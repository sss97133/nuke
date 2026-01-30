#!/bin/bash
# BAT Blitz - fast continuous extraction
cd /Users/skylar/nuke

LOG="logs/bat-blitz-$(date '+%Y%m%d-%H%M%S').log"
mkdir -p logs
exec > >(tee -a "$LOG") 2>&1

echo "[$(date '+%H:%M:%S')] === BAT BLITZ STARTED ==="
echo "Stop: pkill -f bat-blitz"

count=0
while true; do
  # Fetch item
  ITEM=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"')
  
  ID=$(echo "$ITEM" | jq -r '.[0].id // empty')
  URL=$(echo "$ITEM" | jq -r '.[0].listing_url // empty')
  
  [ -z "$ID" ] && { echo "[$(date '+%H:%M:%S')] DONE - queue empty ($count processed)"; exit 0; }
  
  # Extract
  RESULT=$(dotenvx run --quiet -- bash -c "curl -s -m 60 -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-simple-extract\" \
    -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" \
    -d '{\"url\":\"$URL\",\"save_to_db\":true}'")
  
  VID=$(echo "$RESULT" | jq -r '.extracted.vehicle_id // empty')
  
  if [ -n "$VID" ] && [ "$VID" != "null" ]; then
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" -d '{\"status\":\"complete\",\"vehicle_id\":\"$VID\"}'" > /dev/null
    STATUS="OK"
  else
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" -d '{\"status\":\"failed\"}'" > /dev/null
    STATUS="FAIL"
  fi
  
  count=$((count + 1))
  [ $((count % 25)) -eq 0 ] && echo "[$(date '+%H:%M:%S')] $count processed..."
done
