#!/bin/bash
# worker-bonhams.sh — Bonhams Catalog Worker
# JSON-LD catalog extraction for motoring sales

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [BONHAMS-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-bonhams\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

log "Starting Bonhams extraction"

# Phase 1: Use Playwright discovery script if available
if [ -f "scripts/bonhams-discover-sales.ts" ]; then
  log "Running Playwright-based sale discovery..."
  dotenvx run -- npx tsx scripts/bonhams-discover-sales.ts 2>&1 | while read -r line; do
    log "  $line"
  done
  log "Playwright discovery complete"
else
  log "Playwright script not found, using curl-based discovery..."

  # Try to discover sale IDs from the cars.bonhams.com site
  log "Discovering Bonhams sales..."
  SALE_URLS=$(dotenvx run -- bash -c '
    curl -s "https://cars.bonhams.com/auctions/" -H "User-Agent: Mozilla/5.0" -L | grep -oE "auction/[0-9]+" | sort -u
    curl -s "https://www.bonhams.com/department/MOT/" -H "User-Agent: Mozilla/5.0" | grep -oE "auction/[0-9]+" | sort -u
  ' 2>/dev/null | sort -u)

  if [ -n "$SALE_URLS" ]; then
    log "Found sale IDs: $SALE_URLS"
    echo "$SALE_URLS" | while read -r sale_path; do
      [ -z "$sale_path" ] && continue
      [ "$(date +%s)" -ge "$END_TIME" ] && break
      SALE_ID=$(echo "$sale_path" | grep -oE '[0-9]+')
      log "  Extracting sale: $SALE_ID"
      RESULT=$(call_fn "{\"catalog_url\": \"https://cars.bonhams.com/$sale_path/\"}")
      log "  Sale $SALE_ID: $(echo "$RESULT" | jq -c '{success: .success, lots: .lots_processed}' 2>/dev/null)"
      sleep 5
    done
  else
    log "No sales discovered. Trying sequential range 27000-33000..."
    for sale_id in $(seq 27000 33000); do
      [ "$(date +%s)" -ge "$END_TIME" ] && break
      RESULT=$(call_fn "{\"catalog_url\": \"https://cars.bonhams.com/auction/$sale_id/\"}")
      SUCCESS=$(echo "$RESULT" | jq -r '.success' 2>/dev/null)
      if [ "$SUCCESS" = "true" ]; then
        LOTS=$(echo "$RESULT" | jq -r '.lots_processed // 0' 2>/dev/null)
        [ "${LOTS:-0}" -gt 0 ] && log "  Sale $sale_id: $LOTS lots"
      fi
      sleep 0.3
    done
  fi
fi

# Process any Bonhams URLs already in queue
log "Processing queued Bonhams URLs..."
QUEUED=$(dotenvx run -- bash -c 'PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c "SELECT listing_url FROM import_queue WHERE listing_url LIKE '\''%bonhams%'\'' AND status='\''pending'\'' LIMIT 50;"' 2>/dev/null)

echo "$QUEUED" | while read -r url; do
  url=$(echo "$url" | tr -d ' ')
  [ -z "$url" ] && continue
  [ "$(date +%s)" -ge "$END_TIME" ] && break
  log "  Extracting: $url"
  RESULT=$(call_fn "{\"url\": \"$url\", \"save_to_db\": true}")
  log "  $(echo "$RESULT" | jq -c '{success: .success}' 2>/dev/null)"
  sleep 3
done

log "Bonhams worker complete."
