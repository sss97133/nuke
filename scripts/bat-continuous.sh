#!/bin/bash
# BAT Continuous Extractor - runs until queue empty
cd /Users/skylar/nuke

LOG="logs/bat-continuous-$(date '+%Y%m%d-%H%M%S').log"
mkdir -p logs

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

total=0
ok=0
fail=0
skip=0

log "=== BAT CONTINUOUS EXTRACTOR ==="
log "Stop: pkill -f bat-continuous"

while true; do
  # Get ONE item at a time to avoid subshell issues
  ITEM=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id,listing_url&limit=1&order=created_at.asc" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null)

  ID=$(echo "$ITEM" | jq -r '.[0].id // empty')
  URL=$(echo "$ITEM" | jq -r '.[0].listing_url // empty')
  
  if [ -z "$ID" ] || [ "$ID" = "null" ]; then
    log "=== QUEUE EMPTY - DONE ==="
    log "Total: $total | OK: $ok | Fail: $fail | Skip: $skip"
    exit 0
  fi

  # Dedup check
  EXISTING=$(dotenvx run --quiet -- bash -c 'curl -s "$VITE_SUPABASE_URL/rest/v1/vehicles?or=(bat_auction_url.eq.'"$URL"',discovery_url.eq.'"$URL"')&select=id&limit=1" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"' 2>/dev/null | jq -r '.[0].id // empty')

  if [ -n "$EXISTING" ] && [ "$EXISTING" != "null" ]; then
    dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
      -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
      -H \"Content-Type: application/json\" -d '{\"status\":\"duplicate\",\"vehicle_id\":\"$EXISTING\"}'" > /dev/null 2>&1
    skip=$((skip + 1))
    total=$((total + 1))
    continue
  fi

  # Mark processing
  dotenvx run --quiet -- bash -c "curl -s -X PATCH \"\$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.$ID\" \
    -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"apikey: \$SUPABASE_SERVICE_ROLE_KEY\" \
    -H \"Content-Type: application/json\" -d '{\"status\":\"processing\"}'" > /dev/null 2>&1

  # Extract using bat-extract v2 (handles resales, versioned)
  RESULT=$(dotenvx run --quiet -- bash -c "curl -s -m 90 -X POST \"\$VITE_SUPABASE_URL/functions/v1/bat-extract\" \
    -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" \
    -d '{\"url\":\"$URL\",\"save_to_db\":true}'" 2>/dev/null)

  # Check for success using grep (robust against control chars that break jq)
  if echo "$RESULT" | grep -q '"success":true'; then
    # Extract vehicle_id with grep (handles control chars)
    VID=$(echo "$RESULT" | grep -o '"vehicle_id":"[^"]*"' | head -1 | sed 's/"vehicle_id":"//;s/"$//')
    if [ -n "$VID" ]; then
      export PATCH_JSON="{\"status\":\"complete\",\"vehicle_id\":\"$VID\",\"extractor_version\":\"bat-extract:2.0.0\"}"
    else
      export PATCH_JSON="{\"status\":\"complete\",\"extractor_version\":\"bat-extract:2.0.0\"}"
    fi
    dotenvx run --quiet -- bash -c 'curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.'"$ID"'" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "$PATCH_JSON"' > /dev/null 2>&1
    ok=$((ok + 1))
  else
    # Extract error message for debugging
    ERR_MSG=$(echo "$RESULT" | grep -o '"error":"[^"]*"' | head -1 | sed 's/"error":"//;s/"$//' | head -c 200)
    if [ -z "$ERR_MSG" ]; then
      ERR_MSG="Unknown extraction error"
    fi
    # Escape for JSON
    ERR_MSG=$(echo "$ERR_MSG" | sed 's/\\/\\\\/g; s/"/\\"/g')
    export PATCH_JSON="{\"status\":\"failed\",\"error_message\":\"$ERR_MSG\",\"extractor_version\":\"bat-extract:2.0.0\"}"
    dotenvx run --quiet -- bash -c 'curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/import_queue?id=eq.'"$ID"'" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" -d "$PATCH_JSON"' > /dev/null 2>&1
    fail=$((fail + 1))
  fi
  
  total=$((total + 1))
  
  # Progress every 50
  if [ $((total % 50)) -eq 0 ]; then
    REMAINING=$(dotenvx run --quiet -- bash -c 'curl -sI "$VITE_SUPABASE_URL/rest/v1/import_queue?status=eq.pending&listing_url=ilike.*bringatrailer*&select=id" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Prefer: count=exact" 2>/dev/null | grep -i content-range | sed "s/.*\///" | tr -d "\r\n"')
    log "[$total] OK:$ok Fail:$fail Skip:$skip | Remaining: $REMAINING"
  fi
done
