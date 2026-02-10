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

# Try to discover sale IDs from the cars.bonhams.com site
log "Discovering Bonhams sales..."
SALE_URLS=$(dotenvx run -- bash -c '
  # Try multiple discovery paths
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
  log "No sales discovered from index pages. Trying known sale ID ranges..."
  # Try recent sale IDs (they tend to be sequential)
  for sale_id in $(seq 28500 28520); do
    [ "$(date +%s)" -ge "$END_TIME" ] && break
    RESULT=$(call_fn "{\"catalog_url\": \"https://cars.bonhams.com/auction/$sale_id/\"}")
    SUCCESS=$(echo "$RESULT" | jq -r '.success' 2>/dev/null)
    if [ "$SUCCESS" = "true" ]; then
      LOTS=$(echo "$RESULT" | jq -r '.lots_processed // 0' 2>/dev/null)
      log "  Sale $sale_id: $LOTS lots"
    fi
    sleep 3
  done
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
