#!/bin/bash
# worker-bh.sh — BH Auction (Japanese) Worker
# Batch extraction per auction slug

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [BH-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-bh-auction\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

log "Starting BH Auction extraction"

# Try batch mode
log "Running batch extraction..."
RESULT=$(call_fn '{"batch": true}')
log "Batch: $(echo "$RESULT" | jq -c '{success: .success, processed: .processed, lots: .lots_found}' 2>/dev/null)"

sleep 5

# Try fetching main auction listing pages to discover slugs
log "Discovering auction pages..."
AUCTION_SLUGS=$(dotenvx run -- bash -c 'curl -s "https://bhauction.com/en/" -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" | grep -oE "/en/auction/[^\"]*" | sed "s|/en/auction/||g" | sort -u' 2>/dev/null)

if [ -n "$AUCTION_SLUGS" ]; then
  log "Found auction slugs: $AUCTION_SLUGS"
  echo "$AUCTION_SLUGS" | while read -r slug; do
    [ -z "$slug" ] && continue
    [ "$(date +%s)" -ge "$END_TIME" ] && break
    log "  Processing auction: $slug"
    RESULT=$(call_fn "{\"auction_slug\": \"$slug\"}")
    log "  $slug: $(echo "$RESULT" | jq -c '{success: .success, lots: .lots_processed}' 2>/dev/null)"
    sleep 5
  done
else
  log "No auction slugs found, trying numbered pages..."
  for page in 1 2 3 4 5; do
    [ "$(date +%s)" -ge "$END_TIME" ] && break
    log "  Page $page..."
    RESULT=$(call_fn "{\"page\": $page}")
    log "  Page $page: $(echo "$RESULT" | jq -c '{success: .success, lots: .lots_processed}' 2>/dev/null)"
    sleep 5
  done
fi

log "BH Auction worker complete."
