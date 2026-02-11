#!/bin/bash
# worker-gaa.sh — GAA Classic Cars Worker
# Per-page crawl to avoid edge function timeout
# Fetches page 1 to get total_pages, then loops through all pages

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [GAA-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-gaa-classics\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

crawl_type() {
  local TYPE="$1"
  log "Crawling $TYPE page 1 to get total_pages..."
  RESULT=$(call_fn "{\"action\": \"crawl\", \"type\": \"$TYPE\", \"page\": 1}")
  TOTAL_PAGES=$(echo "$RESULT" | jq -r '.total_pages // 1' 2>/dev/null)
  DISCOVERED=$(echo "$RESULT" | jq -r '.discovered // 0' 2>/dev/null)
  log "$TYPE page 1/$TOTAL_PAGES: $DISCOVERED items"

  # Crawl remaining pages
  for ((page=2; page<=TOTAL_PAGES; page++)); do
    [ "$(date +%s)" -ge "$END_TIME" ] && break
    RESULT=$(call_fn "{\"action\": \"crawl\", \"type\": \"$TYPE\", \"page\": $page}")
    DISCOVERED=$(echo "$RESULT" | jq -r '.discovered // 0' 2>/dev/null)
    log "$TYPE page $page/$TOTAL_PAGES: $DISCOVERED items"
    sleep 1
  done
}

log "Starting GAA Classic Cars per-page extraction"

# Crawl inventory page by page
crawl_type "inventory"

sleep 3

# Crawl results page by page
crawl_type "results"

log "GAA worker complete."
